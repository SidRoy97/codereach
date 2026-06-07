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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
// Analysis pipeline
const ConfigManager_1 = require("./config/ConfigManager");
const ResultStore_1 = require("./ResultStore");
const StaticScanner_1 = require("./scanners/StaticScanner");
const ComplexityScanner_1 = require("./scanners/ComplexityScanner");
const DuplicateScanner_1 = require("./scanners/DuplicateScanner");
const AiScanner_1 = require("./scanners/AiScanner");
const AnalysisOrchestrator_1 = require("./AnalysisOrchestrator");
// UI publishers
const DiagnosticsPublisher_1 = require("./publishers/DiagnosticsPublisher");
const StatusBarManager_1 = require("./publishers/StatusBarManager");
// Providers
const DashboardProvider_1 = require("./providers/DashboardProvider");
const CodeActionsProvider_1 = require("./providers/CodeActionsProvider");
// Context features
const SymbolIndexer_1 = require("./context/SymbolIndexer");
const BlastRadiusAnalyzer_1 = require("./context/BlastRadiusAnalyzer");
const FileSummarizer_1 = require("./context/FileSummarizer");
const ContextPicker_1 = require("./context/ContextPicker");
const AiContextGenerator_1 = require("./context/AiContextGenerator");
function activate(context) {
    console.log('CodeSec: activating…');
    try {
        activateInternal(context);
        console.log('CodeSec: activated successfully');
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('CodeSec: activation failed —', msg);
        vscode.window.showErrorMessage(`CodeSec failed to start: ${msg}`);
    }
}
function activateInternal(context) {
    // ── Analysis pipeline ─────────────────────────────────────────────────────
    const config = new ConfigManager_1.ConfigManager();
    const store = new ResultStore_1.ResultStore();
    const static_ = new StaticScanner_1.StaticScanner();
    const complexity = new ComplexityScanner_1.ComplexityScanner(config);
    const duplicate = new DuplicateScanner_1.DuplicateScanner(config);
    const ai = new AiScanner_1.AiScanner(config);
    const diagPub = new DiagnosticsPublisher_1.DiagnosticsPublisher();
    const statusBar = new StatusBarManager_1.StatusBarManager(store);
    const dashboard = new DashboardProvider_1.DashboardProvider(store);
    // Called after every analysis — update all three UI surfaces
    const onComplete = (result) => {
        try {
            diagPub.present(result);
        }
        catch (e) {
            console.error('CodeSec diagPub error', e);
        }
        try {
            statusBar.render();
        }
        catch (e) {
            console.error('CodeSec statusBar error', e);
        }
        try {
            dashboard.refresh();
        }
        catch (e) {
            console.error('CodeSec dashboard error', e);
        }
    };
    const orchestrator = new AnalysisOrchestrator_1.AnalysisOrchestrator(store, config, static_, complexity, duplicate, ai, onComplete);
    const codeActions = new CodeActionsProvider_1.CodeActionsProvider(store, ai);
    // ── Context features ──────────────────────────────────────────────────────
    const symbolIndexer = new SymbolIndexer_1.SymbolIndexer();
    const blastAnalyzer = new BlastRadiusAnalyzer_1.BlastRadiusAnalyzer();
    const fileSummarizer = new FileSummarizer_1.FileSummarizer(ai, context);
    const contextPicker = new ContextPicker_1.ContextPicker(symbolIndexer, blastAnalyzer, fileSummarizer);
    const aiContextGen = new AiContextGenerator_1.AiContextGenerator(symbolIndexer, blastAnalyzer, fileSummarizer);
    // Second status bar item showing blast radius of the active file
    const blastBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
    blastBar.command = 'codeSec.showBlastRadius';
    blastBar.tooltip = 'Click to see which files depend on this one';
    context.subscriptions.push(blastBar);
    // ── Register providers ────────────────────────────────────────────────────
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(DashboardProvider_1.DashboardProvider.viewId, dashboard));
    context.subscriptions.push(vscode.languages.registerCodeActionsProvider([
        { language: 'javascript' },
        { language: 'typescript' },
        { language: 'javascriptreact' },
        { language: 'typescriptreact' },
        { language: 'python' },
        { language: 'java' },
    ], codeActions, { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix, vscode.CodeActionKind.Empty] }));
    // ── Helper: analyze a document and update blast bar ───────────────────────
    // Single function used by all triggers so the logic is never duplicated
    const analyzeAndUpdateBlast = async (document, debounceMs = 0) => {
        // Only analyze real files in supported languages
        if (document.uri.scheme !== 'file')
            return;
        if (!isSupportedLanguage(document.languageId))
            return;
        try {
            await orchestrator.analyze(document, debounceMs);
        }
        catch (e) {
            console.error('CodeSec analysis error', e);
        }
    };
    // Update the blast radius status bar for the currently visible file
    const updateBlastBar = async (document) => {
        if (document.uri.scheme !== 'file') {
            blastBar.hide();
            return;
        }
        try {
            const node = await blastAnalyzer.getBlastRadius(document.uri);
            if (node.blastRadius === 0) {
                blastBar.text = '$(check) No dependents';
                blastBar.backgroundColor = undefined;
                blastBar.tooltip = 'No files import this one';
            }
            else if (node.blastRadius <= 3) {
                blastBar.text = `$(info) ${node.blastRadius} dependent(s)`;
                blastBar.backgroundColor = undefined;
                blastBar.tooltip = `${node.blastRadius} file(s) import this — click to see which`;
            }
            else if (node.blastRadius <= 8) {
                blastBar.text = `$(warning) ${node.blastRadius} dependents`;
                blastBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
                blastBar.tooltip = `Medium blast radius — ${node.blastRadius} files depend on this`;
            }
            else {
                blastBar.text = `$(error) HIGH: ${node.blastRadius} dependents`;
                blastBar.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
                blastBar.tooltip = `High blast radius — ${node.blastRadius} files depend on this`;
            }
            blastBar.show();
        }
        catch {
            // Graph not built yet — hide silently
            blastBar.text = '';
            blastBar.hide();
        }
    };
    // ── Analysis commands ─────────────────────────────────────────────────────
    // Manually analyze the active file — shows a progress notification
    context.subscriptions.push(vscode.commands.registerCommand('codeSec.analyzeFile', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('CodeSec: Open a file first.');
            return;
        }
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'CodeSec: Analyzing…', cancellable: false }, async () => {
            try {
                const result = await orchestrator.analyze(editor.document);
                if (!result) {
                    vscode.window.showInformationMessage(`CodeSec: ${editor.document.languageId} is not a supported language.`);
                    return;
                }
                const n = result.issues.length;
                const file = vscode.workspace.asRelativePath(editor.document.uri);
                vscode.window.showInformationMessage(n === 0
                    ? `CodeSec: ✅ No issues in ${file}`
                    : `CodeSec: ${n} issue(s) found in ${file}`);
            }
            catch (e) {
                vscode.window.showErrorMessage(`CodeSec: Analysis failed — ${e}`);
            }
        });
    }));
    // Scan every supported file in the workspace
    context.subscriptions.push(vscode.commands.registerCommand('codeSec.analyzeWorkspace', async () => {
        const exts = config.getLanguages().flatMap(langToExts).join(',');
        const uris = await vscode.workspace.findFiles(`**/*.{${exts}}`, '{**/node_modules/**,**/dist/**,**/out/**}');
        if (!uris.length) {
            vscode.window.showWarningMessage('CodeSec: No supported files found in workspace.');
            return;
        }
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `CodeSec: Scanning ${uris.length} files…`,
            cancellable: true,
        }, async (progress, token) => {
            for (let i = 0; i < uris.length; i++) {
                if (token.isCancellationRequested)
                    break;
                try {
                    const doc = await vscode.workspace.openTextDocument(uris[i]);
                    await orchestrator.analyze(doc);
                }
                catch { /* skip unreadable files */ }
                progress.report({
                    message: `${i + 1}/${uris.length}`,
                    increment: (1 / uris.length) * 100,
                });
            }
            const total = store.getAll().reduce((n, r) => n + r.issues.length, 0);
            vscode.window.showInformationMessage(`CodeSec: Done — ${total} issue(s) across ${store.getAll().length} files`);
        });
    }));
    context.subscriptions.push(vscode.commands.registerCommand('codeSec.clearIssues', () => {
        store.clear();
        diagPub.clearAll();
        statusBar.render();
        dashboard.refresh();
        vscode.window.showInformationMessage('CodeSec: All issues cleared.');
    }));
    context.subscriptions.push(vscode.commands.registerCommand('codeSec.openDashboard', () => {
        vscode.commands.executeCommand('workbench.view.extension.codeSec');
    }));
    context.subscriptions.push(vscode.commands.registerCommand('codeSec.generateConfig', () => {
        generateProjectConfig();
    }));
    // ── Context commands ──────────────────────────────────────────────────────
    context.subscriptions.push(vscode.commands.registerCommand('codeSec.buildSymbolIndex', async () => {
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'CodeSec: Building symbol index…', cancellable: false }, async () => {
            try {
                const symbols = await symbolIndexer.buildIndex();
                vscode.window.showInformationMessage(`CodeSec: Indexed ${symbols.length} symbols.`);
            }
            catch (e) {
                vscode.window.showErrorMessage(`CodeSec: Symbol index failed — ${e}`);
            }
        });
    }));
    context.subscriptions.push(vscode.commands.registerCommand('codeSec.copyAiContext', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('CodeSec: Open a file first.');
            return;
        }
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'CodeSec: Building context…', cancellable: false }, async () => {
            try {
                const text = await contextPicker.buildContext(editor);
                await vscode.env.clipboard.writeText(text);
                const tokens = Math.round(text.length / 4);
                vscode.window.showInformationMessage(`CodeSec: Context copied (~${tokens} tokens). Paste into any AI tool.`);
            }
            catch (e) {
                vscode.window.showErrorMessage(`CodeSec: Context build failed — ${e}`);
            }
        });
    }));
    context.subscriptions.push(vscode.commands.registerCommand('codeSec.copyLightContext', async () => {
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'CodeSec: Building light context…', cancellable: false }, async () => {
            try {
                const text = await contextPicker.buildLightContext();
                await vscode.env.clipboard.writeText(text);
                const tokens = Math.round(text.length / 4);
                vscode.window.showInformationMessage(`CodeSec: Light context copied (~${tokens} tokens).`);
            }
            catch (e) {
                vscode.window.showErrorMessage(`CodeSec: Light context failed — ${e}`);
            }
        });
    }));
    context.subscriptions.push(vscode.commands.registerCommand('codeSec.showBlastRadius', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('CodeSec: Open a file first.');
            return;
        }
        try {
            const node = await blastAnalyzer.getBlastRadius(editor.document.uri);
            const rel = vscode.workspace.asRelativePath(editor.document.uri);
            if (node.blastRadius === 0) {
                vscode.window.showInformationMessage(`CodeSec: "${path.basename(rel)}" has no dependents — safe to change freely.`);
                return;
            }
            const items = [
                {
                    label: `$(warning) ${node.blastRadius} file(s) depend on ${path.basename(rel)}`,
                    description: 'select a file below to open it',
                    file: '',
                },
                ...node.importedBy.map(f => ({
                    label: `$(file) ${f}`,
                    description: 'imports this file',
                    file: f,
                })),
            ];
            const pick = await vscode.window.showQuickPick(items, {
                title: `Blast Radius: ${rel}`,
                placeHolder: 'Select a dependent file to open it',
            });
            if (pick?.file) {
                const folders = vscode.workspace.workspaceFolders;
                if (!folders)
                    return;
                try {
                    const fullPath = path.join(folders[0].uri.fsPath, pick.file);
                    const doc = await vscode.workspace.openTextDocument(fullPath);
                    await vscode.window.showTextDocument(doc);
                }
                catch {
                    vscode.window.showWarningMessage(`CodeSec: Could not open ${pick.file}`);
                }
            }
        }
        catch (e) {
            vscode.window.showErrorMessage(`CodeSec: Blast radius failed — ${e}`);
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('codeSec.generateAiContext', async () => {
        try {
            await aiContextGen.generate();
        }
        catch (e) {
            vscode.window.showErrorMessage(`CodeSec: AI context generation failed — ${e}`);
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('codeSec.summarizeFiles', async () => {
        try {
            await fileSummarizer.summarizeWorkspace();
        }
        catch (e) {
            vscode.window.showErrorMessage(`CodeSec: File summarization failed — ${e}`);
        }
    }));
    // ── Event listeners ───────────────────────────────────────────────────────
    // Trigger 1: file is saved — full analysis including AI
    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(async (doc) => {
        if (config.shouldAnalyzeOnSave()) {
            await analyzeAndUpdateBlast(doc);
        }
        // Re-index symbols so the index stays current after changes
        try {
            await symbolIndexer.reindexFile(doc.uri);
        }
        catch { /* non-critical */ }
    }));
    // Trigger 2: user is typing — static rules only, debounced 1.5s
    // AI is skipped here to avoid hammering the model on every keystroke
    context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(async (e) => {
        if (e.contentChanges.length === 0)
            return;
        await analyzeAndUpdateBlast(e.document, 1500);
    }));
    // Trigger 3: a document is opened (tab opened, file dragged in, etc.)
    // This is the key fix — fires immediately when any file becomes available
    context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(async (doc) => {
        // Small delay so VS Code finishes rendering the editor before we run
        setTimeout(async () => {
            await analyzeAndUpdateBlast(doc);
        }, 300);
    }));
    // Trigger 4: user switches to a different editor tab
    // Updates both analysis and blast bar for the newly focused file
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(async (editor) => {
        if (!editor) {
            blastBar.hide();
            return;
        }
        // Run analysis on the newly focused file
        await analyzeAndUpdateBlast(editor.document);
        // Update blast radius bar for this file
        await updateBlastBar(editor.document);
    }));
    // Trigger 5: new editor groups opened (split view, etc.)
    // Ensures all panes analyze their file, not just the focused one
    context.subscriptions.push(vscode.window.onDidChangeVisibleTextEditors(async (editors) => {
        for (const editor of editors) {
            // Only analyze files we haven't seen yet — avoid re-running on already-analyzed files
            const existing = store.get(editor.document.uri);
            if (!existing) {
                await analyzeAndUpdateBlast(editor.document);
            }
        }
    }));
    // Trigger 6: file is closed — remove stale results
    context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(doc => {
        try {
            store.remove(doc.uri);
            diagPub.clear(doc.uri);
            statusBar.render();
            dashboard.refresh();
        }
        catch { /* non-critical */ }
    }));
    // ── Startup: analyze everything already open ──────────────────────────────
    // Analyze all files visible when the extension first loads
    // This covers the case where VS Code restores the previous session with open tabs
    const analyzeAllVisible = async () => {
        const editors = vscode.window.visibleTextEditors;
        if (editors.length === 0)
            return;
        // Analyze all open editors in parallel — each has its own debounce
        await Promise.all(editors.map(editor => analyzeAndUpdateBlast(editor.document).catch(() => { })));
        // Update blast bar for the currently active file
        const active = vscode.window.activeTextEditor;
        if (active) {
            await updateBlastBar(active.document);
        }
    };
    // Small delay on startup — let VS Code finish initializing before we start analyzing
    setTimeout(() => {
        analyzeAllVisible().catch(() => { });
    }, 100);
    // Build symbol index silently in background after startup
    // 3s delay so we don't compete with the initial analysis
    setTimeout(() => {
        symbolIndexer.buildIndex().catch(() => { });
    }, 2000);
    // Register everything for cleanup on deactivation
    context.subscriptions.push(diagPub, statusBar, dashboard, codeActions, orchestrator);
}
function deactivate() {
    console.log('CodeSec: deactivated');
}
// Check if a language ID is one we support
function isSupportedLanguage(languageId) {
    const supported = new Set([
        'javascript', 'typescript',
        'javascriptreact', 'typescriptreact',
        'python', 'java',
    ]);
    return supported.has(languageId);
}
// Map VS Code language IDs to file extensions for workspace scan globs
function langToExts(lang) {
    const map = {
        javascript: ['js', 'mjs'],
        javascriptreact: ['jsx'],
        typescript: ['ts'],
        typescriptreact: ['tsx'],
        python: ['py'],
        java: ['java'],
    };
    return map[lang] ?? [lang];
}
// Write a starter .codesec.json to the workspace root
async function generateProjectConfig() {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) {
        vscode.window.showWarningMessage('CodeSec: No workspace open.');
        return;
    }
    const fs = await Promise.resolve().then(() => __importStar(require('fs')));
    const path = await Promise.resolve().then(() => __importStar(require('path')));
    const dest = path.join(folders[0].uri.fsPath, '.codesec.json');
    const starter = {
        aiProvider: 'ollama',
        aiModel: 'qwen2.5-coder:7b',
        complexityThreshold: 10,
        duplicateLineThreshold: 6,
        languages: ['javascript', 'typescript', 'python', 'java'],
        ignorePatterns: ['**/node_modules/**', '**/dist/**', '**/*.min.js'],
        disabledRules: [],
    };
    fs.writeFileSync(dest, JSON.stringify(starter, null, 2));
    const doc = await vscode.workspace.openTextDocument(dest);
    await vscode.window.showTextDocument(doc);
    vscode.window.showInformationMessage('CodeSec: .codesec.json created — commit this to share settings with your team.');
}
