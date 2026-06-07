import * as vscode from 'vscode';
import { IConfigProvider } from '../interfaces';

// Single job: be the one place that reads VS Code workspace settings
export class ConfigManager implements IConfigProvider {

  // Helper to get the vscode config object once
  private cfg() {
    return vscode.workspace.getConfiguration('codeSec');
  }

  // Which AI backend: ollama | openrouter | anthropic | openai-compatible
  getAiProvider(): string {
    return this.cfg().get<string>('aiProvider') ?? 'ollama';
  }

  // Model name e.g. "qwen2.5-coder:7b" — empty means use the provider default
  getAiModel(): string {
    return this.cfg().get<string>('aiModel') ?? '';
  }

  // API key for cloud providers — empty string means no key needed (Ollama)
  getAiApiKey(): string {
    return this.cfg().get<string>('aiApiKey') ?? '';
  }

  // Override the default base URL if the user is running on a different port
  getAiBaseUrl(): string {
    return this.cfg().get<string>('aiBaseUrl') ?? '';
  }

  // Whether to call the AI at all — users can turn this off to save time
  isAiEnabled(): boolean {
    return this.cfg().get<boolean>('enableAiAnalysis') ?? true;
  }

  // Whether to run built-in static regex rules
  isStaticEnabled(): boolean {
    return this.cfg().get<boolean>('enableStaticAnalysis') ?? true;
  }

  // Functions above this complexity score get flagged
  getComplexityThreshold(): number {
    return this.cfg().get<number>('complexityThreshold') ?? 10;
  }

  // Blocks shorter than this won't be flagged as duplicates
  getDuplicateThreshold(): number {
    return this.cfg().get<number>('duplicateLineThreshold') ?? 6;
  }

  // Which programming languages we should analyze
  getLanguages(): string[] {
    return this.cfg().get<string[]>('languages') ?? [
      'javascript',
      'javascriptreact',
      'typescript',
      'typescriptreact',
      'python',
      'java',
    ];
  }

  // Trigger analysis automatically whenever the user saves
  shouldAnalyzeOnSave(): boolean {
    return this.cfg().get<boolean>('analyzeOnSave') ?? true;
  }
}