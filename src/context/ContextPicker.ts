import * as vscode from 'vscode';
import * as path   from 'path';
import { SymbolIndexer }       from './SymbolIndexer';
import { BlastRadiusAnalyzer } from './BlastRadiusAnalyzer';
import { FileSummarizer }      from './FileSummarizer';

// Single job: build the smallest possible AI context bundle for a request
export class ContextPicker {

  constructor(
    private readonly symbols:  SymbolIndexer,
    private readonly blast:    BlastRadiusAnalyzer,
    private readonly summaries: FileSummarizer,
  ) {}

  // Build full context for the active file + selected symbol
  // Use when asking AI to change a specific function
  async buildContext(editor: vscode.TextEditor): Promise<string> {
    const document = editor.document;
    const folders  = vscode.workspace.workspaceFolders;
    if (!folders) return '';

    const root = folders[0].uri.fsPath;
    const rel  = path.relative(root, document.uri.fsPath);

    // Get the word the cursor is on — or the selected text
    const selection    = editor.selection;
    const selectedWord = selection.isEmpty
      ? document.getText(document.getWordRangeAtPosition(selection.active))
      : document.getText(selection);

    const parts: string[] = [];

    // 1. File summaries — gives AI the project map in ~20 lines
    const fileSummaries = this.summaries.getSummaries();
    if (fileSummaries.size > 0) {
      parts.push('// ═══ PROJECT FILE SUMMARIES ═══');
      for (const [file, summary] of fileSummaries) {
        parts.push(`// ${file.padEnd(50)} ${summary}`);
      }
      parts.push('');
    }

    // 2. The current file — always include the full content
    parts.push(`// ═══ CURRENT FILE: ${rel} ═══`);
    parts.push(document.getText());
    parts.push('');

    // 3. Related symbols — find where the selected word is defined
    if (selectedWord && selectedWord.length > 1) {
      const found = await this.symbols.search(selectedWord);
      const exact = found.filter(s => s.name === selectedWord);

      if (exact.length > 0) {
        parts.push(`// ═══ SYMBOL: "${selectedWord}" ═══`);
        for (const sym of exact) {
          parts.push(`// Defined at: ${sym.file} L${sym.line + 1} (${sym.kind})`);
        }
        parts.push('');

        // Include the file content where the symbol is defined
        // Limit to 3 files to keep token count reasonable
        const included = new Set([rel]);
        for (const sym of exact.slice(0, 3)) {
          if (included.has(sym.file)) continue;
          included.add(sym.file);

          try {
            const uri = vscode.Uri.file(sym.fullPath);
            const doc = await vscode.workspace.openTextDocument(uri);
            parts.push(`// ═══ DEPENDENCY: ${sym.file} ═══`);
            parts.push(doc.getText());
            parts.push('');
          } catch { /* skip if file can't be read */ }
        }
      }
    }

    // 4. Blast radius — tells AI what else might break
    try {
      const node = await this.blast.getBlastRadius(document.uri);
      if (node.importedBy.length > 0) {
        parts.push('// ═══ BLAST RADIUS ═══');
        parts.push(`// Changing ${rel} may affect ${node.blastRadius} file(s):`);
        for (const f of node.importedBy) {
          parts.push(`//   → ${f}`);
        }
        parts.push('');
      }
    } catch { /* blast radius optional — skip if not built yet */ }

    const content    = parts.join('\n');
    const tokenEst   = Math.round(content.length / 4);

    // Header with token estimate so user knows how big the context is
    const header = [
      `// ═══ CODESEC AI CONTEXT ═══`,
      `// Generated: ${new Date().toLocaleString()}`,
      `// Estimated tokens: ~${tokenEst}`,
      `// Active file: ${rel}`,
      `// Selected symbol: ${selectedWord || '(none — place cursor on a function name)'}`,
      '',
    ].join('\n');

    return header + content;
  }

  // Build lightweight context — just summaries + symbol map, no file contents
  // Use for high-level questions: "where should I add X?" or "how does Y work?"
  async buildLightContext(): Promise<string> {
    const parts = [
      '// ═══ CODESEC LIGHT CONTEXT ═══',
      `// Generated: ${new Date().toLocaleString()}`,
      `// Use this for: architecture questions, where to add things, high-level changes`,
      '',
      this.summaries.formatForAi(),
      '',
      this.symbols.formatForAi(),
    ];

    return parts.join('\n');
  }
}