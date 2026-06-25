# CodeReach — AI Code Quality & Impact Graph

Real-time code quality, security analysis, taint-flow analysis, AI-powered fixes,
and an interactive code impact graph for VS Code. The structural features need
**no AI and no backend** — everything runs inside the editor. AI is optional:
works with Ollama (free, local), Groq, HuggingFace, OpenRouter, or Anthropic.

**The idea: see how your code connects, know the blast radius of a change before
you make it, and catch security vulnerabilities that flow across files.**

---

## How CodeReach is different

- **Human-facing graph first.** A CodeLens over every function, a live impact bar
  that follows your cursor, an interactive graph panel — and exports context for
  an LLM. The graph is for you, not only for a model.
- **No server, no CLI, no database.** A single extension. Install and go.
- **AI is optional, not the point.** Impact graph, blast radius, safety check,
  taint analysis, and relationship analysis all work with **zero AI calls**.
- **Local-first by default.** With AI off, nothing leaves your machine.
- **Optional ground-truth mode.** For the Understanding Doc, toggle from the
  fast built-in heuristic to the **language server's call hierarchy** for exact
  relationships — right from the dashboard.

---

## Features

### Code Impact Graph
- Builds a graph of every function, class, and method across your project using
  Tree-sitter — no backend, no index server.
- **Blast radius** — how many symbols and files a change would touch.
- A **CodeLens** above each function: "3 caller(s) · 7 affected if changed".
- A **live impact bar** showing the impact of the symbol under your cursor.
- **Flow tracer** — follow execution flow downward from any symbol.
- **Safety check** — "what breaks if I change this?", with cross-file calls flagged.
- **Find unused symbols** — surface code nothing else calls.
- **Import-aware resolution** — calls are linked using actual import statements
  (`from dao.student import get`) not just name matching, eliminating false edges.
- Export the whole graph to `codereach.json`.

### Taint Analysis (Workspace-Wide)
- Follows untrusted user input from **sources** to dangerous **sinks** across
  your entire workspace, including across file boundaries.
- **Sources:** HTTP parameters, form fields, URL path params, CLI args,
  environment variables — for Python (aiohttp, Flask, Django, FastAPI),
  Java (Servlet, JAX-RS, Spring MVC), and JavaScript/TypeScript (Express,
  Next.js, browser APIs, WebSocket, Electron).
- **Sinks:** SQL injection, XSS, command injection, open redirect, template
  injection (SSTI), deserialization, prototype pollution, path traversal,
  LDAP injection, XXE.
- **Sanitizer-aware:** breaks taint flow on `DOMPurify`, `html.escape`,
  `shlex.quote`, `PreparedStatement`, `yaml.safe_load`, and more.
- **Cross-file:** Phase 2 seeds callee parameters as tainted and follows flows
  up to 4 hops via the code graph.
- Skips third-party assets (`static/`, `vendor/`, `*.min.js`, etc.) automatically.

### Security Analysis (Static Rules)
- SQL injection, XSS, command injection, path traversal.
- Hardcoded secrets and credentials.
- Unsafe deserialization, weak crypto (MD5, SHA1, DES, ECB).
- Insecure cookies, SSRF, ReDoS, prototype pollution.
- React-specific: dangerous href, localStorage secrets, postMessage origin.
- Third-party files (`static/`, `vendor/`, `node_modules/`, `*.min.js`,
  `target/`, `__pycache__/`, `venv/`, `migrations/`, `.next/`) are
  automatically excluded from analysis.

### Code Quality & SOLID
- SOLID principle violations, God files and God classes, deep nesting.
- Boolean flag parameters, chained ternaries, too many parameters.
- TypeScript `any` usage, return-null anti-pattern.

### React / TSX
- Rules of Hooks violations, async useEffect, missing cleanup.
- State mutations, index as key, re-render traps.
- Deprecated lifecycle methods, prop drilling.

