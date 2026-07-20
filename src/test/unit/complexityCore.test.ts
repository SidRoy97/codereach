import { test } from 'node:test';
import assert from 'node:assert';
import * as path from 'path';
import { Parser, Language } from 'web-tree-sitter';
import { scoreFunctions, FunctionScore } from '../../graph/ComplexityCore';

// I parse a snippet with the bundled grammar and return the syntax tree root.
async function parse(code: string, wasm: string) {
  await Parser.init();
  const parser = new Parser();
  const lang = await Language.load(path.resolve(process.cwd(), 'media', 'grammars', wasm));
  parser.setLanguage(lang);
  const tree = parser.parse(code);
  if (!tree) throw new Error('parse failed');
  return tree.rootNode;
}

// I fetch one function's score by name from a scored list.
function scoreOf(scores: FunctionScore[], name: string): number {
  const found = scores.find(s => s.name === name);
  assert.ok(found, `expected a function named ${name}`);
  return found!.score;
}

test('trivial function scores 1', async () => {
  const root = await parse('function simple(a){ return a + 1; }', 'tree-sitter-javascript.wasm');
  assert.strictEqual(scoreOf(scoreFunctions(root, 'javascript'), 'simple'), 1);
});

test('branchy javascript function counts every path', async () => {
  const code = `
    function login(user, pass) {
      if (!user) return false;
      if (!pass) return false;
      for (let i = 0; i < user.length; i++) {
        if (user[i] === '@' && pass.length > 8) {
          while (retry) { if (check()) break; }
        }
      }
      try { validate(); } catch (e) { log(e); }
      return role === 'admin' ? grant() : deny();
    }`;
  assert.strictEqual(scoreOf(scoreFunctions(await parse(code, 'tree-sitter-javascript.wasm'), 'javascript'), 'login'), 10);
});

test('nested function complexity is attributed separately', async () => {
  const code = `
    const handler = (req) => {
      const outer = () => { if (a) { if (b) { return 1; } } };
      return req.ok && req.valid ? 200 : 400;
    };`;
  const scores = scoreFunctions(await parse(code, 'tree-sitter-javascript.wasm'), 'javascript');
  assert.strictEqual(scoreOf(scores, 'handler'), 3);
  assert.strictEqual(scoreOf(scores, 'outer'), 3);
});

test('python counts elif, comprehensions and boolean operators', async () => {
  const code = [
    'def process(items):',
    '    if not items:',
    '        return []',
    '    for x in items:',
    '        if x > 0 and x < 100:',
    '            while x:',
    '                x -= 1',
    '        elif x == 0 or x is None:',
    '            continue',
    '    try:',
    '        save()',
    '    except IOError:',
    '        pass',
    '    return [i for i in items if i]',
  ].join('\n');
  assert.strictEqual(scoreOf(scoreFunctions(await parse(code, 'tree-sitter-python.wasm'), 'python'), 'process'), 11);
});

test('java counts loops, if and ternary but not default label', async () => {
  const code = 'class C { int f(int a){ if(a>0){ return 1; } for(int i=0;i<a;i++){} return a>0?1:0; } }';
  assert.strictEqual(scoreOf(scoreFunctions(await parse(code, 'tree-sitter-java.wasm'), 'java'), 'f'), 4);
});
