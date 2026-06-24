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

// System prompts per style — each produces a ready-to-insert comment block.
const SYSTEM_PROMPTS: Record<CommentStyle, string> = {
  jsdoc: `You are a senior JavaScript/TypeScript engineer writing JSDoc comments.
Given a function or method, write a concise JSDoc comment block.
Rules:
- Start with /** and end with */
- One-line description on the first line after /**
- @param for each parameter with type and description
- @returns with type and description (omit if void/Promise<void>)
- Keep it under 8 lines total
- No prose, no markdown, just the JSDoc block
Return ONLY the comment block, nothing else.`,

  python: `You are a senior Python engineer writing docstrings.
Given a function or method, write a concise Google-style docstring.
Rules:
- Use triple double-quotes
- One-line summary on the first line
- Args: section if there are parameters
- Returns: section if it returns something
- Keep it under 10 lines total
Return ONLY the docstring (starting with \"""), nothing else.`,

  javadoc: `You are a senior Java engineer writing Javadoc comments.
Given a method or class, write a concise Javadoc comment block.
Rules:
- Start with /** and end with */
- One-line description on the first line after /**
- @param for each parameter with description
- @return with description (omit if void)
- @throws if the method declares checked exceptions
- Keep it under 10 lines total
Return ONLY the Javadoc block, nothing else.`,
};

// Single job: find uncommented functions/methods in a file and insert
// AI-generated comments above them. Non-destructive — never touches a
// function that already has a comment directly above it.
export class CommentGenerator {
  constructor(
    private readonly parser: LanguageParser,
    private readonly ai: AiScanner,
  ) {}

  // Comment all uncommented functions in the active document.
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

    let added = 0;
    let skipped = 0;

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title:    'CodeReach: Generating comments…',
        cancellable: true,
      },
      async (progress, token) => {
        // Process one at a time — we re-read the document after each edit
        // so line numbers stay accurate as we insert text above earlier lines.
        // We go bottom-to-top so insertions above earlier functions don't
        // shift the line numbers of later ones.
        const sorted = [...uncommented].sort((a, b) => b.line - a.line);

        for (let i = 0; i < sorted.length; i++) {
          if (token.isCancellationRequested) break;

          const sym = sorted[i];
          progress.report({
            message:   `${i + 1}/${sorted.length} — ${sym.name}`,
            increment: (1 / sorted.length) * 100,
          });

          // Re-read after each edit so the live document reflects insertions.
          const live = vscode.workspace.textDocuments.find(
            d => d.uri.toString() === document.uri.toString(),
          ) ?? document;

          // Extract a slice of the function for context.
          const slice = this.functionSlice(live, sym.line);
          if (!slice) { skipped++; continue; }

          const comment = await this.generateComment(
            sym.name, slice, style, live.languageId,
          );
          if (!comment) { skipped++; continue; }

          // Insert the comment above the function's line.
          const indent   = this.indentOf(live, sym.line);
          const indented = this.indentComment(comment, indent, style);
          const insertPos = new vscode.Position(sym.line, 0);

          const edit = new vscode.WorkspaceEdit();
          edit.insert(live.uri, insertPos, indented + '\n');
          await vscode.workspace.applyEdit(edit);
          added++;
        }
      },
    );

    const msg = skipped > 0
      ? `CodeReach: Added ${added} comment(s). ${skipped} skipped (AI unavailable or no content).`
      : `CodeReach: Added ${added} comment(s).`;
    vscode.window.showInformationMessage(msg);
  }

  // True when the line immediately above `line` (ignoring blank lines) is
  // already a comment line for the given style.
  private hasCommentAbove(
    document: vscode.TextDocument,
    line: number,
    style: CommentStyle,
  ): boolean {
    // Walk upward from line-1, skipping blank lines.
    for (let l = line - 1; l >= 0; l--) {
      const text = document.lineAt(l).text.trim();
      if (text === '') continue; // skip blank lines

      if (style === 'python') {
        // Python: triple-quote docstring or # comment
        return text.startsWith('"""') || text.startsWith("'''") || text.startsWith('#');
      } else {
        // JSDoc / Javadoc: */ closes a block comment, // is a line comment
        return text.endsWith('*/') || text.startsWith('//') || text.startsWith('/*');
      }
    }
    return false;
  }

  // Extract up to 60 lines starting at the function definition for AI context.
  private functionSlice(document: vscode.TextDocument, line: number): string | null {
    const start = Math.max(0, line);
    const end   = Math.min(document.lineCount, start + 60);
    const lines: string[] = [];
    for (let l = start; l < end; l++) {
      lines.push(document.lineAt(l).text);
    }
    return lines.join('\n') || null;
  }

  // Ask the AI for a comment for one function.
  private async generateComment(
    name:     string,
    code:     string,
    style:    CommentStyle,
    langId:   string,
  ): Promise<string | null> {
    const system = SYSTEM_PROMPTS[style];
    const user   = `Language: ${langId}\nFunction: ${name}\n\`\`\`\n${code.slice(0, 3000)}\n\`\`\``;
    try {
      const reply = await this.ai.generateText(system, user);
      if (!reply || !reply.trim()) return null;
      return this.cleanComment(reply.trim(), style);
    } catch {
      return null;
    }
  }

  // Strip any accidental markdown fences the model may have wrapped around
  // the comment, and ensure it's a proper comment block.
  private cleanComment(raw: string, style: CommentStyle): string {
    // Remove ```javascript, ```python, ``` fences if present.
    let s = raw.replace(/^```[\w]*\n?/i, '').replace(/\n?```$/i, '').trim();

    if (style === 'python') {
      // Must start with triple-quote.
      if (!s.startsWith('"""') && !s.startsWith("'''")) {
        s = `"""${s}"""`;
      }
    } else {
      // Must start with /* or //.
      if (!s.startsWith('/*') && !s.startsWith('//')) {
        s = `/**\n * ${s}\n */`;
      }
    }
    return s;
  }

  // Get the leading whitespace of the function's line so the comment
  // is indented to match.
  private indentOf(document: vscode.TextDocument, line: number): string {
    const text  = document.lineAt(line).text;
    const match = text.match(/^(\s*)/);
    return match ? match[1] : '';
  }

  // Prefix every line of the comment with the same indentation as the
  // function it documents, so it looks natural inside a class body.
  private indentComment(
    comment: string,
    indent:  string,
    style:   CommentStyle,
  ): string {
    if (!indent) return comment;
    return comment
      .split('\n')
      .map((line, _i) => {
        // Python docstrings: first line (""") goes right after indent,
        // subsequent lines also get indented.
        if (style === 'python') return indent + line;
        // JSDoc/Javadoc: every line gets the same indent.
        return indent + line;
      })
      .join('\n');
  }
}