### AI Analysis (optional)
Static rules catch what they can describe with a pattern. AI analysis
catches what needs reasoning — logic errors, wrong algorithms, missing
edge cases, and incorrect error handling that is syntactically valid but
semantically wrong.

- **Two-phase pipeline:** static rules run instantly on every save. AI
  runs in the background as a second pass, only when you enable it in
  settings (`codereach.enableAiAnalysis`).
- **Fix with AI** — one click generates a fix for any issue with a diff
  preview before it is applied. Works on both static and AI findings.
- **Explain this Issue** — asks the model to explain a finding in plain
  English: why it matters and how to fix it.
- **Off by default.** With Ollama, inference stays local and free. With
  a cloud provider, code is only sent when AI analysis is on.

> **Note:** AI analysis is separate from the Understanding Doc and
> Auto-Comment, which also call the model — but for summarization, not
> code inspection. The taint scanner is purely static and uses no AI.

### Code-Comprehension Document
- **Understanding Doc** — generates `codereach-understanding.json`: every symbol,
  a one-line AI summary, and its caller/callee relationships. Built to onboard a
  human or hand an LLM accurate structured context.
- **Variable support** — module-level constants are included with value excerpts.
- **Precise relationships (opt-in)** — use the language server's call hierarchy
  for ground-truth accuracy. Toggle from the dashboard.

### Dashboard & Reports
- A sidebar **Dashboard** with summary stats, category breakdown, and per-file
  issue list — scopable to the current file or the whole workspace.
- **Problems Report** — exports `codereach-issues.md` and `codereach-issues.json`,
  grouped by file and enclosing function.
- **Auto-Comment** — inserts JSDoc / Google-style docstrings / Javadoc above
  uncommented functions for JS/TS/Python/Java. Workspace-wide or single file.

---

## Precise Relationships: What You Need

- **TypeScript / JavaScript** — works out of the box.
- **Python** — install `ms-python.python` (Pylance).
- **Java** — install `redhat.java` (Language Support for Java™ by Red Hat).

---

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

1. Install the extension.
2. Open the **CodeReach** view in the activity bar.
3. Click **Workspace** to analyze the whole project, or **This File** for the active file.
4. Click the **CodeLens** above any function to open its impact graph.
5. Click **Taint Scan** in the dashboard to trace security flows workspace-wide.

## Key Commands

| Command | What it does |
|---|---|
| `CodeReach: Analyze Current File` | Run quality and security analysis on the active file |
| `CodeReach: Analyze Entire Workspace` | Analyze every supported file |
| `CodeReach: Open Dashboard` | Open the sidebar dashboard |
| `CodeReach: Taint Scan — Workspace` | Trace taint flows across the entire workspace |
| `CodeReach: Show Blast Radius for Current File` | How many files depend on this file |
| `CodeReach: Show Impact for Symbol at Cursor` | Open the impact graph for the cursor symbol |
| `CodeReach: Trace Flow from Cursor` | Follow execution flow from a symbol |
| `CodeReach: Safety Check (What Breaks if I Change This)` | List affected call sites, risk-ranked |
| `CodeReach: Find Unused Symbols` | Surface code nothing calls |
| `CodeReach: Generate Code Understanding Doc` | Write `codereach-understanding.json` |
| `CodeReach: Generate Comments for Uncommented Functions` | Insert JSDoc/docstrings |
| `CodeReach: Export Code Graph (codereach.json)` | Write the full graph for sharing |
| `CodeReach: Generate Problems Report` | Write `codereach-issues.md` and `.json` |
| `CodeReach: Generate .codereach.json` | Create a project config file |

## Configuration

All settings live under `codereach.*` in VS Code Settings, including AI provider
and model, `analyzeOnSave`, `enableAiAnalysis`, `preciseRelationships`,
`complexityThreshold`, `duplicateLineThreshold`, and the analyzed `languages`.

## Privacy

With AI disabled, CodeReach runs entirely locally — analysis and the impact
graph never leave your machine. With a local AI provider (Ollama), inference also
stays local. Only when you select a cloud provider is code sent out for analysis.

## License

MIT