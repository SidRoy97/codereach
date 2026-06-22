import * as vscode from 'vscode';
import * as path from 'path';
import { CodeNode } from './CodeGraphTypes';

// A related symbol qualified by the file it is defined in.
export interface Relation {
  name: string;
  file: string;
}

// Path fragments that mark a relation as NOT part of this project: the
// TypeScript/JS standard library and bundled type declarations. The language
// server happily resolves calls like Map.set, Array.from, or String.replace to
// these .d.ts files, which is technically correct but pure noise in a
// project-understanding document. I match on the resolved path (which precise
// mode has but the heuristic never did), so I can drop these without touching
// the conservative name-based filter the heuristic still relies on.
const EXTERNAL_PATH_MARKERS = [
  '/typescript/lib/',   // bundled TS stdlib: lib.es2015.*.d.ts, lib.dom.d.ts, lib.es5.d.ts
  'node_modules/',      // any dependency, including @types/node and @types/vscode
  'lib.es',             // defensive: stdlib lib files even if the path shape differs
  'lib.dom',
];

// Single job: get ground-truth callers/callees for a symbol from the language
// server, using the same call-hierarchy data as "Show Call Hierarchy". This is
// the precise alternative to the name-and-receiver heuristic. It returns null
// when no language server can answer (extension missing, not yet indexed, or
// the symbol is unresolvable), so the caller can fall back to the heuristic.
//
// This is deliberately for the understanding document only: it is async and
// per-symbol (two server round-trips each), so it must never sit on a hot path
// like the live status bar.
export class PreciseRelationships {
  constructor(private readonly root: string) {}

  // Resolve one node. Returns ground-truth relations, or null if the language
  // server cannot answer for this symbol.
  async forNode(node: CodeNode): Promise<{ callers: Relation[]; callees: Relation[] } | null> {
    const uri = vscode.Uri.file(path.join(this.root, node.file));
    const position = new vscode.Position(node.line, node.nameColumn ?? 0);

    // Step 1: ask the language server to prepare a call-hierarchy item at the
    // symbol's name. If it returns nothing, no provider can resolve this here.
    const items = await this.prepare(uri, position);
    if (!items || items.length === 0) return null;

    const item = items[0];

    // Step 2: fetch incoming (callers) and outgoing (callees) calls in parallel.
    const [incoming, outgoing] = await Promise.all([
      this.incoming(item),
      this.outgoing(item),
    ]);

    // If both queries failed outright, signal a fallback. Empty-but-successful
    // results are valid (a symbol can legitimately have no callers/callees).
    if (incoming === null && outgoing === null) return null;

    // I drop standard-library and dependency targets here (see isExternal):
    // the language server resolves built-ins to .d.ts files, which are correct
    // but useless in a project document. This keeps the precise list scoped to
    // real project symbols, the same intent as the heuristic's name filter.
    return {
      callers: this.dedupe((incoming ?? []).map(c => this.toRelation(c.from)).filter(r => !this.isExternal(r))),
      callees: this.dedupe((outgoing ?? []).map(c => this.toRelation(c.to)).filter(r => !this.isExternal(r))),
    };
  }

  // True when a relation resolves to the standard library or a dependency,
  // rather than a file inside this project. I check the language server's
  // resolved path (before it is made workspace-relative) against known
  // external markers.
  private isExternal(rel: Relation): boolean {
    const p = rel.file.replace(/\\/g, '/');
    // After path.relative, files outside the workspace begin with "..", and
    // stdlib/dependency paths still carry their telltale fragments. Either is
    // enough to treat the target as external.
    if (p.startsWith('..')) return true;
    return EXTERNAL_PATH_MARKERS.some(marker => p.includes(marker));
  }

  // Convert a hierarchy item to our name+file shape, made workspace-relative so
  // it matches the rest of the document.
  private toRelation(item: vscode.CallHierarchyItem): Relation {
    const rel = path.relative(this.root, item.uri.fsPath);
    return { name: item.name, file: rel };
  }

  // Collapse duplicate name+file pairs (the same target reached via several
  // call sites appears once).
  private dedupe(relations: Relation[]): Relation[] {
    const seen = new Set<string>();
    const out: Relation[] = [];
    for (const r of relations) {
      const key = `${r.file}:${r.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
    }
    return out;
  }

  // The three command calls are each wrapped so a provider error never breaks
  // the whole document — it just degrades that symbol to the heuristic.
  private async prepare(uri: vscode.Uri, position: vscode.Position): Promise<vscode.CallHierarchyItem[] | null> {
    try {
      const items = await vscode.commands.executeCommand<vscode.CallHierarchyItem[]>(
        'vscode.prepareCallHierarchy', uri, position,
      );
      return items ?? null;
    } catch {
      return null;
    }
  }

  private async incoming(item: vscode.CallHierarchyItem): Promise<vscode.CallHierarchyIncomingCall[] | null> {
    try {
      const calls = await vscode.commands.executeCommand<vscode.CallHierarchyIncomingCall[]>(
        'vscode.provideIncomingCalls', item,
      );
      return calls ?? null;
    } catch {
      return null;
    }
  }

  private async outgoing(item: vscode.CallHierarchyItem): Promise<vscode.CallHierarchyOutgoingCall[] | null> {
    try {
      const calls = await vscode.commands.executeCommand<vscode.CallHierarchyOutgoingCall[]>(
        'vscode.provideOutgoingCalls', item,
      );
      return calls ?? null;
    } catch {
      return null;
    }
  }
}