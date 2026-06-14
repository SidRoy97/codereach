# Codescape — AI Code Quality & Impact Graph

Real-time code quality, security analysis, AI-powered fixes, and an interactive
code impact graph for VS Code. Works with any LLM — Ollama (free, local), Groq,
HuggingFace, OpenRouter, or Anthropic. No server required.

## Features

### Code Impact Graph
- Builds a graph of every function, class, and method across your project using Tree-sitter
- See callers and callees of any symbol in an interactive panel
- Blast radius — know how many symbols break before you change one
- A CodeLens above each function: "3 caller(s) · 7 affected if changed"
- Export the whole graph to `codescape.json` to share with teammates or AI tools

### Security Analysis
- SQL injection, XSS, command injection, path traversal
- Hardcoded secrets and credentials
- Unsafe deserialization, weak crypto (MD5, SHA1, DES, ECB)
- Insecure cookies, SSRF, ReDoS, prototype pollution
- React-specific: dangerous href, localStorage secrets, postMessage origin

### Code Quality & SOLID
- SOLID principle violations
- God files and God classes, deep nesting, callback hell
- Boolean flag parameters, chained ternaries, too many parameters
- TypeScript `any` usage, return-null anti-pattern

### React / TSX
- Rules of Hooks violations, async useEffect, missing cleanup
- State mutations, index as key, re-render traps
- Deprecated lifecycle methods, state sprawl, prop drilling

### AI Analysis
- Deep semantic analysis via local or cloud LLM
- Two-phase: static rules instant, AI in the background
- One-click AI fix and plain-English explanations

### AI Context Generation
- AGENTS.md — a universal context file read by Claude Code, Cursor, ChatGPT, and Copilot
- Copy minimal AI context for any selected symbol
- One-sentence summary per file, cached

## Languages

JavaScript, TypeScript, JSX, TSX, Python, Java

## AI Providers

| Provider | Cost | Setup |
|---|---|---|
| Ollama | Free forever | `ollama serve` + `ollama pull qwen2.5-coder:7b` |
| Groq | Free tier | API key from console.groq.com |
| HuggingFace | Free tier | Token from huggingface.co/settings/tokens |
| OpenRouter | Free models | API key from openrouter.ai |
| Anthropic | Paid | API key from console.anthropic.com |

## Quick Start

1. Install the extension
2. Open any JS/TS/Python/Java file — analysis runs automatically
3. Run `Codescape: Build Code Graph` to enable impact analysis
4. Click the CodeLens above any function to see its impact graph

## Key Commands

| Command | What it does |
|---|---|
| `Codescape: Build Code Graph` | Index every function and its relationships |
| `Codescape: Export Code Graph` | Write `codescape.json` for sharing |
| `Codescape: Analyze Current File` | Run quality and security analysis |
| `Codescape: Generate AI Context File (AGENTS.md)` | Universal AI context for any LLM |
| `Codescape: Copy AI Context` | Minimal context for the selected symbol |
| `Codescape: Show Blast Radius` | How many files depend on the current file |

## Configuration

All settings live under `codescape.*` in VS Code Settings.

## License

MIT