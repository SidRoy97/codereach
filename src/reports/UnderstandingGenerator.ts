import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { CodeGraph, CodeNode } from '../graph/CodeGraphTypes';
import { ImpactAnalyzer } from '../graph/ImpactAnalyzer';
import { PreciseRelationships } from '../graph/PreciseRelationships';
import { FileSummarizer } from '../context/FileSummarizer';
import { AiScanner } from '../scanners/AiScanner';

// One method inside a class, with its relationships from the graph.
// A related symbol: its name plus the file it is defined in. Qualifying by
// file removes the ambiguity of bare names (e.g. which "get" or "dispose"),
// which makes the relationships precise for both humans and LLMs.
interface Relation {
  name: string;
  file: string;
}

interface MethodEntry {
  name: string;
  summary: string;
  line: number;        // 1-based
  callers: Relation[]; // symbols that call this, qualified by file
  callees: Relation[]; // symbols this calls, qualified by file
}

// One top-level symbol in a file (function or class). Classes carry methods.
interface SymbolEntry {
  name: string;
  kind: 'function' | 'class' | 'method';
  summary: string;
  line: number;        // 1-based
  callers: Relation[];
  callees: Relation[];
  methods?: MethodEntry[];
}

// One file's understanding.
interface FileEntry {
  summary: string;
  symbols: SymbolEntry[];
}

// The whole document.
interface UnderstandingDoc {
  project: string;
  generated: string;
  globalContext: string;
  files: Record<string, FileEntry>;
}

// What the AI returns for one file: a map of symbol name -> short summary.
type AiSummaryMap = Record<string, string>;

const FILE_PROMPT =
  'You are documenting code for another AI to understand quickly. ' +
  'For each named symbol I list, write one concise sentence describing what it does and why it exists. ' +
  'Reply ONLY with a JSON object mapping each symbol name to its one-sentence summary. No prose, no code fences.';

const GLOBAL_PROMPT =
  'You are summarizing a software project for another AI. ' +
  'Given the list of files and their summaries, write one short paragraph (3-4 sentences) ' +
  'describing what the project is, its architecture, and how the pieces fit. Reply with plain text only.';

// Common built-in / global method names that are not project symbols. I drop
// these from callers/callees so the relationships only show real functions
// defined in this codebase, not standard-library calls like JSON.parse.
//
// I keep this list conservative: it only includes names that are almost never
// used as project method names (Array/Promise/JSON built-ins). Names like
// "get", "show", "clear", "add", "remove" are intentionally NOT filtered,
// because they are real method names in this project and filtering them would
// drop legitimate edges. The trade-off is that a few true built-in calls with
// those names may remain, which is the safer error.
const BUILTIN_NAMES = new Set([
  'parse', 'stringify',
  'push', 'pop', 'shift', 'unshift', 'map', 'filter', 'reduce', 'forEach',
  'find', 'some', 'every', 'sort', 'join', 'split', 'slice', 'splice',
  'concat', 'includes', 'indexOf', 'keys', 'values', 'entries',
  'then', 'catch', 'finally',
  'toString', 'valueOf', 'call', 'apply', 'bind',
]);

// Single job: build the structured code-understanding document. It reads the
// graph (for symbols + relationships) and the file summaries, asks the AI for
// a one-line summary per symbol (batched one call per file), and writes a
// nested JSON document an LLM can read to understand the whole codebase.
export class UnderstandingGenerator {
  constructor(
    private readonly getGraph: () => CodeGraph,
    private readonly summarizer: FileSummarizer,
    private readonly ai: AiScanner,
  ) {}

