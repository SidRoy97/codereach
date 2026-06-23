import * as vscode from 'vscode';
import { FileAnalysisResult, Issue } from './types';
import { IResultStore, IConfigProvider } from './interfaces';
import { StaticScanner }     from './scanners/StaticScanner';
import { ComplexityScanner } from './scanners/ComplexityScanner';
import { DuplicateScanner }  from './scanners/DuplicateScanner';
import { AiScanner }         from './scanners/AiScanner';

// Single job: coordinate the four scanners and persist the result
// Split into two phases: static (instant) and AI (background)
export class AnalysisOrchestrator implements vscode.Disposable {

  private timers    = new Map<string, NodeJS.Timeout>();
  private aiRunning = new Set<string>();

  constructor(
    private readonly store:      IResultStore,
    private readonly config:     IConfigProvider,
    private readonly static_:    StaticScanner,
    private readonly complexity: ComplexityScanner,
    private readonly duplicate:  DuplicateScanner,
    private readonly ai:         AiScanner,
    private readonly onComplete: (result: FileAnalysisResult) => void,
  ) {}

  async analyze(
    document:   vscode.TextDocument,
    debounceMs = 0,
  ): Promise<FileAnalysisResult | null> {
    if (!this.config.getLanguages().includes(document.languageId)) return null;
    if (document.uri.scheme !== 'file') return null;
    if (debounceMs > 0) return this.debounced(document, debounceMs);
    return this.runPhased(document);
  }

  // Phase 1: static rules → results shown immediately
  // Phase 2: AI → runs in background, merges when done
  private async runPhased(document: vscode.TextDocument): Promise<FileAnalysisResult> {

    // ── Phase 1: Static — instant ─────────────────────────────────────────
    const staticIssues: Issue[] = [];

    if (this.config.isStaticEnabled()) {
      staticIssues.push(...this.static_.scan(document));
    }

    staticIssues.push(...this.complexity.scan(document));

    const { issues: dupIssues, blocks } = this.duplicate.scanWithBlocks(document);
    staticIssues.push(...dupIssues);

    // Remove cross-ruleset duplicates before publishing
    // e.g. js:no-hardcoded-secret + react:hardcoded-secret on same line
    const cleanStatic = this.removeCrossRulesetDuplicates(
      staticIssues,
      document.languageId,
    );

    const staticResult: FileAnalysisResult = {
      uri:             document.uri,
      language:        document.languageId,
      issues:          this.deduplicate(cleanStatic),
      complexity:      this.complexity.getAverageComplexity(document),
      duplicateBlocks: blocks,
      analyzedAt:      new Date(),
    };

    // Publish immediately — user sees squiggles right away
    this.store.save(staticResult);
    this.onComplete(staticResult);

    // ── Phase 2: AI — background ──────────────────────────────────────────
    const key = document.uri.toString();

    if (this.config.isAiEnabled() && !this.aiRunning.has(key)) {
      this.aiRunning.add(key);
      this.runAiPhase(document, staticResult, blocks).finally(() => {
        this.aiRunning.delete(key);
      });
    }

    return staticResult;
  }

  // Run AI and merge its unique findings into existing static results
  private async runAiPhase(
    document:     vscode.TextDocument,
    staticResult: FileAnalysisResult,
    blocks:       FileAnalysisResult['duplicateBlocks'],
  ): Promise<void> {
    try {
      const aiIssues = await this.ai.scan(document);

      // Only keep AI issues that genuinely add new information
      const filtered = this.filterAiDuplicates(staticResult.issues, aiIssues);
      if (filtered.length === 0) return;

      const merged: FileAnalysisResult = {
        uri:             document.uri,
        language:        document.languageId,
        issues:          this.deduplicate([...staticResult.issues, ...filtered]),
        complexity:      staticResult.complexity,
        duplicateBlocks: blocks,
        analyzedAt:      new Date(),
      };

      // Only update if file is still open
      const stillOpen = vscode.workspace.textDocuments
        .some(d => d.uri.toString() === document.uri.toString());

      if (stillOpen) {
        this.store.save(merged);
        this.onComplete(merged);
      }
    } catch (e) {
      // AI failure never breaks static results
      console.error('CodeReach: AI phase error', e);
    }
  }

  // For .tsx/.jsx: React rules are more specific than JS rules
  // When both fire on the same line for the same category, keep React only
  private removeCrossRulesetDuplicates(
    issues:     Issue[],
    languageId: string,
  ): Issue[] {
    const isReact = ['javascriptreact', 'typescriptreact'].includes(languageId);
    if (!isReact) return issues;

    // Group issues by line + category
    const byLineCategory = new Map<string, Issue[]>();
    for (const issue of issues) {
      const key      = `${issue.line}:${issue.category}`;
      const existing = byLineCategory.get(key) ?? [];
      existing.push(issue);
      byLineCategory.set(key, existing);
    }

    const result: Issue[] = [];

    for (const [, group] of byLineCategory) {
      if (group.length === 1) {
        result.push(group[0]);
        continue;
      }

      // Multiple rules on same line+category — keep the most specific
      const reactRules = group.filter(i => i.rule?.startsWith('react:'));
      const jsRules    = group.filter(i => i.rule?.startsWith('js:'));
      const other      = group.filter(i =>
        !i.rule?.startsWith('react:') && !i.rule?.startsWith('js:')
      );

      // React > JS > other
      const winners = reactRules.length > 0 ? reactRules
        : jsRules.length > 0               ? jsRules
        : other;

      result.push(...winners);
    }

    return result;
  }

