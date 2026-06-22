import * as vscode from 'vscode';

// Single job: record every AI inference call with a timestamp and the place
// that triggered it, so we can see in the Output panel exactly what is hitting
// the model — including anything that fires after a command appears finished.
// This is a diagnostic aid; it makes no network calls of its own.
export class AiCallLog {
  private static channel = vscode.window.createOutputChannel('Codescape AI Calls');

  // I note the start of a call and return a function to call when it finishes,
  // so each entry shows who triggered it and how long the model took.
  static start(label: string): () => void {
    const started = Date.now();
    // The third stack frame is the caller of generateText/scan, which tells us
    // whether this came from summaries, retry, global context, fix, or analysis.
    const caller = new Error().stack?.split('\n')[3]?.trim() ?? 'unknown caller';
    this.channel.appendLine(`[${new Date().toISOString()}] ${label} START  ← ${caller}`);
    return () => {
      this.channel.appendLine(`[${new Date().toISOString()}] ${label} DONE   (${Date.now() - started}ms)`);
    };
  }

  // I record a call that failed, so errors are visible in the same timeline.
  static error(label: string, err: unknown): void {
    this.channel.appendLine(`[${new Date().toISOString()}] ${label} ERROR  ${err}`);
  }
}