  async generate(): Promise<void> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
      vscode.window.showWarningMessage('CodeReach: No workspace open.');
      return;
    }

    const graph = this.getGraph();
    if (graph.nodes.length === 0) {
      vscode.window.showWarningMessage('CodeReach: No code symbols found to document.');
      return;
    }

    const analyzer = new ImpactAnalyzer(graph);

    // Opt-in precise mode: when enabled, resolve relationships from the
    // language server (ground truth) instead of the name-based heuristic. It is
    // slower and depends on the relevant language extension being installed, so
    // it is off by default and only ever used for this document.
    const usePrecise = vscode.workspace
      .getConfiguration('codereach')
      .get<boolean>('preciseRelationships', false);
    const precise = usePrecise ? new PreciseRelationships(root) : null;

    // Use file summaries only if they already exist in the cache. I do not
    // generate them here: the per-symbol pass below already summarizes every
    // symbol, and adding a second full AI pass for file-level summaries would
    // roughly double the compute (and the fan noise) for little extra value.
    const fileSummaries = this.summarizer.getSummaries();

    // Group nodes by file so each file becomes one AI call.
    const byFile = this.groupByFile(graph.nodes);

    const doc: UnderstandingDoc = {
      project: path.basename(root),
      generated: new Date().toISOString(),
      globalContext: '',
      files: {},
    };

    let aiReady = true;

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'CodeReach: Building understanding…', cancellable: true },
      async (progress, token) => {
        // Probe the AI first, inside the progress so the notification shows
        // immediately (a cold model load can take several seconds, and we don't
        // want the user staring at nothing while the fan spins).
        progress.report({ message: 'checking AI provider…' });
        aiReady = await this.probeAi();
        if (!aiReady) return;

        const files = Array.from(byFile.keys());

        for (let i = 0; i < files.length; i++) {
          if (token.isCancellationRequested) break;
          const file = files[i];
          const nodes = byFile.get(file)!;

          // Report before the call so the counter advances as each file starts.
          const detail = precise ? ' (precise)' : '';
          progress.report({ message: `summarizing file ${i + 1} of ${files.length}${detail}…`, increment: (1 / files.length) * 100 });

          const aiSummaries = await this.summarizeFileSymbols(root, file, nodes);
          doc.files[file] = await this.buildFileEntry(file, nodes, graph, analyzer, fileSummaries, aiSummaries, precise);
        }

        // Second pass: only retry the symbols the first pass could not
        // summarize (they still carry a structural fallback). The model
        // sometimes omits a few keys from its JSON; a focused retry usually
        // fills them in. This re-calls only the affected files — typically a
        // handful of symbols — so it adds very little extra load.
        if (token.isCancellationRequested) return;
        progress.report({ message: 'filling in any gaps…' });
        await this.retryFallbacks(root, byFile, doc, token, progress);

        // Final AI call: the project-wide paragraph. I keep it inside the
        // progress notification so the user always sees that work is happening
        // while the model runs — otherwise the fan spins with nothing on screen.
        if (token.isCancellationRequested) return;
        progress.report({ message: 'summarizing the whole project…' });
        doc.globalContext = await this.buildGlobalContext(doc);
      },
    );

    // If the probe failed, ask the user whether to continue with a
    // structure-only document (outside progress so the dialog is clear).
    if (!aiReady) {
      const choice = await vscode.window.showWarningMessage(
        'CodeReach: No AI response. The document will contain structure only, not AI summaries. ' +
        'For Ollama: install it, run "ollama pull llama3.2", and make sure "ollama serve" is running. ' +
        'You can also pick a different provider in Settings.',
        'Build structure-only', 'Cancel',
      );
      if (choice !== 'Build structure-only') return;

      // Build the document from structure alone — no AI calls.
      for (const [file, nodes] of byFile) {
        doc.files[file] = await this.buildFileEntry(file, nodes, graph, analyzer, fileSummaries, {}, precise);
      }
    }

    const outUri = vscode.Uri.file(path.join(root, 'codereach-understanding.json'));
    await vscode.workspace.fs.writeFile(outUri, Buffer.from(JSON.stringify(doc, null, 2), 'utf8'));

    const opened = await vscode.workspace.openTextDocument(outUri);
    await vscode.window.showTextDocument(opened);

    const symbolCount = Object.values(doc.files).reduce((n, f) => n + f.symbols.length, 0);
    vscode.window.showInformationMessage(
      `CodeReach: codereach-understanding.json written — ${symbolCount} symbol(s) across ${Object.keys(doc.files).length} file(s).`,
    );
  }

  // A tiny test call to see if the AI provider is reachable. Returns true
  // only when we get a non-empty reply.
  private async probeAi(): Promise<boolean> {
    try {
      const reply = await this.ai.generateText('Reply with the single word: ok', 'ping');
      return !!(reply && reply.trim());
    } catch {
      return false;
    }
  }

  // Group every node under its file path.
  private groupByFile(nodes: CodeNode[]): Map<string, CodeNode[]> {
    const map = new Map<string, CodeNode[]>();
    for (const node of nodes) {
      const list = map.get(node.file) ?? [];
      list.push(node);
      map.set(node.file, list);
    }
    return map;
  }

  // Ask the AI for one-line summaries of every symbol in one file, in a single
  // call. Returns an empty map if the AI is unavailable — callers then fall
  // back to a structural description.
  private async summarizeFileSymbols(root: string, file: string, nodes: CodeNode[]): Promise<AiSummaryMap> {
    let code = '';
    try {
      // I read a moderate slice of each file: enough that symbols lower in
      // the file still get good summaries, but not so much that each AI call
      // becomes very heavy. Very large files are still capped here.
      code = fs.readFileSync(path.join(root, file), 'utf8').slice(0, 9000);
    } catch {
      return {};
    }

    const symbolList = nodes.map(n => `${n.kind} ${n.name} (line ${n.line + 1})`).join('\n');
    const user = `File: ${file}\nSymbols:\n${symbolList}\n\nCode:\n\`\`\`\n${code}\n\`\`\``;

    try {
      const reply = await this.ai.generateText(FILE_PROMPT, user);
      if (!reply || !reply.trim()) return {};
      const cleaned = reply.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
      const parsed = JSON.parse(cleaned);
      return (parsed && typeof parsed === 'object') ? parsed as AiSummaryMap : {};
    } catch {
      return {};
    }
  }

  // Find symbols still carrying a fallback summary, retry just those (grouped
  // by file, only the missing names sent), and patch any real summaries back
  // into the doc. Mutates doc in place.
  private async retryFallbacks(
    root: string,
    byFile: Map<string, CodeNode[]>,
    doc: UnderstandingDoc,
    token: vscode.CancellationToken,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
  ): Promise<void> {
    // Collect the files that still have at least one unsummarized symbol, and
    // the set of names to retry within each.
    const filesToRetry: Array<{ file: string; names: Set<string> }> = [];
    for (const [file, entry] of Object.entries(doc.files)) {
      const missing = new Set<string>();
      for (const sym of entry.symbols) {
        if (this.isFallback(sym.summary)) missing.add(sym.name);
        for (const m of sym.methods ?? []) {
          if (this.isFallback(m.summary)) missing.add(m.name);
        }
      }
      if (missing.size > 0) filesToRetry.push({ file, names: missing });
    }

    if (filesToRetry.length === 0) return;

    for (let i = 0; i < filesToRetry.length; i++) {
      if (token.isCancellationRequested) return;
      const { file, names } = filesToRetry[i];
      const allNodes = byFile.get(file);
      if (!allNodes) continue;

      // Send only the still-missing symbols so the retry call is small.
      const missingNodes = allNodes.filter(n => names.has(n.name));
      const retry = await this.summarizeFileSymbols(root, file, missingNodes);

      // Patch only where the retry produced a real (non-empty) summary.
      const entry = doc.files[file];
      for (const sym of entry.symbols) {
        if (this.isFallback(sym.summary) && retry[sym.name]?.trim()) {
          sym.summary = retry[sym.name];
        }
        for (const m of sym.methods ?? []) {
          if (this.isFallback(m.summary) && retry[m.name]?.trim()) {
            m.summary = retry[m.name];
          }
        }
      }

      progress.report({ message: `retry ${i + 1}/${filesToRetry.length}` });
    }
  }

  // Assemble one file's entry: top-level functions and classes, with methods
  // nested under their class by file + line proximity.
  private async buildFileEntry(
    file: string,
    nodes: CodeNode[],
    graph: CodeGraph,
    analyzer: ImpactAnalyzer,
    fileSummaries: Map<string, string>,
    aiSummaries: AiSummaryMap,
    precise: PreciseRelationships | null,
  ): Promise<FileEntry> {
    const classes = nodes.filter(n => n.kind === 'class').sort((a, b) => a.line - b.line);
    const functions = nodes.filter(n => n.kind === 'function');
    const methods = nodes.filter(n => n.kind === 'method');

    const symbols: SymbolEntry[] = [];

    // Functions are standalone top-level symbols.
    for (const fn of functions) {
      symbols.push(await this.toSymbolEntry(fn, graph, analyzer, aiSummaries, precise));
    }

    // Classes own the methods that fall between this class and the next.
    for (let i = 0; i < classes.length; i++) {
      const cls = classes[i];
      const nextLine = i + 1 < classes.length ? classes[i + 1].line : Number.MAX_SAFE_INTEGER;
      const owned = methods.filter(m => m.line >= cls.line && m.line < nextLine);

      const entry = await this.toSymbolEntry(cls, graph, analyzer, aiSummaries, precise);
      const ownedSorted = owned.sort((a, b) => a.line - b.line);
      const methodEntries: MethodEntry[] = [];
      for (const m of ownedSorted) {
        const rel = await this.relationships(m, graph, analyzer, precise);
        methodEntries.push({
          name: m.name,
          summary: aiSummaries[m.name] ?? this.fallbackSummary(m),
          line: m.line + 1,
          callers: rel.callers,
          callees: rel.callees,
        });
      }
      entry.methods = methodEntries;
      symbols.push(entry);
    }

    return {
      summary: fileSummaries.get(file) ?? 'No file summary available — run Summarize Project Files.',
      symbols,
    };
  }

  // Turn a node into a symbol entry with its relationships and summary.
  private async toSymbolEntry(node: CodeNode, graph: CodeGraph, analyzer: ImpactAnalyzer, ai: AiSummaryMap, precise: PreciseRelationships | null): Promise<SymbolEntry> {
    const rel = await this.relationships(node, graph, analyzer, precise);
    return {
      name: node.name,
      kind: node.kind,
      summary: ai[node.name] ?? this.fallbackSummary(node),
      line: node.line + 1,
      callers: rel.callers,
      callees: rel.callees,
    };
  }

  // Caller and callee names for a node. When a precise resolver is supplied,
  // I ask the language server for ground-truth relationships and use them if it
  // can answer; otherwise (and when precise mode is off) I fall back to the
  // graph-based heuristic. I filter out built-in/global method names so the
  // relationships only list real symbols defined in this project.
  private async relationships(
    node: CodeNode,
    graph: CodeGraph,
    analyzer: ImpactAnalyzer,
    precise: PreciseRelationships | null,
  ): Promise<{ callers: Relation[]; callees: Relation[] }> {
    // Precise first: replace the heuristic entirely for this symbol when the
    // language server can resolve it. I still drop built-in names so the two
    // paths produce comparable, project-only lists.
    if (precise) {
      const result = await precise.forNode(node);
      if (result) {
        const filterBuiltins = (rels: Relation[]) => rels.filter(r => !BUILTIN_NAMES.has(r.name));
        return {
          callers: filterBuiltins(result.callers),
          callees: filterBuiltins(result.callees),
        };
      }
      // Fall through to the heuristic for this one symbol if the server could
      // not answer (extension missing, not indexed yet, or unresolvable).
    }

    // Drop built-in names, then collapse duplicates by name+file: several
    // different methods can share a name (e.g. five "dispose" methods in
    // different files); qualifying by file keeps the distinct ones and removes
    // exact repeats.
    const clean = (nodes: CodeNode[]): Relation[] => {
      const seen = new Set<string>();
      const out: Relation[] = [];
      for (const n of nodes) {
        if (BUILTIN_NAMES.has(n.name)) continue;
        const key = `${n.file}:${n.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ name: n.name, file: n.file });
      }
      return out;
    };

    const result = analyzer.analyze(node.id);
    if (result) {
      return {
        callers: clean(result.directCallers),
        callees: clean(result.directCallees),
      };
    }
    // Fallback to raw edge scan if analyze returns null.
    const callerNodes = graph.edges.filter(e => e.to === node.id)
      .map(e => graph.nodes.find(n => n.id === e.from)).filter((n): n is CodeNode => !!n);
    const calleeNodes = graph.edges.filter(e => e.from === node.id)
      .map(e => graph.nodes.find(n => n.id === e.to)).filter((n): n is CodeNode => !!n);
    return { callers: clean(callerNodes), callees: clean(calleeNodes) };
  }

  // A plain description used when the AI gives nothing, so the document is
  // always populated and useful even offline.
  private fallbackSummary(node: CodeNode): string {
    return `${node.kind} "${node.name}" defined in ${node.file} at line ${node.line + 1}.`;
  }

  // True when a summary is one of our structural fallbacks rather than a real
  // AI summary. I use this to find the few symbols a first pass missed so a
  // second pass can retry only those, not the whole project.
  private isFallback(summary: string): boolean {
    return / defined in .+ at line \d+\.$/.test(summary);
  }

  // One paragraph describing the whole project. Falls back to a file count
  // when the AI is unavailable.
  private async buildGlobalContext(doc: UnderstandingDoc): Promise<string> {
    const lines = Object.entries(doc.files)
      .map(([file, entry]) => `${file}: ${entry.summary}`)
      .join('\n');

    try {
      const reply = await this.ai.generateText(GLOBAL_PROMPT, lines);
      if (reply && reply.trim()) return reply.trim();
    } catch {
      // fall through
    }
    return `Project "${doc.project}" with ${Object.keys(doc.files).length} analyzed file(s). ` +
           `Run Summarize Project Files and ensure an AI provider is configured for richer context.`;
  }
}