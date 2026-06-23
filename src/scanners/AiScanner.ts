import * as vscode from 'vscode';
import { Issue } from '../types';
import { IScanner, IConfigProvider } from '../interfaces';
import { AiCallLog } from './AiCallLog';

// Best default model per provider — chosen for code quality and free availability
const DEFAULT_MODELS: Record<string, string> = {
  ollama:              'qwen2.5-coder:7b',              // best free local code model
  groq:                'qwen-2.5-coder-32b',            // free, very fast, excellent at code
  huggingface:         'Qwen/Qwen2.5-Coder-7B-Instruct', // free HF inference, good at code
  openrouter:          'qwen/qwen-2.5-coder-32b-instruct:free',
  anthropic:           'claude-sonnet-4-20250514',
  'openai-compatible': 'llama3',
};

// Base URL per provider — where we send the API request
const DEFAULT_URLS: Record<string, string> = {
  ollama:              'http://localhost:11434',
  groq:                'https://api.groq.com/openai',    // Groq speaks OpenAI format
  huggingface:         'https://api-inference.huggingface.co',
  openrouter:          'https://openrouter.ai/api',
  anthropic:           'https://api.anthropic.com',
  'openai-compatible': 'http://localhost:1234',
};

// Where to get a free key per provider
const KEY_SIGNUP_URLS: Record<string, string> = {
  groq:        'https://console.groq.com',
  huggingface: 'https://huggingface.co/settings/tokens',
  openrouter:  'https://openrouter.ai',
  anthropic:   'https://console.anthropic.com',
};

// Instruct the model to return strict JSON only — no prose, no markdown fences
const SYSTEM_PROMPT = `You are a senior software engineer doing a code review.
Find real concrete issues only. Do not invent issues.
Check: security vulnerabilities, bugs, code smells, performance problems.

Return ONLY a JSON array. Each element must have:
{"line":<1-indexed number>,"severity":"error"|"warning"|"info"|"hint",
 "category":"code-smell"|"security"|"complexity"|"duplicate",
 "message":"<what is wrong>","suggestion":"<how to fix it>"}

Return [] if no issues found. JSON array only — no markdown, no explanation.`;

// Single job: call the configured AI provider and return parsed Issues
export class AiScanner implements IScanner {
  readonly name = 'AiScanner';

  constructor(private readonly config: IConfigProvider) {}

  async scan(document: vscode.TextDocument): Promise<Issue[]> {
    // Respect the user's choice to disable AI
    if (!this.config.isAiEnabled()) return [];

    // Skip very large files — too slow and too many tokens
    if (document.getText().length > 60_000) {
      vscode.window.showWarningMessage('CodeReach: File >60KB — skipping AI scan.');
      return [];
    }

    const provider = this.config.getAiProvider();
    const model    = this.config.getAiModel() || DEFAULT_MODELS[provider] || DEFAULT_MODELS['ollama'];
    const baseUrl  = (this.config.getAiBaseUrl() || DEFAULT_URLS[provider] || '').replace(/\/$/, '');
    const apiKey   = this.config.getAiApiKey();

    // Check cloud providers have a key configured before attempting the call
    if (this.requiresKey(provider) && !apiKey) {
      this.showMissingKeyMessage(provider);
      return [];
    }

    const userMsg = `Language: ${document.languageId}\n\`\`\`\n${document.getText()}\n\`\`\``;

    // Diagnostic: record that an analysis inference is starting, and who asked.
    const done = AiCallLog.start(`scan ${document.fileName}`);
    try {
      let text: string;

      // Route to the right API format — each provider speaks a slightly different dialect
      if (provider === 'ollama')       text = await this.callOllama(baseUrl, model, userMsg);
      else if (provider === 'huggingface') text = await this.callHuggingFace(baseUrl, apiKey, model, userMsg);
      else if (provider === 'anthropic')   text = await this.callAnthropic(baseUrl, apiKey, model, userMsg);
      else                                 text = await this.callOpenAiFormat(baseUrl, apiKey, model, userMsg, provider);

      done();
      return this.parseResponse(text);
    } catch (err) {
      AiCallLog.error('scan', err);
      this.handleError(err, provider);
      return [];
    }
  }

