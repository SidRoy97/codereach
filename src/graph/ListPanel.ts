import * as vscode from 'vscode';
import * as path from 'path';

// One row in the panel: a label, optional sub-label, and a location to open.
export interface ListRow {
  label: string;        // primary text, e.g. a symbol name
  detail: string;       // secondary text, e.g. "function · src/foo.ts:12"
  file: string;         // workspace-relative file to open on click
  line: number;         // 0-based line to scroll to
  badge?: string;       // optional small tag, e.g. "7 affected"
  tone?: 'normal' | 'warn' | 'danger'; // row accent color
}

// What to show: a title, an intro line, and the rows.
export interface ListContent {
  title: string;
  intro: string;
  rows: ListRow[];
}

// Single job: show a titled, clickable list of code locations in a webview.
// Reused by several commands (graph overview, unused symbols, blast radius)
// so there is one list implementation, not three. Owns all of its own XSS
// defense: CSP + nonce, data sent by message, rows built with textContent,
// and incoming "open" messages validated against the rows we actually sent.
export class ListPanel {
  private panel?: vscode.WebviewPanel;
  private rows: ListRow[] = [];

  constructor(private readonly extensionUri: vscode.Uri) {}

  show(content: ListContent): void {
    this.rows = content.rows;

    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        'codereach.list',
        'CodeReach',
        vscode.ViewColumn.Beside,
        { enableScripts: true, localResourceRoots: [this.extensionUri] },
      );
      this.panel.onDidDispose(() => { this.panel = undefined; });
      this.panel.webview.onDidReceiveMessage(message => this.handleMessage(message));
    }

    this.panel.title = content.title;
    this.panel.webview.html = this.buildHtml();
    this.panel.webview.postMessage({ type: 'render', content });
    this.panel.reveal(vscode.ViewColumn.Beside);
  }

  // Open the file for a clicked row. Security: resolve file/line from our own
  // stored rows by index, never trust paths coming back from the webview.
  private handleMessage(message: unknown): void {
    if (!message || typeof message !== 'object') return;
    const msg = message as Record<string, unknown>;
    if (msg.type !== 'open' || typeof msg.index !== 'number') return;

    const row = this.rows[msg.index];
    if (!row) return;

    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) return;

    const uri = vscode.Uri.file(path.join(root, row.file));
    vscode.window.showTextDocument(uri, {
      selection: new vscode.Range(row.line, 0, row.line, 0),
      viewColumn: vscode.ViewColumn.One,
    }).then(editor => {
      editor.revealRange(
        new vscode.Range(row.line, 0, row.line, 0),
        vscode.TextEditorRevealType.InCenter,
      );
    });
  }

  private buildHtml(): string {
    const nonce = this.makeNonce();
    const csp = [
      `default-src 'none'`,
      `script-src 'nonce-${nonce}'`,
      `style-src 'nonce-${nonce}'`,
    ].join('; ');

    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta http-equiv="Content-Security-Policy" content="${csp}"/>
<style nonce="${nonce}">
  body { margin: 0; font-family: var(--vscode-font-family); color: var(--vscode-foreground);
         font-size: 13px; }
  #head { padding: 14px 16px 10px; border-bottom: 1px solid var(--vscode-panel-border); }
  #title { font-size: 15px; font-weight: 700; }
  #intro { font-size: 12px; opacity: 0.65; margin-top: 4px; }
  #list { padding: 6px 0; }
  .row { display: flex; align-items: center; gap: 10px; padding: 8px 16px; cursor: pointer;
         border-left: 3px solid transparent; }
  .row:hover { background: rgba(128,128,128,0.1); }
  .row.warn { border-left-color: var(--vscode-editorWarning-foreground, #fa0); }
  .row.danger { border-left-color: var(--vscode-editorError-foreground, #f44); }
  .row.normal { border-left-color: #7c3aed; }
  .label { font-weight: 600; flex-shrink: 0; }
  .detail { opacity: 0.6; font-size: 11px; flex: 1; overflow: hidden; text-overflow: ellipsis;
            white-space: nowrap; font-family: monospace; }
  .badge { font-size: 10px; padding: 1px 8px; border-radius: 10px; font-weight: 700; flex-shrink: 0;
           background: rgba(124,58,237,0.2); color: #a78bfa; }
  #empty { padding: 24px 16px; opacity: 0.6; font-size: 12px; }
</style>
</head>
<body>
<div id="head">
  <div id="title"></div>
  <div id="intro"></div>
</div>
<div id="list"></div>
<div id="empty" style="display:none">Nothing to show.</div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();

  window.addEventListener('message', event => {
    const msg = event.data;
    if (!msg || msg.type !== 'render') return;
    render(msg.content);
  });

  // Build the DOM with textContent only — never innerHTML with code data,
  // so a malicious symbol name or path cannot inject markup.
  function render(content) {
    document.getElementById('title').textContent = content.title;
    document.getElementById('intro').textContent = content.intro;

    const list = document.getElementById('list');
    const empty = document.getElementById('empty');
    list.textContent = '';

    if (!content.rows || content.rows.length === 0) {
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';

    content.rows.forEach((row, index) => {
      const el = document.createElement('div');
      el.className = 'row ' + (row.tone || 'normal');

      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = row.label;
      el.appendChild(label);

      const detail = document.createElement('span');
      detail.className = 'detail';
      detail.textContent = row.detail;
      el.appendChild(detail);

      if (row.badge) {
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = row.badge;
        el.appendChild(badge);
      }

      el.addEventListener('click', () => {
        vscode.postMessage({ type: 'open', index });
      });

      list.appendChild(el);
    });
  }
</script>
</body>
</html>`;
  }

  private makeNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let text = '';
    for (let i = 0; i < 32; i++) text += chars.charAt(Math.floor(Math.random() * chars.length));
    return text;
  }
}