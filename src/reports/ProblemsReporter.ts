import * as vscode from 'vscode';
import * as path from 'path';
import { ResultStore } from '../ResultStore';
import { CodeGraph } from '../graph/CodeGraphTypes';
import { Issue, FileAnalysisResult } from '../types';

// One issue enriched with the function it lives in, ready for the report.
interface ReportedIssue {
  function: string;   // enclosing function/method name, or "(file scope)"
  line: number;       // 1-based for humans
  severity: string;
  category: string;
  message: string;
  suggestion?: string;
  rule?: string;
}

// One file's worth of reported issues.
interface ReportedFile {
  file: string;
  issueCount: number;
  issues: ReportedIssue[];
}

// Map a raw severity value to the label shown to people. I keep the stored
// value as-is (the 'error' enum is used everywhere for filtering and the VS
// Code mapping) and only change the word that appears in the report, so
// "error" reads as "Severe" without touching any logic.
function severityLabel(severity: string): string {
  if (severity === 'error') return 'Severe';
  return severity;
}

// Single job: turn the analysis results into shareable report files
// (one markdown for humans, one JSON for tools and LLMs). It reads from
// ResultStore and uses the code graph only to name the enclosing function.
export class ProblemsReporter {
  constructor(
    private readonly store: ResultStore,
    private readonly getGraph: () => CodeGraph,
  ) {}

  // Build the report data, write both files, and open the markdown.
  async generate(): Promise<void> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
      vscode.window.showWarningMessage('CodeReach: No workspace open.');
      return;
    }

    const results = this.store.getAll();
    const reported = this.buildReport(results, root);

    const markdown = this.toMarkdown(reported);
    const json = this.toJson(reported);

    const mdUri = vscode.Uri.file(path.join(root, 'codereach-issues.md'));
    const jsonUri = vscode.Uri.file(path.join(root, 'codereach-issues.json'));

    await vscode.workspace.fs.writeFile(mdUri, Buffer.from(markdown, 'utf8'));
    await vscode.workspace.fs.writeFile(jsonUri, Buffer.from(json, 'utf8'));

    const doc = await vscode.workspace.openTextDocument(mdUri);
    await vscode.window.showTextDocument(doc);

    const total = reported.reduce((n, f) => n + f.issueCount, 0);
    vscode.window.showInformationMessage(
      `CodeReach: Report written — ${total} issue(s) across ${reported.length} file(s). See codereach-issues.md and .json.`,
    );
  }

  // Group every issue by file and attach the enclosing function name.
  private buildReport(results: FileAnalysisResult[], root: string): ReportedFile[] {
    const graph = this.getGraph();

    const files: ReportedFile[] = [];
    for (const result of results) {
      if (result.issues.length === 0) continue;

      const relFile = path.relative(root, result.uri.fsPath);
      const issues = result.issues
        .map(issue => this.enrich(issue, relFile, graph))
        .sort((a, b) => a.line - b.line);

      files.push({ file: relFile, issueCount: issues.length, issues });
    }

    // Most-affected files first.
    return files.sort((a, b) => b.issueCount - a.issueCount);
  }

  // Attach the enclosing function name to one issue using the graph.
  private enrich(issue: Issue, relFile: string, graph: CodeGraph): ReportedIssue {
    const fnName = this.enclosingFunction(relFile, issue.line, graph);
    return {
      function: fnName,
      line: issue.line + 1,
      severity: issue.severity,
      category: issue.category,
      message: issue.message,
      suggestion: issue.suggestion,
      rule: issue.rule,
    };
  }

  // The function whose definition is the last one at or before this line,
  // within the same file. Falls back to "(file scope)" if none precede it.
  private enclosingFunction(relFile: string, line: number, graph: CodeGraph): string {
    let best: { name: string; line: number } | null = null;
    for (const node of graph.nodes) {
      if (node.file !== relFile) continue;
      if (node.line <= line) {
        if (!best || node.line > best.line) best = { name: node.name, line: node.line };
      }
    }
    return best ? best.name : '(file scope)';
  }

  // Human-readable markdown grouped by file, then function.
  private toMarkdown(files: ReportedFile[]): string {
    const lines: string[] = [];
    lines.push('# CodeReach — Project Issues Report');
    lines.push('');
    lines.push(`Generated: ${new Date().toLocaleString()}`);
    lines.push('');

    const total = files.reduce((n, f) => n + f.issueCount, 0);
    if (total === 0) {
      lines.push('No issues found. Run "CodeReach: Analyze Entire Workspace" first if this seems wrong.');
      return lines.join('\n');
    }

    // Summary counts by severity and category.
    const sev: Record<string, number> = {};
    const cat: Record<string, number> = {};
    for (const f of files) {
      for (const i of f.issues) {
        sev[i.severity] = (sev[i.severity] ?? 0) + 1;
        cat[i.category] = (cat[i.category] ?? 0) + 1;
      }
    }

    lines.push(`Total issues: ${total} across ${files.length} file(s)`);
    lines.push('');
    lines.push('Severity: ' + Object.entries(sev).map(([k, v]) => `${severityLabel(k)} ${v}`).join(' · '));
    lines.push('Category: ' + Object.entries(cat).map(([k, v]) => `${k} ${v}`).join(' · '));
    lines.push('');

    for (const file of files) {
      lines.push(`## ${file.file} — ${file.issueCount} issue(s)`);
      lines.push('');

      // Group this file's issues by function.
      const byFn = new Map<string, ReportedIssue[]>();
      for (const issue of file.issues) {
        const existing = byFn.get(issue.function) ?? [];
        existing.push(issue);
        byFn.set(issue.function, existing);
      }

      for (const [fn, issues] of byFn) {
        lines.push(`### ${fn}`);
        lines.push('');
        for (const i of issues) {
          lines.push(`- **L${i.line}** [${severityLabel(i.severity)}/${i.category}] ${i.message}`);
          if (i.suggestion) lines.push(`  - Fix: ${i.suggestion}`);
        }
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  // Machine-readable JSON for tools and LLMs.
  private toJson(files: ReportedFile[]): string {
    const total = files.reduce((n, f) => n + f.issueCount, 0);
    return JSON.stringify({ generated: new Date().toISOString(), totalIssues: total, files }, null, 2);
  }
}