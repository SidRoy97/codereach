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
exports.BlastRadiusAnalyzer = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
// Single job: parse imports across the project and score blast radius
class BlastRadiusAnalyzer {
    constructor() {
        // Import graph: file → list of files it imports
        this.importGraph = new Map();
        this.lastBuilt = null;
    }
    // Build the full import graph for the workspace
    async buildGraph() {
        const uris = await vscode.workspace.findFiles('**/*.{ts,tsx,js,jsx,py,java}', '{**/node_modules/**,**/dist/**,**/out/**}');
        this.importGraph.clear();
        for (const uri of uris) {
            const folders = vscode.workspace.workspaceFolders;
            if (!folders)
                continue;
            const rel = path.relative(folders[0].uri.fsPath, uri.fsPath);
            const imports = await this.parseImports(uri, folders[0].uri.fsPath);
            this.importGraph.set(rel, imports);
        }
        this.lastBuilt = new Date();
    }
    // Get blast radius info for a specific file
    async getBlastRadius(uri) {
        // Rebuild if stale
        if (!this.lastBuilt || (Date.now() - this.lastBuilt.getTime()) > 5 * 60 * 1000) {
            await this.buildGraph();
        }
        const folders = vscode.workspace.workspaceFolders;
        const rel = folders ? path.relative(folders[0].uri.fsPath, uri.fsPath) : uri.fsPath;
        // Find all files that import this file (direct importers)
        const importedBy = [];
        for (const [file, imports] of this.importGraph) {
            if (imports.some(i => this.pathsMatch(i, rel))) {
                importedBy.push(file);
            }
        }
        // Calculate total blast radius — files that transitively depend on this file
        const blastRadius = this.calculateTransitiveImpact(rel);
        return {
            file: rel,
            imports: this.importGraph.get(rel) ?? [],
            importedBy,
            blastRadius,
        };
    }
    // Format blast radius as a short status bar message
    formatStatusBar(node) {
        if (node.blastRadius === 0)
            return '$(check) CodeSec: No dependents';
        if (node.blastRadius <= 3)
            return `$(info) CodeSec: Low impact (${node.blastRadius} files)`;
        if (node.blastRadius <= 8)
            return `$(warning) CodeSec: Medium impact (${node.blastRadius} files)`;
        return `$(error) CodeSec: HIGH impact — ${node.blastRadius} files depend on this`;
    }
    // Format blast radius as a detailed AI context block
    formatForAi(node) {
        const lines = [
            `// BLAST RADIUS ANALYSIS — ${node.file}`,
            `// Changing this file affects ${node.blastRadius} other file(s)`,
            '',
            '// Direct importers (check these after any change):',
            ...node.importedBy.map(f => `//   → ${f}`),
            '',
            '// This file imports:',
            ...node.imports.map(f => `//   ← ${f}`),
        ];
        return lines.join('\n');
    }
    // Count all files that transitively depend on this file
    calculateTransitiveImpact(file) {
        const affected = new Set();
        const queue = [file];
        while (queue.length > 0) {
            const current = queue.shift();
            for (const [f, imports] of this.importGraph) {
                if (!affected.has(f) && imports.some(i => this.pathsMatch(i, current))) {
                    affected.add(f);
                    queue.push(f);
                }
            }
        }
        return affected.size;
    }
    // Parse import/require statements from a file
    async parseImports(uri, rootPath) {
        let document;
        try {
            document = await vscode.workspace.openTextDocument(uri);
        }
        catch {
            return [];
        }
        const imports = [];
        const ext = path.extname(uri.fsPath).toLowerCase();
        for (let i = 0; i < document.lineCount; i++) {
            const line = document.lineAt(i).text;
            // TypeScript/JavaScript: import ... from '...' or require('...')
            if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
                const match = line.match(/(?:import|from)\s+['"]([^'"]+)['"]/) ??
                    line.match(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/);
                if (match) {
                    const resolved = this.resolveImport(match[1], uri.fsPath, rootPath);
                    if (resolved)
                        imports.push(resolved);
                }
            }
            // Python: import x or from x import y
            if (ext === '.py') {
                const match = line.match(/^from\s+([\w.]+)\s+import/) ??
                    line.match(/^import\s+([\w.]+)/);
                if (match)
                    imports.push(match[1].replace(/\./g, '/') + '.py');
            }
            // Java: import com.example.Class
            if (ext === '.java') {
                const match = line.match(/^import\s+([\w.]+);/);
                if (match)
                    imports.push(match[1].replace(/\./g, '/') + '.java');
            }
        }
        return imports;
    }
    // Resolve a relative import path to a project-relative path
    resolveImport(importPath, fromFile, rootPath) {
        // Skip node_modules and absolute imports
        if (!importPath.startsWith('.'))
            return null;
        const dir = path.dirname(fromFile);
        const resolved = path.resolve(dir, importPath);
        const rel = path.relative(rootPath, resolved);
        // Add .ts extension if missing
        if (!path.extname(rel))
            return rel + '.ts';
        return rel;
    }
    // Check if two paths refer to the same file (handle missing extensions)
    pathsMatch(importPath, filePath) {
        const a = importPath.replace(/\\/g, '/').replace(/\.ts$|\.js$/, '');
        const b = filePath.replace(/\\/g, '/').replace(/\.ts$|\.js$/, '');
        return a === b || a === b.replace(/\/index$/, '');
    }
}
exports.BlastRadiusAnalyzer = BlastRadiusAnalyzer;
