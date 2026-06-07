"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.SymbolIndexer = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
// Patterns that detect symbol declarations per language
const SYMBOL_PATTERNS = {
    typescript: [
        /^\s*export\s+(?:default\s+)?class\s+(\w+)/, // class
        /^\s*export\s+(?:async\s+)?function\s+(\w+)/, // function
        /^\s*export\s+interface\s+(\w+)/, // interface
        /^\s*export\s+type\s+(\w+)/, // type alias
        /^\s*export\s+const\s+(\w+)\s*=/, // exported const
        /^\s*(?:public|private|protected)?\s*(?:async\s+)?(\w+)\s*\([^)]*\)\s*[:{]/, // method
    ],
    javascript: [
        /^\s*(?:export\s+)?(?:default\s+)?class\s+(\w+)/,
        /^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)/,
        /^\s*(?:export\s+)?const\s+(\w+)\s*=/,
        /^\s*(?:export\s+)?(?:async\s+)?(\w+)\s*\([^)]*\)\s*\{/,
    ],
    python: [
        /^\s*class\s+(\w+)/, // class
        /^\s*def\s+(\w+)/, // function or method
        /^\s*async\s+def\s+(\w+)/, // async function
    ],
    java: [
        /^\s*(?:public|private|protected)?\s*(?:static\s+)?class\s+(\w+)/,
        /^\s*(?:public|private|protected)?\s*(?:static\s+)?interface\s+(\w+)/,
        /^\s*(?:public|private|protected)?\s*(?:static\s+)?(?:\w+)\s+(\w+)\s*\([^)]*\)\s*(?:throws\s+\w+\s*)?\{/,
    ],
};
// Map file extension to language key
const EXT_TO_LANG = {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.py': 'python',
    '.java': 'java',
};
// Single job: scan workspace files and build a complete symbol map
class SymbolIndexer {
    constructor() {
        // Cached symbol list — rebuilt when files change
        this.symbols = [];
        this.lastIndexed = null;
    }
    // Build the full symbol index across the entire workspace
    async buildIndex() {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders)
            return [];
        const uris = await vscode.workspace.findFiles('**/*.{ts,tsx,js,jsx,py,java}', '{**/node_modules/**,**/dist/**,**/out/**}');
        this.symbols = [];
        for (const uri of uris) {
            const fileSymbols = await this.indexFile(uri, folders[0].uri.fsPath);
            this.symbols.push(...fileSymbols);
        }
        this.lastIndexed = new Date();
        return this.symbols;
    }
    // Get cached symbols — rebuild if never indexed or older than 5 minutes
    async getSymbols() {
        const stale = !this.lastIndexed ||
            (Date.now() - this.lastIndexed.getTime()) > 5 * 60 * 1000;
        if (stale || this.symbols.length === 0) {
            await this.buildIndex();
        }
        return this.symbols;
    }
    // Search symbols by name — used by the dashboard search box
    async search(query) {
        const all = await this.getSymbols();
        const q = query.toLowerCase();
        return all.filter(s => s.name.toLowerCase().includes(q));
    }
    // Re-index a single file when it changes — faster than full rebuild
    async reindexFile(uri) {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders)
            return;
        // Remove old symbols for this file
        const rel = vscode.workspace.asRelativePath(uri);
        this.symbols = this.symbols.filter(s => s.file !== rel);
        // Add fresh symbols for this file
        const fresh = await this.indexFile(uri, folders[0].uri.fsPath);
        this.symbols.push(...fresh);
    }
    // Format the symbol index as a compact string for pasting into AI
    formatForAi() {
        if (this.symbols.length === 0)
            return '// No symbols indexed yet. Run CodeSec: Build Symbol Index first.';
        // Group by file for readability
        const byFile = new Map();
        for (const sym of this.symbols) {
            const existing = byFile.get(sym.file) ?? [];
            existing.push(sym);
            byFile.set(sym.file, existing);
        }
        const lines = ['// SYMBOL INDEX — generated by CodeSec', ''];
        for (const [file, syms] of byFile) {
            lines.push(`// ${file}`);
            for (const s of syms) {
                lines.push(`${s.kind.padEnd(12)} ${s.name.padEnd(40)} L${s.line + 1}`);
            }
            lines.push('');
        }
        return lines.join('\n');
    }
    // Scan one file and extract all symbol declarations
    async indexFile(uri, rootPath) {
        const symbols = [];
        const ext = path.extname(uri.fsPath).toLowerCase();
        const lang = EXT_TO_LANG[ext];
        if (!lang)
            return [];
        const patterns = SYMBOL_PATTERNS[lang] ?? [];
        const rel = path.relative(rootPath, uri.fsPath);
        let document;
        try {
            document = await vscode.workspace.openTextDocument(uri);
        }
        catch {
            return [];
        }
        for (let i = 0; i < document.lineCount; i++) {
            const line = document.lineAt(i).text;
            for (const pattern of patterns) {
                const match = line.match(pattern);
                if (match && match[1] && match[1].length > 1) {
                    // Determine the kind from the matched line
                    const kind = this.detectKind(line);
                    symbols.push({
                        name: match[1],
                        kind,
                        file: rel,
                        line: i,
                        fullPath: uri.fsPath,
                    });
                    break; // Only one symbol per line
                }
            }
        }
        return symbols;
    }
    // Detect what kind of symbol a line declares
    detectKind(line) {
        if (/\bclass\b/.test(line))
            return 'class';
        if (/\binterface\b/.test(line))
            return 'interface';
        if (/\btype\b/.test(line))
            return 'type';
        if (/\bfunction\b/.test(line))
            return 'function';
        if (/\bdef\b/.test(line))
            return 'function';
        if (/\bconst\b/.test(line))
            return 'const';
        return 'method';
    }
}
exports.SymbolIndexer = SymbolIndexer;
