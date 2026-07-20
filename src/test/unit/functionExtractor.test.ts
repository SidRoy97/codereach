import { test } from 'node:test';
import assert from 'node:assert';
import * as path from 'path';
import { Parser, Language } from 'web-tree-sitter';
import { extractFunctions } from '../../graph/FunctionExtractor';

async function parse(code: string, wasm: string) {
  await Parser.init();
  const parser = new Parser();
  const lang = await Language.load(path.resolve(process.cwd(), 'media', 'grammars', wasm));
  parser.setLanguage(lang);
  const tree = parser.parse(code);
  if (!tree) throw new Error('parse failed');
  return tree.rootNode;
}

test('extracts top-level functions and methods, not nested functions', async () => {
  const code = `
    function outer(a) { function inner(b) { return b; } return inner(a); }
    class C { doThing(x) { return x + 1; } }
  `;
  const root = await parse(code, 'tree-sitter-javascript.wasm');
  const names = extractFunctions(root, 'javascript').map(f => f.name).sort();
  assert.deepStrictEqual(names, ['doThing', 'outer']);
});

test('captures the function body text', async () => {
  const root = await parse('function add(a, b) { return a + b; }', 'tree-sitter-javascript.wasm');
  const fns = extractFunctions(root, 'javascript');
  assert.strictEqual(fns.length, 1);
  assert.ok(fns[0].text.includes('return a + b'));
});
