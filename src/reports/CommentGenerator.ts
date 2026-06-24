import * as vscode from 'vscode';
import { LanguageParser } from '../graph/LanguageParser';
import { AiScanner } from '../scanners/AiScanner';

// Comment style per language — what to insert above a function/method.
type CommentStyle = 'jsdoc' | 'python' | 'javadoc';

const STYLE_FOR_LANG: Record<string, CommentStyle> = {
  javascript:      'jsdoc',
  javascriptreact: 'jsdoc',
  typescript:      'jsdoc',
  typescriptreact: 'jsdoc',
  python:          'python',
  java:            'javadoc',
};

// Prompts use concrete examples so smaller models can follow the output
// format even when they struggle with "return ONLY" instructions.
const SYSTEM_PROMPTS: Record<CommentStyle, string> = {
  jsdoc:
`Write a JSDoc comment for the given JavaScript/TypeScript function.
Output only the JSDoc block — start with /** and end with */.
Include a one-line description, @param for each parameter, and @returns if it returns a value.
Keep it under 8 lines. Do not include the function code. Do not use markdown fences.
Example output:
/**
 * Validates a user token against the provided secret.
 * @param token - The JWT string to verify
 * @param secret - The signing secret
 * @returns true if valid, false otherwise
 */`,

  python:
`Write a Google-style Python docstring for the given function.
Output only the docstring — start and end with triple double-quotes.
Include a one-line summary, an Args: section if there are parameters, and Returns: if it returns a value.
Do not include the function code. Do not use markdown fences.
Example output:
"""Validates user credentials against the database.

Args:
    username: The user login name.
    password: The plaintext password to verify.

Returns:
    True if credentials are valid, False otherwise.
"""`,

  javadoc:
`Write a Javadoc comment for the given Java method.
Output only the Javadoc block — start with /** and end with */.
Include a one-line description, @param for each parameter, and @return if it returns a value.
Do not include the method code. Do not use markdown fences.
Example output:
/**
 * Validates a user token against the provided secret.
 * @param token the JWT string to verify
 * @param secret the signing secret
 * @return true if the token is valid and unexpired
 */`,
};

// Single job: find uncommented functions/methods in a file and insert
// AI-generated comments above them. Non-destructive — never touches a
// function that already has a comment directly above it.
export class CommentGenerator {
  constructor(
    private readonly parser: LanguageParser,
    private readonly ai: AiScanner,
  ) {}

  async generateForFile(document: vscode.TextDocument): Promise<void> {
    const style = STYLE_FOR_LANG[document.languageId];
    if (!style) {
      vscode.window.showWarningMessage(
        `CodeReach: Auto-comment is not supported for ${document.languageId}.`,
      );
      return;
    }

    const parsed = await this.parser.parse(document);
    const symbols = parsed.symbols.filter(
      s => s.kind === 'function' || s.kind === 'method',
    );

    if (symbols.length === 0) {
      vscode.window.showInformationMessage('CodeReach: No functions found in this file.');
      return;
    }

    // Filter to only symbols that do NOT already have a comment above them.
    const uncommented = symbols.filter(
      s => !this.hasCommentAbove(document, s.line, style),
    );

    if (uncommented.length === 0) {
      vscode.window.showInformationMessage(
        'CodeReach: All functions in this file already have comments.',
      );
      return;
    }

    // Probe the AI before iterating — give the user clear setup guidance
    // if the provider is not reachable, instead of silently skipping everything.
    const aiReady = await this.probeAi();
    if (!aiReady) {
      const choice = await vscode.window.showWarningMessage(
        'CodeReach: No AI response — comments cannot be generated. ' +
        'For Ollama: start the server by running "ollama serve" in a terminal. ' +
        'You can also switch to a cloud provider (Groq, HuggingFace) in Settings → codereach.aiProvider.',
        'Start Ollama',
        'Open Settings',
        'Get Ollama',
      );
      if (choice === 'Start Ollama') {
        const terminal = vscode.window.createTerminal('CodeReach: Ollama');
        terminal.show();
        terminal.sendText('ollama serve');
      } else if (choice === 'Open Settings') {
        vscode.commands.executeCommand('workbench.action.openSettings', 'codereach.aiProvider');
      } else if (choice === 'Get Ollama') {
        vscode.env.openExternal(vscode.Uri.parse('https://ollama.com'));
      }
      return;
    }

    let added = 0;
    let skipped = 0;

    await vscode.window.withProgress(
      {
        location:    vscode.ProgressLocation.Notification,
        title:       'CodeReach: Generating comments…',
        cancellable: true,
      },
      async (progress, token) => {
        // Process bottom-to-top so insertions above earlier functions don't
        // shift the line numbers of later ones.
        const sorted = [...uncommented].sort((a, b) => b.line - a.line);

        for (let i = 0; i < sorted.length; i++) {
          if (token.isCancellationRequested) break;

          const sym = sorted[i];
          progress.report({
            message:   `${i + 1}/${sorted.length} — ${sym.name}`,
            increment: (1 / sorted.length) * 100,
          });

          // Re-read after each edit so the live document reflects prior insertions.
          const live = vscode.workspace.textDocuments.find(
            d => d.uri.toString() === document.uri.toString(),
          ) ?? document;

          const slice = this.functionSlice(live, sym.line);
          if (!slice) { skipped++; continue; }

          const comment = await this.generateComment(sym.name, slice, style, live.languageId);
          if (!comment) { skipped++; continue; }

          const indent   = this.indentOf(live, sym.line);
          const indented = this.indentComment(comment, indent);
          const insertPos = new vscode.Position(sym.line, 0);

          const edit = new vscode.WorkspaceEdit();
          edit.insert(live.uri, insertPos, indented + '\n');
          await vscode.workspace.applyEdit(edit);
          added++;
        }
      },
    );

    const msg = skipped > 0
      ? `CodeReach: Added ${added} comment(s). ${skipped} skipped (AI unavailable or empty response).`
      : `CodeReach: Added ${added} comment(s).`;
    vscode.window.showInformationMessage(msg);
  }

