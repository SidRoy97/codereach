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
exports.ConfigManager = void 0;
const vscode = __importStar(require("vscode"));
// Single job: be the one place that reads VS Code workspace settings
class ConfigManager {
    // Helper to get the vscode config object once
    cfg() {
        return vscode.workspace.getConfiguration('codeSec');
    }
    // Which AI backend: ollama | openrouter | anthropic | openai-compatible
    getAiProvider() {
        return this.cfg().get('aiProvider') ?? 'ollama';
    }
    // Model name e.g. "qwen2.5-coder:7b" — empty means use the provider default
    getAiModel() {
        return this.cfg().get('aiModel') ?? '';
    }
    // API key for cloud providers — empty string means no key needed (Ollama)
    getAiApiKey() {
        return this.cfg().get('aiApiKey') ?? '';
    }
    // Override the default base URL if the user is running on a different port
    getAiBaseUrl() {
        return this.cfg().get('aiBaseUrl') ?? '';
    }
    // Whether to call the AI at all — users can turn this off to save time
    isAiEnabled() {
        return this.cfg().get('enableAiAnalysis') ?? true;
    }
    // Whether to run built-in static regex rules
    isStaticEnabled() {
        return this.cfg().get('enableStaticAnalysis') ?? true;
    }
    // Functions above this complexity score get flagged
    getComplexityThreshold() {
        return this.cfg().get('complexityThreshold') ?? 10;
    }
    // Blocks shorter than this won't be flagged as duplicates
    getDuplicateThreshold() {
        return this.cfg().get('duplicateLineThreshold') ?? 6;
    }
    // Which programming languages we should analyze
    getLanguages() {
        return this.cfg().get('languages') ?? [
            'javascript',
            'javascriptreact',
            'typescript',
            'typescriptreact',
            'python',
            'java',
        ];
    }
    // Trigger analysis automatically whenever the user saves
    shouldAnalyzeOnSave() {
        return this.cfg().get('analyzeOnSave') ?? true;
    }
}
exports.ConfigManager = ConfigManager;