  // Used by CodeActionsProvider for targeted fix and explain requests
  async generateText(system: string, user: string): Promise<string> {
    const provider = this.config.getAiProvider();
    const model    = this.config.getAiModel() || DEFAULT_MODELS[provider];
    const baseUrl  = (this.config.getAiBaseUrl() || DEFAULT_URLS[provider]).replace(/\/$/, '');
    const apiKey   = this.config.getAiApiKey();

    // Diagnostic: record that a text-generation inference is starting, and who
    // asked. The caller frame tells us if it was summaries, retry, global
    // context, fix, or explain — so a surprise spike can be traced to source.
    const done = AiCallLog.start('generateText');
    try {
      let reply: string;
      if (provider === 'ollama')           reply = await this.callOllama(baseUrl, model, user, system);
      else if (provider === 'huggingface') reply = await this.callHuggingFace(baseUrl, apiKey, model, user, system);
      else if (provider === 'anthropic')   reply = await this.callAnthropic(baseUrl, apiKey, model, user, system);
      else                                 reply = await this.callOpenAiFormat(baseUrl, apiKey, model, user, provider, system);

      done();
      return reply;
    } catch (err) {
      AiCallLog.error('generateText', err);
      this.handleError(err, provider);
      return '';
    }
  }

  // --- Private: one method per API format ---