  // Drop AI issues that are already covered by a static rule
  // Uses ±5 line window and concept matching to handle approximate line numbers
  private filterAiDuplicates(staticIssues: Issue[], aiIssues: Issue[]): Issue[] {
    return aiIssues.filter(aiIssue => {
      const covered = staticIssues.some(staticIssue => {

        // Must be same category — a security and code-smell issue on the same
        // line are genuinely different issues, keep both
        if (staticIssue.category !== aiIssue.category) return false;

        // Check within a ±5 line window
        // AI models report approximate line numbers — the real issue could be
        // a few lines above or below where they point
        const lineDiff = Math.abs(staticIssue.line - aiIssue.line);
        if (lineDiff > 5) return false;

        // Very close lines (0-2): only need 1 shared keyword
        const staticWords = this.keyWords(staticIssue.message);
        const aiWords     = this.keyWords(aiIssue.message);
        const overlap     = staticWords.filter(w => aiWords.includes(w));

        if (lineDiff <= 2 && overlap.length >= 1) return true;

        // Further apart (3-5): need 2 shared keywords
        if (lineDiff <= 5 && overlap.length >= 2) return true;

        // Fallback: check if both messages describe the same root concept
        // Handles synonyms like "os.system" and "command injection"
        return this.sameRootConcept(staticIssue.message, aiIssue.message);
      });

      // Keep AI issue only if static rules didn't already catch it
      return !covered;
    });
  }

  // Check if two messages describe the same security/quality concept
  // Each group contains synonyms for one concept
  private sameRootConcept(msgA: string, msgB: string): boolean {
    const a = msgA.toLowerCase();
    const b = msgB.toLowerCase();

    const CONCEPT_GROUPS = [
      // Command injection variants
      ['os.system', 'command injection', 'subprocess', 'shell injection', 'arbitrary command', 'execute arbitrary'],
      // Hardcoded credentials
      ['hardcoded', 'hard-coded', 'plaintext', 'credentials', 'password', 'secret', 'api key', 'sensitive information'],
      // SQL injection
      ['sql injection', 'sql query', 'parameterized', 'string format', 'string concat', 'injection vulnerab'],
      // Exception handling
      ['bare except', 'broad exception', 'catch all', 'except clause', 'swallow', 'hide errors', 'too broad'],
      // XSS
      ['xss', 'innerhtml', 'dangerouslysetinnerhtml', 'cross-site scripting', 'sanitize'],
      // Eval / code execution
      ['eval', 'arbitrary code', 'code execution', 'dynamic code', 'new function'],
      // Weak crypto
      ['md5', 'sha1', 'weak hash', 'cryptographic', 'broken hash'],
      // Unsafe deserialization
      ['pickle', 'deserialization', 'untrusted data', 'arbitrary object'],
      // Path traversal
      ['path traversal', 'directory traversal', 'file path', 'user input'],
    ];

    for (const group of CONCEPT_GROUPS) {
      const aMatches = group.some(term => a.includes(term));
      const bMatches = group.some(term => b.includes(term));
      if (aMatches && bMatches) return true;
    }

    return false;
  }

  // Extract meaningful keywords — strip filler words
  private keyWords(message: string): string[] {
    const STOP = new Set([
      'a','an','the','is','are','in','on','at','to','for',
      'of','and','or','can','may','will','this','that','it',
      'be','with','not','if','use','used','using','found',
      'lead','leads','avoid','consider','instead','possible',
      'detected','should','never','always','when','which',
      'from','such','more','than','also','into','only',
      'code','system','result','return','call','make',
    ]);
    return message
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3 && !STOP.has(w));
  }

  // Final pass — remove exact same rule on same line
  private deduplicate(issues: Issue[]): Issue[] {
    const seen = new Set<string>();
    return issues.filter(i => {
      const key = `${i.line}:${i.rule}:${i.message.slice(0, 30)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private debounced(
    document: vscode.TextDocument,
    ms:       number,
  ): Promise<FileAnalysisResult | null> {
    const key = document.uri.toString();
    const old = this.timers.get(key);
    if (old) clearTimeout(old);

    return new Promise(resolve => {
      const timer = setTimeout(async () => {
        this.timers.delete(key);
        resolve(await this.runPhased(document));
      }, ms);
      this.timers.set(key, timer);
    });
  }

  dispose(): void {
    Array.from(this.timers.values()).forEach(t => clearTimeout(t));
  }
}