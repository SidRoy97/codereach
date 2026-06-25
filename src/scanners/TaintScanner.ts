import * as vscode from 'vscode';
import { Node } from 'web-tree-sitter';
import { LanguageParser } from '../graph/LanguageParser';
import { Issue } from '../types';

// ─── Sources ──────────────────────────────────────────────────────────────────
// Every pattern here represents untrusted user-controlled input. Organised by
// language/framework. Conservative on purpose — only patterns that are almost
// always truly external input, not framework internals.
export const SOURCE_PATTERNS: RegExp[] = [

  // ── JavaScript / TypeScript — Express / Fastify / Koa ──
  /\breq\.(?:body|query|params|headers|cookies|files)\b/,
  /\brequest\.(?:body|query|params|headers|cookies)\b/,

  // ── JS/TS — Next.js ──
  /\bsearchParams\b/,
  /\bparams\s*\.\s*\w+\b/,           // getServerSideProps params

  // ── JS/TS — URL / browser ──
  /\blocation\.(?:search|hash|href|pathname)\b/,
  /\bnew\s+URLSearchParams\s*\(/,
  /\bURLSearchParams\b/,

  // ── JS/TS — DOM input ──
  /\be\.target\.value\b/,
  /\bevent\.target\.value\b/,
  /\bdocument\.getElementById\b.*\.value\b/,
  /\.value\b/,                        // generic .value on form elements

  // ── JS/TS — WebSocket / IPC ──
  /\bsocket\.on\s*\(\s*['"](?:message|data)['"]/,
  /\bws\.on\s*\(\s*['"]message['"]/,
  /\bipcMain\.on\s*\(/,
  /\bipcRenderer\.on\s*\(/,

  // ── Node CLI ──
  /\bprocess\.argv\b/,
  /\bprocess\.env\b/,

  // ── Python — aiohttp ──
  /\brequest\.match_info\b/,
  /\brequest\.match_info\s*\[/,
  /\brequest\.rel_url\b/,
  /\brequest\.query_string\b/,
  /\bawait\s+request\.(?:json|read|text|post)\s*\(/,
  /\brequest\.query\b/,

  // ── Python — Flask ──
  /\brequest\.(?:args|form|json|data|files|cookies|headers|values)\b/,
  /\brequest\.args\.get\s*\(/,
  /\brequest\.form\.get\s*\(/,
  /\brequest\.get_json\s*\(/,
  /\brequest\.values\.get\s*\(/,

  // ── Python — Django ──
  /\brequest\.(?:GET|POST|FILES|COOKIES|META|DATA)\b/,
  /\brequest\.GET\.get\s*\(/,
  /\brequest\.POST\.get\s*\(/,

  // ── Python — FastAPI / Starlette ──
  /\brequest\.path_params\b/,
  /\brequest\.query_params\b/,

  // ── Python — CLI / env ──
  /\bsys\.argv\b/,
  /\bos\.environ\.get\s*\(/,
  /\bos\.environ\s*\[/,
  /\binput\s*\(/,                    // interactive input()

  // ── Java — Servlet ──
  /\.getParameter\s*\(/,
  /\.getHeader\s*\(/,
  /\.getQueryString\s*\(/,
  /\.getInputStream\s*\(/,
  /\.getReader\s*\(/,
  /\.getCookies\s*\(/,

  // ── Java — JAX-RS ──
  /@(?:PathParam|QueryParam|FormParam|HeaderParam|CookieParam|MatrixParam)\b/,
  /\buriInfo\.getQueryParameters\s*\(/,
  /\bhttpHeaders\.getRequestHeader\s*\(/,

  // ── Java — Spring MVC ──
  /@(?:RequestParam|PathVariable|RequestBody|RequestHeader)\b/,
];

// ─── Sinks ────────────────────────────────────────────────────────────────────
export interface SinkDef {
  pattern:    RegExp;
  message:    string;
  suggestion: string;
}

export const SINKS: SinkDef[] = [

  // ══ XSS ══════════════════════════════════════════════════════════════════

  {
    pattern:    /\.innerHTML\s*=/,
    message:    'User input flows into innerHTML. An attacker can inject scripts that execute in the victim\'s browser.',
    suggestion: 'Use textContent for plain text, or sanitize with DOMPurify.sanitize(input) before assigning to innerHTML.',
  },
  {
    pattern:    /dangerouslySetInnerHTML/,
    message:    'User input flows into dangerouslySetInnerHTML. React skips its own escaping here, making XSS trivial.',
    suggestion: 'Sanitize first: { __html: DOMPurify.sanitize(input) }. Never pass raw user data.',
  },
  {
    pattern:    /\bdocument\.write\s*\(/,
    message:    'User input flows into document.write(). This renders HTML directly and is a classic XSS vector.',
    suggestion: 'Avoid document.write(). Use DOM methods (createElement, textContent) with sanitized content instead.',
  },
  {
    pattern:    /\$\s*\([^)]*\)/,
    message:    'User input used as a jQuery selector. An attacker can execute arbitrary JavaScript via crafted input.',
    suggestion: 'Validate input is a safe CSS selector, or use document.getElementById/querySelector with literal selectors.',
  },
  {
    pattern:    /\.html\s*\(/,
    message:    'User input passed to jQuery .html(). This sets raw HTML and is an XSS sink.',
    suggestion: 'Use .text() for plain text, or sanitize with DOMPurify before calling .html().',
  },
  {
    pattern:    /\.setAttribute\s*\(\s*['"](?:src|href|onclick|onerror)['"]/,
    message:    'User input set as a sensitive HTML attribute. This can enable script injection or open redirects.',
    suggestion: 'Validate the value against an allowlist and never allow javascript: URIs.',
  },

  // ══ XSS — Java HTTP response ════════════════════════════════════════════

  {
    pattern:    /response\.getWriter\s*\(\s*\)\s*\.\s*(?:print|println|write)\s*\(/,
    message:    'User input is written directly to the HTTP response without encoding. An attacker can inject scripts.',
    suggestion: 'Encode output with OWASP Java Encoder: Encode.forHtml(userInput).',
  },
  {
    pattern:    /out\.(?:print|println)\s*\(/,
    message:    'User input reaches a JSP/Servlet output stream without encoding — XSS risk.',
    suggestion: 'Encode with OWASP Java Encoder: Encode.forHtml(userInput) before printing.',
  },

  // ══ Template injection ════════════════════════════════════════════════════

  {
    pattern:    /\brender_template_string\s*\(/,
    message:    'User input passed to render_template_string(). An attacker can inject Jinja2 expressions for server-side template injection (SSTI).',
    suggestion: 'Never pass user-controlled strings to render_template_string(). Use render_template() with a static template file instead.',
  },
  {
    pattern:    /\benv\.from_string\s*\(|Template\s*\(\s*(?!['"])/,
    message:    'User input used to construct a Jinja2/template object. This allows server-side template injection (SSTI).',
    suggestion: 'Load templates from files only. Never build template strings from user input.',
  },
  {
    pattern:    /\bejs\.render\s*\(|pug\.render\s*\(|handlebars\.compile\s*\(|mustache\.render\s*\(/,
    message:    'User input passed to a server-side template renderer. This can enable server-side template injection (SSTI).',
    suggestion: 'Use pre-compiled static templates. Never pass user input as the template string.',
  },
  {
    pattern:    /\brender\s*\(|render_template\s*\(|aiohttp_jinja2\.render_template\s*\(/,
    message:    'User input is passed directly to a template renderer. If autoescape is off, this enables XSS.',
    suggestion: 'Enable autoescape=True on the Jinja2 environment, or escape all user-supplied values before passing to templates.',
  },

  // ══ Open redirect ═════════════════════════════════════════════════════════

  {
    pattern:    /\bres\.redirect\s*\(/,
    message:    'User input used in a redirect URL. An attacker can redirect victims to a malicious site (open redirect).',
    suggestion: 'Validate the redirect target against an allowlist of trusted domains.',
  },
  {
    pattern:    /\bwindow\.location\.(?:href|replace|assign)\s*=/,
    message:    'User input controls a browser navigation target. An attacker can redirect to a phishing or malware site.',
    suggestion: 'Validate the URL against an allowlist and reject javascript: URIs.',
  },

  // ══ Code injection ════════════════════════════════════════════════════════

  {
    pattern:    /\beval\s*\(/,
    message:    'User input reaches eval(). The attacker controls what JavaScript executes in your application.',
    suggestion: 'Remove eval(). Use JSON.parse() for data, or restructure to avoid dynamic code execution.',
  },
  {
    pattern:    /\bnew\s+Function\s*\(/,
    message:    'User input reaches new Function(). This executes arbitrary code the same way eval() does.',
    suggestion: 'Remove new Function(). Restructure to avoid dynamic code execution.',
  },

  // ══ SQL injection ══════════════════════════════════════════════════════════

  {
    pattern:    /\.(?:query|execute|executemany|executeQuery|executeUpdate|run|fetch(?:all|one|row|val)?)\s*\(/,
    message:    'User input is used directly in a database query. An attacker can read, modify, or delete any data.',
    suggestion: 'Use parameterized queries or prepared statements. Never concatenate user data into SQL.',
  },
  {
    // Python: cur.execute("SELECT..." + var) or cur.execute("..." % var)
    pattern:    /\.execute\s*\([^)]*(?:\+|%\s*\w|\.format\s*\(|f['"])/,
    message:    'A SQL query is built by concatenating or formatting user input. This is SQL injection.',
    suggestion: 'Use parameterized queries: cursor.execute("SELECT ... WHERE id = %s", (user_id,)). Never build SQL with string operations.',
  },
  {
    // Python f-string SQL
    pattern:    /(?:f['"]|\.format\s*\().*(?:SELECT|INSERT|UPDATE|DELETE|WHERE|FROM)/i,
    message:    'A SQL query is built by interpolating user input into an f-string or .format(). This is SQL injection.',
    suggestion: 'Use parameterized queries: cursor.execute("SELECT ... WHERE id = %s", (user_id,)).',
  },
  {
    // sqlite3 / generic con.execute
    pattern:    /\bcon(?:nection)?\.execute\s*\(/,
    message:    'User input reaches a database execute call. Verify this uses parameterized queries, not string concatenation.',
    suggestion: 'Use parameterized queries: conn.execute("SELECT ... WHERE id = ?", (user_id,)).',
  },
  {
    // Java string concat SQL
    pattern:    /\.(?:executeQuery|executeUpdate|execute)\s*\(\s*[^)]*\+/,
    message:    'A SQL query is built by concatenating user input. An attacker can manipulate the query.',
    suggestion: 'Use PreparedStatement with ? placeholders. Never build SQL by string concatenation.',
  },

  // ══ Command injection ══════════════════════════════════════════════════════

  {
    pattern:    /\b(?:exec|spawn|execSync|spawnSync|execFile|execFileSync)\s*\(/,
    message:    'User input reaches a shell command. An attacker can run arbitrary commands on your server.',
    suggestion: 'Never pass user input to shell commands. Use a fixed command with a validated args array.',
  },
  {
    pattern:    /\bos\.(?:system|popen)\s*\(/,
    message:    'User input reaches os.system() or os.popen(). An attacker can run arbitrary OS commands.',
    suggestion: 'Replace with subprocess.run(["cmd", arg], shell=False) and validate every argument against an allowlist.',
  },
  {
    pattern:    /\bsubprocess\.(?:run|call|Popen|check_output|check_call)\s*\(/,
    message:    'User input reaches subprocess. If shell=True or the input is unsanitized, the attacker controls the command.',
    suggestion: 'Pass a list of arguments, not a shell string, and set shell=False.',
  },
  {
    pattern:    /Runtime\.getRuntime\s*\(\s*\)\s*\.\s*exec\s*\(/,
    message:    'User input reaches Runtime.exec(). An attacker can run arbitrary commands on the server.',
    suggestion: 'Use ProcessBuilder with a fixed command array and validate every argument.',
  },
  {
    pattern:    /\bnew\s+ProcessBuilder\s*\(/,
    message:    'User input reaches ProcessBuilder. If the command or arguments are not fixed, the attacker controls execution.',
    suggestion: 'Hard-code the command name and validate each argument strictly before passing to ProcessBuilder.',
  },

  // ══ Deserialization ════════════════════════════════════════════════════════

  {
    pattern:    /\bpickle\.(?:loads|load)\s*\(/,
    message:    'User input reaches pickle.loads()/load(). Deserializing untrusted pickle data executes arbitrary Python code.',
    suggestion: 'Never deserialize untrusted data with pickle. Use JSON or another safe format instead.',
  },
  {
    pattern:    /\byaml\.(?:load|unsafe_load)\s*\(/,
    message:    'User input reaches yaml.load() without SafeLoader. This can execute arbitrary Python code.',
    suggestion: 'Use yaml.safe_load() instead of yaml.load().',
  },
  {
    pattern:    /ObjectInputStream\s*\(\s*.*\)\s*\.readObject\s*\(/,
    message:    'User input reaches Java ObjectInputStream.readObject(). Deserializing untrusted data can execute arbitrary code.',
    suggestion: 'Never deserialize untrusted data with Java serialization. Use JSON or validate with a whitelist deserializer.',
  },

  // ══ Prototype pollution ════════════════════════════════════════════════════

  {
    pattern:    /Object\.assign\s*\(/,
    message:    'User input merged into an object with Object.assign(). If the input contains __proto__, this enables prototype pollution.',
    suggestion: 'Validate the input keys against an allowlist before merging, or use structuredClone() on a sanitized copy.',
  },
  {
    pattern:    /\b(?:_\.merge|deepmerge|merge)\s*\(/,
    message:    'User input merged with a deep-merge function. Unsanitized keys like __proto__ enable prototype pollution.',
    suggestion: 'Sanitize input keys before merging, or use a merge library that protects against prototype pollution.',
  },

  // ══ Path traversal ════════════════════════════════════════════════════════

  {
    pattern:    /(?:readFile|writeFile|readFileSync|writeFileSync|createReadStream|createWriteStream|appendFile|unlink)\s*\(/,
    message:    'User input is used in a file path. An attacker can read or overwrite files outside the intended directory (path traversal).',
    suggestion: 'Use path.basename(userInput) to strip directory components, then verify the resolved path is within your allowed directory.',
  },
  {
    pattern:    /\bopen\s*\(\s*(?!['"`])/,
    message:    'User input used in a file open() call. An attacker may traverse the filesystem to read or write arbitrary files.',
    suggestion: 'Validate the file path against an allowlist and resolve it with os.path.realpath() before opening.',
  },
  {
    pattern:    /\bPath\s*\([^'"]/,
    message:    'User input passed to pathlib.Path(). An attacker can traverse the filesystem with ../ sequences.',
    suggestion: 'Resolve the path and verify it is inside your allowed base directory: path.resolve().startswith(base_dir).',
  },

  // ══ HTTP response (Express) ════════════════════════════════════════════════

  {
    pattern:    /\bres\.(?:send|write|end|json|render)\s*\(/,
    message:    'User input is sent back in the HTTP response without encoding. If rendered in a browser, it can execute scripts.',
    suggestion: 'Encode the value before sending, or ensure your template engine auto-escapes output.',
  },

  // ══ LDAP injection ═════════════════════════════════════════════════════════

  {
    pattern:    /\bldap(?:\.search|\.bind|\.modify)\s*\(|\.search\s*\(\s*[^)]*(?:filter|base)/,
    message:    'User input used in an LDAP query. An attacker can bypass authentication or extract directory data (LDAP injection).',
    suggestion: 'Escape special LDAP characters in user input before including in filters.',
  },

  // ══ XXE / XML injection ════════════════════════════════════════════════════

  {
    pattern:    /DocumentBuilder(?:Factory)?\b|SAXParser\b|XMLInputFactory\b/,
    message:    'User input reaches an XML parser. If external entities are enabled, this enables XXE (XML External Entity) attacks.',
    suggestion: 'Disable DOCTYPE and external entity processing: factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true).',
  },

  // ══ Java — HTTP response ════════════════════════════════════════════════

  {
    pattern:    /response\.getWriter\s*\(\s*\)\s*\.\s*(?:print|println|write)\s*\(/,
    message:    'User input written to HTTP response without encoding. An attacker can inject HTML or scripts.',
    suggestion: 'Encode with OWASP Java Encoder: Encode.forHtml(userInput).',
  },
];

// ─── Sanitizers ───────────────────────────────────────────────────────────────
export const SANITIZERS: RegExp[] = [
  // JS/TS
  /\bDOMPurify\.sanitize\s*\(/,
  /\bsanitize\w*\s*\(/,
  /\bescape(?:Html|Xml|Attr)?\w*\s*\(/,
  /\bencodeURI(?:Component)?\s*\(/,
  /\bvalidate\w*\s*\(/,
  /\bparseInt\s*\(/,
  /\bparseFloat\s*\(/,
  /\bNumber\s*\(/,
  /\bJSON\.parse\s*\(/,
  // Python
  /\bbleach\.clean\s*\(/,
  /\bmarkupsafe\.escape\s*\(/,
  /\bhtml\.escape\s*\(/,
  /\bquote(?:_plus)?\s*\(/,
  /\bre\.escape\s*\(/,
  /\bshlex\.quote\s*\(/,
  /\bsecrets\.\w+\s*\(/,
  /yaml\.safe_load\s*\(/,
  // Java
  /\bEncode\.for\w+\s*\(/,
  /\bHtmlUtils\.htmlEscape\s*\(/,
  /\bStringEscapeUtils\.\w+\s*\(/,
  /\bPreparedStatement\b/,
  /\bprepareStatement\s*\(/,
  // Generic
  /allowlist|whitelist|allowedValues/i,
];

// Tree-sitter node types that open a fresh taint scope, per grammar.
const FUNCTION_BODY_TYPES: Record<string, string[]> = {
  javascript: ['function_declaration', 'method_definition', 'arrow_function', 'function_expression'],
  typescript: ['function_declaration', 'method_definition', 'arrow_function', 'function_expression'],
  python:     ['function_definition'],
  java:       ['method_declaration', 'constructor_declaration'],
};

// Parameter extraction config per grammar — used by CrossFileTaintScanner.
export const PARAM_NODE_TYPES: Record<string, { fnTypes: string[]; paramTypes: string[] }> = {
  javascript: {
    fnTypes:    ['function_declaration', 'method_definition', 'arrow_function', 'function_expression'],
    paramTypes: ['identifier', 'required_parameter', 'optional_parameter', 'rest_pattern'],
  },
  typescript: {
    fnTypes:    ['function_declaration', 'method_definition', 'arrow_function', 'function_expression'],
    paramTypes: ['required_parameter', 'optional_parameter', 'rest_parameter', 'identifier'],
  },
  python: {
    fnTypes:    ['function_definition'],
    paramTypes: ['identifier'],
  },
  java: {
    fnTypes:    ['method_declaration', 'constructor_declaration'],
    paramTypes: ['formal_parameter', 'spread_parameter'],
  },
};

export class TaintScanner {
  constructor(private readonly parser: LanguageParser) {}

  async scan(document: vscode.TextDocument): Promise<Issue[]> {
    return this.scanWithSeeds(document, new Set());
  }

  async scanWithSeeds(
    document:  vscode.TextDocument,
    seeds:     Set<string>,
    targetFn?: string,
  ): Promise<Issue[]> {
    let parsed;
    try {
      parsed = await this.parser.parseTree(document);
    } catch {
      return [];
    }
    if (!parsed) return [];

    const { root, grammar } = parsed;
    const fnTypes = FUNCTION_BODY_TYPES[grammar] ?? [];
    const issues: Issue[] = [];

    this.parser.walk(root, node => {
      if (!fnTypes.includes(node.type)) return;
      if (targetFn) {
        const nameNode = node.childForFieldName('name');
        if (!nameNode || nameNode.text !== targetFn) return;
      }
      this.analyzeScope(node, issues, new Set(seeds));
    });

    return this.dedupe(issues);
  }

  extractParams(fnNode: Node, grammar: string): string[] {
    const cfg = PARAM_NODE_TYPES[grammar];
    if (!cfg) return [];

    const params: string[] = [];
    const paramsNode = fnNode.childForFieldName('parameters')
                    ?? fnNode.childForFieldName('params');
    if (!paramsNode) return [];

    for (let i = 0; i < paramsNode.childCount; i++) {
      const child = paramsNode.child(i);
      if (!child) continue;
      if (cfg.paramTypes.includes(child.type)) {
        const nameNode = child.childForFieldName('name')
                      ?? child.childForFieldName('identifier')
                      ?? (child.type === 'identifier' ? child : null);
        if (nameNode) params.push(nameNode.text.trim());
      }
    }

    return params.filter(p => p && /^[\w$]+$/.test(p));
  }

  private analyzeScope(fnNode: Node, issues: Issue[], seeds: Set<string>): void {
    const tainted = new Set<string>(seeds);
    const statements: Node[] = [];
    this.collectStatements(fnNode, statements);

    for (const stmt of statements) {
      const text = stmt.text;
      const line = stmt.startPosition.row;

      const assign = this.readAssignment(text);
      if (assign) {
        const rhsTainted = this.isTainted(assign.rhs, tainted)
                        && !this.isSanitized(assign.rhs);
        if (rhsTainted) {
          tainted.add(assign.lhs);
        } else {
          tainted.delete(assign.lhs);
        }
      }

      for (const sink of SINKS) {
        if (!sink.pattern.test(text)) continue;
        if (this.isSanitized(text)) continue;
        if (!this.isTainted(text, tainted)) continue;

        issues.push({
          id:         `taint:${line}:${stmt.startPosition.column}`,
          message:    sink.message,
          severity:   'error',
          category:   'security',
          line,
          column:     stmt.startPosition.column,
          endLine:    line,
          endColumn:  stmt.startPosition.column + Math.min(text.length, 120),
          rule:       'taint:source-to-sink',
          suggestion: sink.suggestion,
          source:     'static',
        });
        break;
      }
    }
  }

  private collectStatements(node: Node, out: Node[]): void {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (!child) continue;
      out.push(child);
      const isNestedFn =
        child.type.includes('function') ||
        child.type === 'method_definition' ||
        child.type === 'arrow_function';
      if (!isNestedFn) this.collectStatements(child, out);
    }
  }

  private readAssignment(text: string): { lhs: string; rhs: string } | null {
    const m = text.match(/^\s*(?:const|let|var\s+)?\s*([\w.$\[\]'"]+)\s*=\s*([^=].*)$/s);
    if (!m) return null;
    const lhsRaw  = m[1];
    const rhs     = m[2];
    const lastDot = lhsRaw.lastIndexOf('.');
    const lhs     = lastDot >= 0 ? lhsRaw.slice(lastDot + 1) : lhsRaw;
    if (!/^[\w$]+$/.test(lhs)) return null;
    return { lhs, rhs };
  }

  isTainted(text: string, tainted: Set<string>): boolean {
    for (const src of SOURCE_PATTERNS) {
      if (src.test(text)) return true;
    }
    for (const name of tainted) {
      if (new RegExp(`(?<![\\w$])${escapeRegExp(name)}(?![\\w$])`).test(text)) {
        return true;
      }
    }
    return false;
  }

  isSanitized(text: string): boolean {
    return SANITIZERS.some(s => s.test(text));
  }

  private dedupe(issues: Issue[]): Issue[] {
    const seen = new Set<string>();
    return issues.filter(i => {
      const key = `${i.line}:${i.rule}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}