  // True when the line immediately above `line` (ignoring blank lines)
  // already contains a comment for the given style.
  private hasCommentAbove(
    document: vscode.TextDocument,
    line:     number,
    style:    CommentStyle,
  ): boolean {
    for (let l = line - 1; l >= 0; l--) {
      const text = document.lineAt(l).text.trim();
      if (text === '') continue; // skip blank lines between decorator/comment and function

      if (style === 'python') {
        return text.startsWith('"""') || text.startsWith("'''") || text.startsWith('#');
      } else {
        return text.endsWith('*/') || text.startsWith('//') || text.startsWith('/*');
      }
    }
    return false;
  }

  // Extract up to 60 lines starting at the function definition line.
  private functionSlice(document: vscode.TextDocument, line: number): string | null {
    const start = Math.max(0, line);
    const end   = Math.min(document.lineCount, start + 60);
    const lines: string[] = [];
    for (let l = start; l < end; l++) {
      lines.push(document.lineAt(l).text);
    }
    return lines.join('\n') || null;
  }

  // Quick sanity check — send a tiny request to confirm the AI provider
  // is reachable before iterating over every function in the file.
  private async probeAi(): Promise<boolean> {
    try {
      const reply = await this.ai.generateText('Reply with the single word: ok', 'ping');
      return !!(reply && reply.trim());
    } catch {
      return false;
    }
  }

  // Ask the AI for a comment for one function.
  private async generateComment(
    name:   string,
    code:   string,
    style:  CommentStyle,
    langId: string,
  ): Promise<string | null> {
    const system = SYSTEM_PROMPTS[style];
    const user   = `Language: ${langId}\nFunction: ${name}\n\`\`\`\n${code.slice(0, 3000)}\n\`\`\``;
    try {
      const reply = await this.ai.generateText(system, user);
      if (!reply || !reply.trim()) {
        console.warn(`CodeReach CommentGenerator: empty reply for ${name}`);
        return null;
      }
      const cleaned = this.cleanComment(reply.trim(), style);
      if (!cleaned) {
        console.warn(`CodeReach CommentGenerator: unrecognised reply for ${name}:`, reply.slice(0, 200));
        return null;
      }
      return cleaned;
    } catch (e) {
      console.error(`CodeReach CommentGenerator: error for ${name}:`, e);
      return null;
    }
  }

  // Strip prose/markdown the model may have added, leaving just the comment block.
  // Handles: markdown fences, "Here is the comment:" preambles, plain text
  // that needs to be wrapped.
  private cleanComment(raw: string, style: CommentStyle): string {
    let s = raw.trim();

    // Remove markdown fences (```js ... ```, ```python ... ```, etc.)
    s = s.replace(/^```[\w]*\r?\n?/im, '').replace(/\r?\n?```\s*$/im, '').trim();

    // Find the first line that looks like the start of a real comment and
    // discard any preamble prose before it.
    const lines = s.split('\n');
    let startIdx = 0;
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (style === 'python') {
        if (t.startsWith('"""') || t.startsWith("'''")) { startIdx = i; break; }
      } else {
        if (t.startsWith('/**') || t.startsWith('/*') || t.startsWith('//')) { startIdx = i; break; }
      }
    }
    s = lines.slice(startIdx).join('\n').trim();

    // If the model still produced plain text without comment syntax, wrap it.
    if (style === 'python') {
      if (!s.startsWith('"""') && !s.startsWith("'''")) {
        const plain = s.trim();
        s = plain ? `"""${plain}\n"""` : '';
      }
    } else {
      if (!s.startsWith('/*') && !s.startsWith('//')) {
        const plain = s.replace(/^#+\s*/gm, '').trim();
        const body  = plain.split('\n').join('\n * ');
        s = plain ? `/**\n * ${body}\n */` : '';
      }
    }

    return s;
  }

  // Get the leading whitespace of the function's line.
  private indentOf(document: vscode.TextDocument, line: number): string {
    const text  = document.lineAt(line).text;
    const match = text.match(/^(\s*)/);
    return match ? match[1] : '';
  }

  // Prefix every line of the comment with the same indentation as the function.
  private indentComment(comment: string, indent: string): string {
    if (!indent) return comment;
    return comment.split('\n').map(line => indent + line).join('\n');
  }
}