  // Ollama runs locally — no key, no account, just ollama serve
  private async callOllama(
    baseUrl: string,
    model:   string,
    user:    string,
    system = SYSTEM_PROMPT,
  ): Promise<string> {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        model,
        stream:  false,
        options: { temperature: 0.1 },  // low temp = consistent analysis output
        messages: [
          { role: 'system', content: system },
          { role: 'user',   content: user   },
        ],
      }),
    });

    // Model not pulled yet — give a specific actionable error
    if (res.status === 404) {
      vscode.window.showErrorMessage(
        `CodeReach: Ollama model "${model}" not found.`,
        `Run: ollama pull ${model}`
      );
      throw new Error('model not found');
    }

    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`);
    const data = await res.json() as { message?: { content?: string } };
    return data?.message?.content ?? '';
  }

  // HuggingFace Inference API — free token at huggingface.co/settings/tokens
  // Supports thousands of open models with no credit card
  private async callHuggingFace(
    baseUrl: string,
    apiKey:  string,
    model:   string,
    user:    string,
    system = SYSTEM_PROMPT,
  ): Promise<string> {
    // HuggingFace uses a different URL shape: /models/{model_id}
    const url = `${baseUrl}/models/${model}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Token is optional for some public models but gives higher rate limits
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    // HuggingFace chat completion format for instruct models
    const res = await fetch(url, {
      method:  'POST',
      headers,
      body:    JSON.stringify({
        inputs: `<|system|>\n${system}\n<|user|>\n${user}\n<|assistant|>`,
        parameters: {
          temperature:    0.1,
          max_new_tokens: 2048,
          return_full_text: false,  // only return the generated part, not the prompt
        },
      }),
    });

    // Model is loading on HF side — this is normal for cold starts
    if (res.status === 503) {
      const body = await res.json() as { estimated_time?: number };
      const wait = Math.ceil(body.estimated_time ?? 20);
      vscode.window.showWarningMessage(`CodeReach: HuggingFace model is loading (~${wait}s). Try again shortly.`);
      throw new Error('model loading');
    }

    // Model name is wrong or gated — need to pick a different one
    if (res.status === 404 || res.status === 403) {
      vscode.window.showErrorMessage(
        `CodeReach: HuggingFace model "${model}" not found or is gated.`,
        'Browse Free Models'
      ).then(c => {
        if (c === 'Browse Free Models') {
          vscode.env.openExternal(vscode.Uri.parse('https://huggingface.co/models?pipeline_tag=text-generation&sort=trending&search=code'));
        }
      });
      throw new Error('model not available');
    }

    if (!res.ok) throw new Error(`HuggingFace HTTP ${res.status}: ${await res.text()}`);

    // HF returns an array: [{ generated_text: "..." }]
    const data = await res.json() as Array<{ generated_text?: string }>;
    return data?.[0]?.generated_text ?? '';
  }

  // Groq, OpenRouter, LM Studio, vLLM — all speak OpenAI chat format
  private async callOpenAiFormat(
    baseUrl:  string,
    apiKey:   string,
    model:    string,
    user:     string,
    provider: string,
    system  = SYSTEM_PROMPT,
  ): Promise<string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    // OpenRouter needs these to track usage and show the app in their dashboard
    if (provider === 'openrouter') {
      headers['HTTP-Referer'] = 'https://github.com/your-org/codereach';
      headers['X-Title']      = 'CodeReach VS Code Extension';
    }

    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method:  'POST',
      headers,
      body:    JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens:  2048,
        messages: [
          { role: 'system', content: system },
          { role: 'user',   content: user   },
        ],
      }),
    });

    if (!res.ok) throw new Error(`${provider} HTTP ${res.status}: ${await res.text()}`);
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    return data?.choices?.[0]?.message?.content ?? '';
  }

  // Anthropic uses its own message format — different from OpenAI
  private async callAnthropic(
    baseUrl: string,
    apiKey:  string,
    model:   string,
    user:    string,
    system = SYSTEM_PROMPT,
  ): Promise<string> {
    const res = await fetch(`${baseUrl}/v1/messages`, {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });

    if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}: ${await res.text()}`);
    const data = await res.json() as { content?: Array<{ type: string; text?: string }> };
    return data?.content?.find(b => b.type === 'text')?.text ?? '';
  }

  // Pull the JSON array out of the response even if the model wrapped it in prose
  private parseResponse(raw: string): Issue[] {
    if (!raw) return [];

    // Find the JSON array — model may have added explanation before or after it
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    let parsed: Array<{
      line: number; severity: string; category: string;
      message: string; suggestion?: string;
    }>;

    try {
      parsed = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(parsed)) return [];
    } catch {
      console.error('CodeReach: failed to parse AI JSON response');
      return [];
    }

    return parsed
      .filter(i => typeof i.line === 'number' && i.line >= 1 && i.message)
      .map((i, idx): Issue => ({
        id:         `ai:${i.line}:${idx}`,
        message:    i.message,
        severity:   (i.severity  as Issue['severity'])  ?? 'warning',
        category:   (i.category  as Issue['category'])  ?? 'code-smell',
        line:       Math.max(0, i.line - 1),  // AI returns 1-indexed, VS Code wants 0-indexed
        column:     0,
        endLine:    Math.max(0, i.line - 1),
        rule:       'ai:review',
        suggestion: i.suggestion,
        source:     'ai',
      }));
  }

  // Providers that need a key configured before we even try calling them
  private requiresKey(provider: string): boolean {
    return ['groq', 'huggingface', 'openrouter', 'anthropic'].includes(provider);
  }

  // Friendly first-time setup message with a link to the signup page
  private showMissingKeyMessage(provider: string): void {
    const signupUrl = KEY_SIGNUP_URLS[provider];
    const label     = provider.charAt(0).toUpperCase() + provider.slice(1);

    vscode.window.showWarningMessage(
      `CodeReach: ${label} needs a free API key. Get one and paste it in Settings → codereach.aiApiKey.`,
      `Get ${label} Key`,
      'Use Ollama Instead (no key)',
    ).then(choice => {
      if (choice === `Get ${label} Key`) {
        vscode.env.openExternal(vscode.Uri.parse(signupUrl));
      }
      if (choice === 'Use Ollama Instead (no key)') {
        vscode.commands.executeCommand('workbench.action.openSettings', 'codereach.aiProvider');
      }
    });
  }

  // Friendly error messages so users know exactly what went wrong
  private handleError(err: unknown, provider: string): void {
    const msg = err instanceof Error ? err.message : String(err);

    if (provider === 'ollama' && msg.includes('ECONNREFUSED')) {
      // Ollama server isn't running — give the exact command to start it
      vscode.window.showErrorMessage(
        'CodeReach: Ollama is not running. Start it first.',
        'Run: ollama serve',
        'Get Ollama',
      ).then(c => {
        if (c === 'Get Ollama') vscode.env.openExternal(vscode.Uri.parse('https://ollama.com'));
      });
    } else if (msg.includes('401')) {
      vscode.window.showErrorMessage(
        `CodeReach: Invalid API key for ${provider}. Check Settings → codereach.aiApiKey.`
      );
    } else if (msg.includes('429')) {
      vscode.window.showWarningMessage(
        `CodeReach: Rate limit hit on ${provider} — skipping AI analysis this time.`
      );
    } else if (msg.includes('model loading') || msg.includes('model not found') || msg.includes('model not available')) {
      // Already showed a specific message in the calling method — don't double-notify
    } else {
      console.error(`CodeReach AI error [${provider}]:`, msg);
    }
  }
}