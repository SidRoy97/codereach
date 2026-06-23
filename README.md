# CodeReach — AI Code Quality & Impact Graph

Real-time code quality, security analysis, AI-powered fixes, and an interactive
code impact graph for VS Code. The structural features need **no AI and no
backend** — everything runs inside the editor. AI is optional: works with Ollama
(free, local), Groq, HuggingFace, OpenRouter, or Anthropic.

**The idea: see how your code connects, and know the blast radius of a change
before you make it.**

---

## How CodeReach is different

There are good code-graph tools now, but most of them are built for a different
job, and several have requirements CodeReach deliberately avoids:

- **Most impact-graph tools exist to feed an AI agent** (via MCP servers and a
  vector index). CodeReach's graph drives **human-facing, in-editor UI first** —
  a CodeLens over every function, a live impact bar that follows your cursor, an
  interactive graph panel — and *also* exports context for an LLM. The graph is
  for you, not only for a model.
- **Many require a separate backend** — a Python CLI, an MCP server, a vector
  database, an embedding model to download. CodeReach is **a single extension
  with no server, no CLI, no database**. Install and go.
- **AI is optional, not the point.** The impact graph, blast radius, safety
  check, and relationship analysis all work with **zero AI calls** and zero GPU.
  AI only adds deep semantic findings and one-click fixes when you turn it on.
- **Local-first by default.** With AI off, nothing leaves your machine. With a
  local provider (Ollama), inference stays local too. Code is only sent to a
  cloud provider if you explicitly choose one.
- **Optional ground-truth mode.** For the Understanding Doc, you can switch from
  the fast built-in heuristic to the **language server's call hierarchy** for
  exact relationships — the same data as "Show Call Hierarchy" — toggled right
  from the dashboard. Most lightweight extensions only do name-based estimates.

In short: a one-install, AI-optional, human-first impact layer — not a backend
service that exists mainly to make an agent smarter.

---

## Features

### Code Impact Graph
- Builds a graph of every function, class, and method across your project using Tree-sitter — no backend, no index server.
- See callers and callees of any symbol in an interactive panel.
- **Blast radius** — know how many symbols and files a change would touch before you make it.
- A **CodeLens** above each function: "3 caller(s) · 7 affected if changed".
- A **live impact bar** in the status bar showing the impact of the symbol under your cursor, updated as you move.
- **Flow tracer** — follow execution flow downward from any symbol.
- **Safety check** — "what breaks if I change this?", with cross-file calls flagged as higher risk.
- **Find unused symbols** — surface code nothing else calls.
- Export the whole graph to `codereach.json` to share with teammates or AI tools.

### Security Analysis
- SQL injection, XSS, command injection, path traversal.
- Hardcoded secrets and credentials.
- Unsafe deserialization, weak crypto (MD5, SHA1, DES, ECB).
- Insecure cookies, SSRF, ReDoS, prototype pollution.
- React-specific: dangerous href, localStorage secrets, postMessage origin.

### Code Quality & SOLID
- SOLID principle violations.
- God files and God classes, deep nesting, callback hell.
- Boolean flag parameters, chained ternaries, too many parameters.
- TypeScript `any` usage, return-null anti-pattern.

### React / TSX
- Rules of Hooks violations, async useEffect, missing cleanup.
- State mutations, index as key, re-render traps.
- Deprecated lifecycle methods, state sprawl, prop drilling.

### AI Analysis (optional)
- Deep semantic analysis via a local or cloud LLM.
- Two-phase: static rules run instantly, AI runs in the background.
- One-click **Fix with AI** with a diff preview, and plain-English **Explain this Issue**.
- Off by default — nothing heavy runs unless you enable it.

### Code-comprehension document
- **Understanding Doc** — generates `codereach-understanding.json`: every symbol, a one-line summary, and its caller/callee relationships. Built to onboard a human to a codebase, or to hand an LLM accurate, structured context instead of raw files.
- **Precise relationships (opt-in)** — resolve relationships from the language server's call hierarchy for ground-truth accuracy, instead of the fast estimate. Toggle from the dashboard.

### Dashboard & Reports
- A sidebar **Dashboard** with summary stats, a category breakdown, and a per-file issue list — scopable to the current file or the whole workspace.
- **Problems Report** — exports a human-readable `codereach-issues.md` and a machine-readable `codereach-issues.json`, grouped by file and enclosing function.

---

## Precise relationships: what you need

Precise mode delegates to the language server, so accuracy depends on the
relevant extension being installed and the project being indexed:

- **TypeScript / JavaScript** — works out of the box.
- **Python** — install the `ms-python.python` extension (Pylance).
- **Java** — install `redhat.java` (Language Support for Java™ by Red Hat), or the Extension Pack for Java.

Each language is resolved independently, so calls *between* languages are not
tracked, and trivial delegating methods may merge. When the server can't resolve
a symbol, CodeReach falls back to the fast estimate for that one. Precise mode is
slower and affects only the Understanding Doc — live features always use the fast path.

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
4. Click the **CodeLens** above any function to open its impact graph, or generate the **Understanding Doc**.

## Key Commands

| Command | What it does |
|---|---|
| `CodeReach: Analyze Current File` | Run quality and security analysis on the active file |
| `CodeReach: Analyze Entire Workspace` | Analyze every supported file |
| `CodeReach: Open Dashboard` | Open the sidebar dashboard |
| `CodeReach: Show Blast Radius for Current File` | How many files depend on the current file |
| `CodeReach: Show Impact for Symbol at Cursor` | Open the impact graph for the symbol under the cursor |
| `CodeReach: Trace Flow from Cursor` | Follow execution flow from a symbol |
| `CodeReach: Safety Check (What Breaks if I Change This)` | List affected call sites, risk-ranked |
| `CodeReach: Find Unused Symbols` | Surface code nothing calls |
| `CodeReach: Generate Code Understanding Doc` | Write `codereach-understanding.json` |
| `CodeReach: Export Code Graph (codereach.json)` | Write the full graph for sharing |
| `CodeReach: Generate Problems Report` | Write `codereach-issues.md` and `.json` |
| `CodeReach: Generate .codereach.json` | Create a project config file |

## Configuration

All settings live under `codereach.*` in VS Code Settings, including AI provider
and model, `analyzeOnSave`, `enableAiAnalysis`, `preciseRelationships`,
`complexityThreshold`, `duplicateLineThreshold`, and the analyzed `languages`.

## Privacy

With AI disabled, CodeReach runs entirely locally — analysis and the impact
graph never leave your machine. With a local AI provider (Ollama / LM Studio),
inference also stays local. Only when you select a cloud provider is code sent
out for analysis.

## License

MIT