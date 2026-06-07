import * as vscode from 'vscode';
import * as fs     from 'fs';
import * as path   from 'path';
import { SymbolIndexer }       from './SymbolIndexer';
import { BlastRadiusAnalyzer } from './BlastRadiusAnalyzer';
import { FileSummarizer }      from './FileSummarizer';

// Output filename — AGENTS.md is the cross-tool standard
// Claude Code, Cursor, Gemini CLI, and OpenAI Codex all read this automatically
const OUTPUT_FILENAME = 'AGENTS.md';

// Single job: write a universal AI context file to the repo root
// Works with any LLM tool — not tied to Claude, ChatGPT, or any specific vendor
export class AiContextGenerator {

  constructor(
    private readonly symbols:   SymbolIndexer,
    private readonly blast:     BlastRadiusAnalyzer,
    private readonly summaries: FileSummarizer,
  ) {}

  // Generate AGENTS.md and open it in the editor
  async generate(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) {
      vscode.window.showWarningMessage('CodeSec: No workspace open.');
      return;
    }

    const root = folders[0].uri.fsPath;
    const dest = path.join(root, OUTPUT_FILENAME);

    await vscode.window.withProgress(
      {
        location:    vscode.ProgressLocation.Notification,
        title:       `CodeSec: Generating ${OUTPUT_FILENAME}…`,
        cancellable: false,
      },
      async () => {
        const content = await this.buildContent(root);
        fs.writeFileSync(dest, content, 'utf8');
      }
    );

    // Open so the user can review before committing
    const doc = await vscode.workspace.openTextDocument(dest);
    await vscode.window.showTextDocument(doc);

