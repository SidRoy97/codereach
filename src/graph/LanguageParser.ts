import * as vscode from 'vscode';
import * as path from 'path';
import { Parser, Language, Node } from 'web-tree-sitter';

// A symbol declaration found by parsing — function, class, or method.
export interface ParsedSymbol {
  name: string;
  kind: 'function' | 'class' | 'method';
  line: number;
}

// A call expression found by parsing — "this code calls something named X".
export interface ParsedCall {
  // The name being called, e.g. "validateToken".
  calleeName: string;
  // The receiver the call was made on, if any: for `store.get()` this is
  // "store"; for `this.foo()` it is "this"; for a plain `foo()` it is null.
  // This lets the graph builder resolve which symbol a common name refers to
  // instead of matching every symbol with that name.
  receiver: string | null;
  // Line where the call happens.
  line: number;
}

// The raw result of parsing one file: what it declares and what it calls.
export interface ParseResult {
  symbols: ParsedSymbol[];
  calls: ParsedCall[];
}

// Maps a VS Code language id to its grammar file name.
// JavaScript and TypeScript are separate grammars but both are loaded.
const GRAMMAR_FILES: Record<string, string> = {
  javascript:      'tree-sitter-javascript.wasm',
  javascriptreact: 'tree-sitter-javascript.wasm',
  typescript:      'tree-sitter-typescript.wasm',
  typescriptreact: 'tree-sitter-tsx.wasm',
  python:          'tree-sitter-python.wasm',
  java:            'tree-sitter-java.wasm',
};

// Tree-sitter node types that declare a function/class/method, per language.
// Kept tiny on purpose — only the declarations v1 needs.
const DECLARATION_TYPES: Record<string, Record<string, ParsedSymbol['kind']>> = {
  javascript: {
    function_declaration: 'function',
    method_definition:    'method',
    class_declaration:    'class',
  },
  typescript: {
    function_declaration: 'function',
    method_definition:    'method',
    class_declaration:    'class',
  },
  python: {
    function_definition: 'function',
    class_definition:    'class',
  },
  java: {
    method_declaration: 'method',
    class_declaration:  'class',
  },
};

// Tree-sitter node types that represent a call expression, per language.
const CALL_TYPES: Record<string, string> = {
  javascript: 'call_expression',
  typescript: 'call_expression',
  python:     'call',
  java:       'method_invocation',
};

// Single job: turn file text into raw symbols and calls using Tree-sitter.
// This is the only file aware of Tree-sitter. Security note: Tree-sitter
// parses in-process via WebAssembly — it runs no shell and makes no network
// calls, so there is no command-injection surface here. Do not add any
// exec/spawn/fetch logic to this file.
export class LanguageParser {
  // One Tree-sitter Language object per grammar, loaded lazily and cached.
  private languages = new Map<string, Language>();
  private parser?: Parser;
  private ready = false;

  constructor(private readonly extensionPath: string) {}

  // Initialise the Tree-sitter runtime once. Safe to call repeatedly.
  async init(): Promise<void> {
    if (this.ready) return;
    await Parser.init();
    this.parser = new Parser();
    this.ready = true;
  }

  // Returns the base grammar key (javascript/typescript/python/java)
  // for a VS Code language id, or undefined if unsupported.
  private grammarKey(languageId: string): string | undefined {
    if (languageId === 'javascriptreact') return 'javascript';
    if (languageId === 'typescriptreact') return 'typescript';
    if (GRAMMAR_FILES[languageId]) return languageId;
    return undefined;
  }

  // Load and cache the grammar for a language id. Returns null if unsupported.
  private async loadLanguage(languageId: string): Promise<Language | null> {
    const file = GRAMMAR_FILES[languageId];
    if (!file) return null;

    if (this.languages.has(file)) {
      return this.languages.get(file)!;
    }

    const wasmPath = path.join(this.extensionPath, 'media', 'grammars', file);
    const lang = await Language.load(wasmPath);
    this.languages.set(file, lang);
    return lang;
  }

  // Parse one document into raw symbols and calls.
  // Returns empty arrays for unsupported languages — never throws on those.
  async parse(document: vscode.TextDocument): Promise<ParseResult> {
    await this.init();

    const grammar = this.grammarKey(document.languageId);
    if (!grammar || !this.parser) {
      return { symbols: [], calls: [] };
    }

    const lang = await this.loadLanguage(document.languageId);
    if (!lang) return { symbols: [], calls: [] };

    this.parser.setLanguage(lang);
    const tree = this.parser.parse(document.getText());
    if (!tree) return { symbols: [], calls: [] };

    const declTypes = DECLARATION_TYPES[grammar] ?? {};
    const callType  = CALL_TYPES[grammar];

    const symbols: ParsedSymbol[] = [];
    const calls: ParsedCall[] = [];

    // Walk the syntax tree once, collecting declarations and calls.
    this.walk(tree.rootNode, node => {
      const kind = declTypes[node.type];
      if (kind) {
        const name = this.readName(node);
        if (name) {
          symbols.push({ name, kind, line: node.startPosition.row });
        }
      }

      if (node.type === callType) {
        const callee = this.readCallee(node);
        if (callee) {
          calls.push({ calleeName: callee.name, receiver: callee.receiver, line: node.startPosition.row });
        }
      }
    });

    return { symbols, calls };
  }

  // Depth-first walk over the syntax tree, calling `visit` on each node.
  private walk(node: Node, visit: (n: Node) => void): void {
    visit(node);
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) this.walk(child, visit);
    }
  }

  // Read the declared name of a function/class/method node.
  // Tree-sitter exposes it as a child field called "name".
  private readName(node: Node): string | null {
    const nameNode = node.childForFieldName('name');
    return nameNode ? nameNode.text : null;
  }

  // Read the name being called and its receiver from a call expression.
  // Handles plain calls (foo() → name "foo", receiver null) and member calls
  // (obj.foo() → name "foo", receiver "obj"; this.foo() → receiver "this").
  // For chained access (a.b.foo()) the receiver is the segment just before the
  // method ("b"), which is the most useful part for resolution.
  private readCallee(node: Node): { name: string; receiver: string | null } | null {
    const fnNode = node.childForFieldName('function')
      ?? node.childForFieldName('name');
    if (!fnNode) return null;

    const text = fnNode.text;
    const lastDot = text.lastIndexOf('.');
    if (lastDot < 0) {
      return { name: text, receiver: null };
    }

    const name = text.slice(lastDot + 1);
    // The receiver is the segment immediately before the method name. For
    // "this.store.get" that is "store"; for "this.foo" it is "this".
    const beforeDot = text.slice(0, lastDot);
    const prevDot = beforeDot.lastIndexOf('.');
    const receiver = prevDot >= 0 ? beforeDot.slice(prevDot + 1) : beforeDot;
    return { name, receiver: receiver || null };
  }
}