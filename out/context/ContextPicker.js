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
exports.ContextPicker = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
// Single job: build the smallest possible AI context bundle for a request
class ContextPicker {
    constructor(symbols, blast, summaries) {
        this.symbols = symbols;
        this.blast = blast;
        this.summaries = summaries;
    }
    // Build full context for the active file + selected symbol
    // Use when asking AI to change a specific function
    async buildContext(editor) {
        const document = editor.document;
        const folders = vscode.workspace.workspaceFolders;
        if (!folders)
            return '';
        const root = folders[0].uri.fsPath;
        const rel = path.relative(root, document.uri.fsPath);
        // Get the word the cursor is on — or the selected text
        const selection = editor.selection;
        const selectedWord = selection.isEmpty
            ? document.getText(document.getWordRangeAtPosition(selection.active))
            : document.getText(selection);
        const parts = [];
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
                    if (included.has(sym.file))
                        continue;
                    included.add(sym.file);
                    try {
                        const uri = vscode.Uri.file(sym.fullPath);
                        const doc = await vscode.workspace.openTextDocument(uri);
                        parts.push(`// ═══ DEPENDENCY: ${sym.file} ═══`);
                        parts.push(doc.getText());
                        parts.push('');
                    }
                    catch { /* skip if file can't be read */ }
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
        }
        catch { /* blast radius optional — skip if not built yet */ }
        const content = parts.join('\n');
        const tokenEst = Math.round(content.length / 4);
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
    async buildLightContext() {
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
exports.ContextPicker = ContextPicker;
