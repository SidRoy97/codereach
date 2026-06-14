import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { CodeGraph } from '../graph/CodeGraphTypes';
import { ImpactAnalyzer } from '../graph/ImpactAnalyzer';
import { FileSummarizer } from './FileSummarizer';

// Output filename — AGENTS.md is the cross-tool standard read by
// Claude Code, Cursor, Gemini CLI, and others.
const OUTPUT_FILENAME = 'AGENTS.md';

// Single job: write a universal AI context file to the repo root.
// It reads symbols and impact from the code graph (the single source of
// truth) and file summaries from the summarizer. It no longer depends on
// SymbolIndexer or BlastRadiusAnalyzer.
export class AiContextGenerator {
  constructor(
    private readonly getGraph: () => CodeGraph,
    private readonly summarizer: FileSummarizer,
  ) {}

  // Generate AGENTS.md and open it in the editor.
  async generate(): Promise<void> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
      vscode.window.showWarningMessage('Codescape: No workspace open.');
      return;
    }

    const dest = path.join(root, OUTPUT_FILENAME);

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Codescape: Generating ${OUTPUT_FILENAME}…` },
      async () => {
        const content = this.buildContent(root);
        fs.writeFileSync(dest, content, 'utf8');
      },
    );

    const doc = await vscode.workspace.openTextDocument(dest);
    await vscode.window.showTextDocument(doc);

    vscode.window.showInformationMessage(
      `Codescape: ${OUTPUT_FILENAME} generated. Commit it — Claude Code, Cursor, and others read it automatically.`,
    );
  }

  // Build the full markdown — vendor-neutral, readable by any LLM.
  private buildContent(root: string): string {
    const projectName = path.basename(root);
    const summaries   = this.summarizer.getSummaries();
    const graph       = this.getGraph();

    const sections: string[] = [];

    // Header
    sections.push(`# ${projectName} — AI Context`);
    sections.push('');
    sections.push('This file gives AI coding assistants a complete mental model of this codebase.');
    sections.push('It is tool-agnostic — works with Claude Code, Cursor, ChatGPT, Gemini, and Copilot.');
    sections.push('Regenerate: `Cmd+Shift+P -> Codescape: Generate AI Context File`.');
    sections.push('');

    // Structure
    sections.push('## Project Structure');
    sections.push('');
    sections.push('```');
    sections.push(this.buildFolderTree(root, summaries));
    sections.push('```');
    sections.push('');

    // File responsibilities
    if (summaries.size > 0) {
      sections.push('## File Responsibilities');
      sections.push('');
      sections.push('| File | Responsibility |');
      sections.push('|------|----------------|');
      for (const [file, summary] of summaries) {
        sections.push(`| \`${file}\` | ${summary.replace(/\|/g, '\\|')} |`);
      }
      sections.push('');
    } else {
      sections.push('## File Responsibilities');
      sections.push('');
      sections.push('> Run `Codescape: Summarize Project Files` to populate this section.');
      sections.push('');
    }

    // High-impact files — from the graph
    const highImpact = this.findHighImpactFiles(graph);
    if (highImpact.length > 0) {
      sections.push('## High-Impact Files — Edit With Care');
      sections.push('');
      sections.push('Changing these files affects many others. Check dependents before editing.');
      sections.push('');
      for (const f of highImpact) {
        sections.push(`- \`${f.file}\` — affects ${f.count} other symbol(s)`);
      }
      sections.push('');
    }

    // Symbol index — from the graph
    if (graph.nodes.length > 0) {
      sections.push('## Symbol Index');
      sections.push('');
      sections.push('Every function, class, and method — and where to find it:');
      sections.push('');
      sections.push('```');

      const byFile = new Map<string, typeof graph.nodes>();
      for (const node of graph.nodes) {
        const existing = byFile.get(node.file) ?? [];
        existing.push(node);
        byFile.set(node.file, existing);
      }

      for (const [file, nodes] of byFile) {
        sections.push(`// ${file}`);
        for (const node of nodes) {
          sections.push(`  ${node.kind.padEnd(10)} ${node.name.padEnd(35)} L${node.line + 1}`);
        }
        sections.push('');
      }

      sections.push('```');
      sections.push('');
    } else {
      sections.push('## Symbol Index');
      sections.push('');
      sections.push('> Run `Codescape: Build Code Graph` to populate this section.');
      sections.push('');
    }

    sections.push('---');
    sections.push(`*Generated ${new Date().toLocaleString()} by Codescape — works with any AI tool*`);

    return sections.join('\n');
  }

  // Find files whose symbols have the highest total impact.
  private findHighImpactFiles(graph: CodeGraph): Array<{ file: string; count: number }> {
    const analyzer = new ImpactAnalyzer(graph);
    const files = Array.from(new Set(graph.nodes.map(n => n.file)));

    const scored = files.map(file => ({
      file,
      count: analyzer.blastRadiusForFile(file),
    }));

    return scored
      .filter(s => s.count >= 3)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }

  // Build a folder tree with inline summaries. Works for any structure.
  private buildFolderTree(root: string, summaries: Map<string, string>): string {
    const projectName = path.basename(root);
    const lines: string[] = [`${projectName}/`];

    const SKIP = new Set([
      'node_modules', 'out', 'dist', '.git', '__pycache__',
      '.vscode', 'build', 'target', '.pytest_cache', 'coverage',
    ]);

    try {
      const walk = (dir: string, prefix: string, depth: number): void => {
        if (depth > 4) return;

        let entries: fs.Dirent[];
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
          return;
        }

        const dirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.') && !SKIP.has(e.name));
        const files = entries.filter(e => e.isFile() && this.isSourceFile(e.name));

        for (const d of dirs) {
          lines.push(`${prefix}|-- ${d.name}/`);
          walk(path.join(dir, d.name), prefix + '|   ', depth + 1);
        }

        for (const f of files) {
          const rel = path.relative(root, path.join(dir, f.name));
          const summary = summaries.get(rel) ?? '';
          const short = summary.length > 50 ? summary.slice(0, 47) + '...' : summary;
          lines.push(`${prefix}|-- ${f.name.padEnd(35)} ${short}`);
        }
      };

      walk(root, '    ', 0);
    } catch {
      // Tree is optional — never block generation.
    }

    return lines.join('\n');
  }

  private isSourceFile(name: string): boolean {
    const EXTS = ['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.md', '.json'];
    const SKIP = new Set(['.DS_Store', 'package-lock.json', 'yarn.lock', 'AGENTS.md']);
    return EXTS.some(ext => name.endsWith(ext)) && !SKIP.has(name);
  }
}