    vscode.window.showInformationMessage(
      `CodeSec: ${OUTPUT_FILENAME} generated. Commit this file — Claude Code, Cursor, Gemini, and Copilot all read it automatically.`
    );
  }

  // Build the full markdown — plain, vendor-neutral, readable by any LLM
  private async buildContent(root: string): Promise<string> {
    const projectName   = path.basename(root);
    const fileSummaries = this.summaries.getSummaries();
    const allSymbols    = await this.symbols.getSymbols();

    const sections: string[] = [];

    // ── Header ───────────────────────────────────────────────────────────────
    // Plain language — no tool-specific directives or syntax
    sections.push(`# ${projectName} — AI Context`);
    sections.push('');
    sections.push('This file gives AI coding assistants a complete mental model of this codebase.');
    sections.push('It is tool-agnostic — works with Claude Code, Cursor, ChatGPT, Gemini, Copilot, and others.');
    sections.push(`Regenerate: \`Cmd+Shift+P → CodeSec: Generate AI Context File\``);
    sections.push('');

    // ── Quick orientation ─────────────────────────────────────────────────────
    // First thing an AI reads — answers "what is this project?"
    sections.push('## What This Project Is');
    sections.push('');
    sections.push(`**Project:** ${projectName}`);
    sections.push(`**Languages:** ${this.detectLanguages(root).join(', ')}`);
    sections.push(`**Files analyzed:** ${fileSummaries.size > 0 ? fileSummaries.size : 'run CodeSec: Summarize Project Files'}`);
    sections.push('');

    // ── Architecture ──────────────────────────────────────────────────────────
    sections.push('## Project Structure');
    sections.push('');
    sections.push('```');
    sections.push(this.buildFolderTree(root, fileSummaries));
    sections.push('```');
    sections.push('');

    // ── File responsibilities ─────────────────────────────────────────────────
    if (fileSummaries.size > 0) {
      sections.push('## File Responsibilities');
      sections.push('');
      sections.push('One sentence per file — what it does and nothing else:');
      sections.push('');
      sections.push('| File | Responsibility |');
      sections.push('|------|----------------|');

      for (const [file, summary] of fileSummaries) {
        sections.push(`| \`${file}\` | ${summary.replace(/\|/g, '\\|')} |`);
      }
      sections.push('');
    } else {
      sections.push('## File Responsibilities');
      sections.push('');
      sections.push('> Run `CodeSec: Summarize Project Files` to auto-generate this section.');
      sections.push('');
    }

    // ── Coding patterns ───────────────────────────────────────────────────────
    // Tells the AI how to write code that fits in with the existing style
    sections.push('## Coding Patterns — Follow These When Making Changes');
    sections.push('');
    sections.push(this.detectAndDescribePatterns(root));
    sections.push('');

    // ── Where to add things ───────────────────────────────────────────────────
    // The most important section for an AI making targeted changes
    sections.push('## Where to Add or Change Things');
    sections.push('');
    sections.push(this.buildExtensionGuide(root));
    sections.push('');

    // ── High blast radius files ───────────────────────────────────────────────
    // Warns the AI to be careful with high-impact files
    const highImpact = await this.getHighImpactFiles();
    if (highImpact.length > 0) {
      sections.push('## Files With High Impact — Edit With Care');
      sections.push('');
      sections.push('These files are imported by many others. A change here ripples widely.');
      sections.push('Always check dependents before modifying these files.');
      sections.push('');
      for (const f of highImpact) {
        sections.push(`- \`${f.file}\` — ${f.blastRadius} other file(s) depend on this`);
      }
      sections.push('');
    }

    // ── Symbol index ──────────────────────────────────────────────────────────
    // Lets the AI find any function without reading every file
    if (allSymbols.length > 0) {
      sections.push('## Symbol Index');
      sections.push('');
      sections.push('Every function, class, and interface — exact file and line number:');
      sections.push('');
      sections.push('```');

      const byFile = new Map<string, typeof allSymbols>();
      for (const sym of allSymbols) {
        const existing = byFile.get(sym.file) ?? [];
        existing.push(sym);
        byFile.set(sym.file, existing);
      }

      for (const [file, syms] of byFile) {
        sections.push(`// ${file}`);
        for (const s of syms) {
          sections.push(`  ${s.kind.padEnd(12)} ${s.name.padEnd(35)} L${s.line + 1}`);
        }
        sections.push('');
      }

      sections.push('```');
      sections.push('');
    } else {
      sections.push('## Symbol Index');
      sections.push('');
      sections.push('> Run `CodeSec: Build Symbol Index` to auto-generate this section.');
      sections.push('');
    }

    // ── How to use this file ──────────────────────────────────────────────────
    // Tells users how to paste context into any AI tool
    sections.push('## How to Use This File With AI Tools');
    sections.push('');
    sections.push('**Claude Code** — reads this file automatically from the repo root.');
    sections.push('');
    sections.push('**Cursor** — reads this automatically. Also works via `.cursorrules`.');
    sections.push('');
    sections.push('**ChatGPT / Gemini (web)** — paste the contents at the start of your conversation.');
    sections.push('');
    sections.push('**GitHub Copilot** — copy to `.github/copilot-instructions.md`.');
    sections.push('');
    sections.push('**Any AI tool** — paste the relevant sections before your question.');
    sections.push('You do not need to paste the whole file. Paste:');
    sections.push('- "Project Structure" + "File Responsibilities" for architecture questions');
    sections.push('- "Symbol Index" + the specific file content for targeted changes');
    sections.push('- "Files With High Impact" when asking about risky changes');
    sections.push('');

    // ── Footer ────────────────────────────────────────────────────────────────
    sections.push('---');
    sections.push(`*Generated ${new Date().toLocaleString()} by CodeSec — works with any AI tool*`);

    return sections.join('\n');
  }

  // Detect which languages are actually used in the project
  private detectLanguages(root: string): string[] {
    const langs: string[] = [];
    const check = (ext: string, name: string, dir: string): void => {
      try {
        const files = this.findFilesWithExt(dir, ext);
        if (files.length > 0) langs.push(name);
      } catch { /* skip */ }
    };

    check('.ts',   'TypeScript', root);
    check('.tsx',  'React/TSX',  root);
    check('.js',   'JavaScript', root);
    check('.py',   'Python',     root);
    check('.java', 'Java',       root);

    return langs.length > 0 ? langs : ['Unknown'];
  }

  // Find files with a given extension — shallow search
  private findFilesWithExt(dir: string, ext: string): string[] {
    try {
      return fs.readdirSync(dir)
        .filter(f => f.endsWith(ext) && !f.startsWith('.'));
    } catch {
      return [];
    }
  }

  // Detect coding patterns by inspecting the actual file structure
  private detectAndDescribePatterns(root: string): string {
    const lines: string[] = [];
    const srcPath = path.join(root, 'src');

    // Check for SOLID patterns in VS Code extension
    if (fs.existsSync(path.join(srcPath, 'interfaces'))) {
      lines.push('- **Single Responsibility** — each class has one clearly stated job');
      lines.push('- **Dependency Injection** — all dependencies injected via constructor, never created inside');
      lines.push('- **Interface contracts** — classes depend on interfaces in `src/interfaces/`, not each other');
      lines.push('- **Open/Closed** — add new behaviour by creating new files, not editing existing ones');
    }

    // Check for test files
    if (this.findFilesWithExt(root, '.test.ts').length > 0 ||
        this.findFilesWithExt(root, '.spec.ts').length > 0) {
      lines.push('- **Tests** — test files live alongside source files with `.test.ts` suffix');
    }

    // Check for Python patterns
    if (this.findFilesWithExt(root, '.py').length > 0) {
      lines.push('- **Python** — follow PEP 8, use type hints, avoid mutable defaults');
    }

    // Generic patterns that apply everywhere
    lines.push('- **Comments** — single-line comments explain *why*, not *what*');
    lines.push('- **Naming** — functions start with verbs (`getUser`, `buildIndex`, `parseImports`)');
    lines.push('- **Error handling** — never silently swallow errors; log or re-throw');

    return lines.length > 0 ? lines.join('\n') : '- Follow the existing style in nearby files';
  }

  // Build a guide for adding common things — specific to this project structure
  private buildExtensionGuide(root: string): string {
    const lines:   string[] = [];
    const srcPath = path.join(root, 'src');

    if (fs.existsSync(path.join(srcPath, 'rules'))) {
      lines.push('**Add a new code quality rule:**');
      lines.push('1. Open the file in `src/rules/` matching the language');
      lines.push('2. Add one object to the `RULES` array: `{ id, pattern, message, severity, category }`');
      lines.push('3. Compile — nothing else needs changing');
      lines.push('');
    }

    if (fs.existsSync(path.join(srcPath, 'scanners'))) {
      lines.push('**Add a new type of analysis:**');
      lines.push('1. Create `src/scanners/MyScanner.ts` implementing the `IScanner` interface');
      lines.push('2. Add it to `AnalysisOrchestrator` — constructor parameter + one line in `run()`');
      lines.push('3. Inject it in `extension.ts` alongside the other scanners');
      lines.push('');
    }

    if (fs.existsSync(path.join(srcPath, 'publishers'))) {
      lines.push('**Add a new UI surface (new way to show results):**');
      lines.push('1. Create `src/publishers/MyPublisher.ts` implementing `IResultPresenter`');
      lines.push('2. Call `myPublisher.present(result)` inside the `onComplete` callback in `extension.ts`');
      lines.push('');
    }

    // Generic fallback for non-extension projects
    if (lines.length === 0) {
      lines.push('**Making a change:** look at the Symbol Index above to find the right file.');
      lines.push('**Adding a feature:** follow the pattern of the nearest existing similar feature.');
      lines.push('**Not sure where:** check File Responsibilities above — each file has one job.');
    }

    return lines.join('\n');
  }

  // Build a folder tree that works for any project — not just src/ projects
  private buildFolderTree(root: string, summaries: Map<string, string>): string {
    const projectName = path.basename(root);
    const lines: string[] = [`${projectName}/`];

    const SKIP_DIRS = new Set([
      'node_modules', 'out', 'dist', '.git',
      '__pycache__', '.vscode', 'build', 'target',
      '.pytest_cache', 'coverage', '.next', '.nuxt',
    ]);

    try {
      const walk = (dir: string, prefix: string, depth: number): void => {
        if (depth > 4) return;

        let entries: fs.Dirent[];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
        catch { return; }

        const dirs  = entries.filter(e => e.isDirectory() && !e.name.startsWith('.') && !SKIP_DIRS.has(e.name));
        const files = entries.filter(e => e.isFile() && this.isSourceFile(e.name));

        // Dirs first so structure is obvious
        for (const d of dirs) {
          lines.push(`${prefix}├── ${d.name}/`);
          walk(path.join(dir, d.name), prefix + '│   ', depth + 1);
        }

        // Files with inline summary when available
        for (const f of files) {
          const rel     = path.relative(root, path.join(dir, f.name));
          const summary = summaries.get(rel) ?? '';
          const short   = summary.length > 50 ? summary.slice(0, 47) + '…' : summary;
          lines.push(`${prefix}├── ${f.name.padEnd(35)} ${short}`);
        }
      };

      walk(root, '    ', 0);
    } catch { /* tree is optional — never block generation */ }

    return lines.join('\n');
  }

  // Files that belong in the tree
  private isSourceFile(name: string): boolean {
    const SOURCE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.md', '.json'];
    const SKIP_FILES  = new Set([
      '.DS_Store', 'package-lock.json', 'yarn.lock',
      'AGENTS.md', // don't include the file we just generated
      'CLAUDE.md', // also skip old Claude-specific file
    ]);
    return SOURCE_EXTS.some(ext => name.endsWith(ext)) && !SKIP_FILES.has(name);
  }

  // Files with highest blast radius — warn AI to be careful with these
  private async getHighImpactFiles(): Promise<Array<{ file: string; blastRadius: number }>> {
    const uris = await vscode.workspace.findFiles(
      '**/*.{ts,tsx,js,jsx,py,java}',
      '{**/node_modules/**,**/dist/**,**/out/**}'
    );

    const scored: Array<{ file: string; blastRadius: number }> = [];

    for (const uri of uris.slice(0, 30)) {
      try {
        const node = await this.blast.getBlastRadius(uri);
        if (node.blastRadius >= 3) {
          scored.push({ file: node.file, blastRadius: node.blastRadius });
        }
      } catch { /* skip */ }
    }

    return scored
      .sort((a, b) => b.blastRadius - a.blastRadius)
      .slice(0, 10);
  }
}