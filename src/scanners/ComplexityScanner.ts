import * as vscode from 'vscode';
import { Issue } from '../types';
import { IScanner, IConfigProvider } from '../interfaces';
import { LanguageParser } from '../graph/LanguageParser';
import { scoreFunctions, FunctionScore } from '../graph/ComplexityCore';

interface FileScore {
  version: number;
  issues:  Issue[];
  average: number;
}

// I turn per-function complexity scores into issues for the current file.
export class ComplexityScanner implements IScanner {
  readonly name = 'ComplexityScanner';

  private cache = new Map<string, FileScore>();

  constructor(
    private readonly config: IConfigProvider,
    private readonly parser: LanguageParser,
  ) {}

  // I return one issue per function that scores above the configured threshold.
  async scan(document: vscode.TextDocument): Promise<Issue[]> {
    return (await this.measure(document)).issues;
  }

  // I return the average complexity across every function in the file.
  async getAverageComplexity(document: vscode.TextDocument): Promise<number> {
    return (await this.measure(document)).average;
  }

  // I parse the file once, score every function, and cache the result per edit.
  private async measure(document: vscode.TextDocument): Promise<FileScore> {
    const key    = document.uri.toString();
    const cached = this.cache.get(key);
    if (cached && cached.version === document.version) return cached;

    const tree = await this.parseSafely(document);
    const scores = tree ? scoreFunctions(tree.root, tree.grammar) : [];

    const threshold = this.config.getComplexityThreshold();
    const issues    = scores.filter(fn => fn.score > threshold).map(fn => this.toIssue(fn, threshold));
    const average   = this.averageOf(scores);

    return this.remember(key, { version: document.version, issues, average });
  }

  // I parse the document and swallow any parser error into a null result.
  private async parseSafely(document: vscode.TextDocument) {
    try {
      return await this.parser.parseTree(document);
    } catch {
      return null;
    }
  }

  // I turn one over-threshold function into a reportable issue.
  private toIssue(fn: FunctionScore, threshold: number): Issue {
    return {
      id:         `complexity:${fn.line}:${fn.name}`,
      line:       fn.line,
      column:     fn.column,
      message:    `Function "${fn.name}" has cyclomatic complexity ${fn.score} (threshold ${threshold}).`,
      severity:   fn.score > threshold * 2 ? 'error' : 'warning',
      category:   'complexity',
      rule:       'complexity:cyclomatic',
      suggestion: 'Break this into smaller focused functions; each branch is a path to test.',
      source:     'static',
    };
  }

  // I average the scores, returning zero when the file has no functions.
  private averageOf(scores: FunctionScore[]): number {
    if (scores.length === 0) return 0;
    const total = scores.reduce((sum, fn) => sum + fn.score, 0);
    return Math.round(total / scores.length);
  }

  // I store a result under its file key and hand the same result back.
  private remember(key: string, result: FileScore): FileScore {
    this.cache.set(key, result);
    return result;
  }
}
