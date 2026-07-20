import { test } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GraphCache } from '../../graph/GraphCache';
import { ParseResult } from '../../graph/LanguageParser';

const sample: ParseResult = {
  symbols: [{ name: 'foo', kind: 'function', line: 1, nameColumn: 0 }],
  calls:   [{ calleeName: 'bar', receiver: null, line: 2 }],
  imports: [{ localName: 'bar', sourcePath: './bar' }],
};

test('same content hashes equal, different content differs', () => {
  assert.strictEqual(GraphCache.hash('abc'), GraphCache.hash('abc'));
  assert.notStrictEqual(GraphCache.hash('abc'), GraphCache.hash('abd'));
});

test('get returns the result only on a matching hash', () => {
  const c = new GraphCache();
  const h = GraphCache.hash('code');
  assert.strictEqual(c.get('a.ts', h), null);
  c.set('a.ts', h, sample);
  assert.deepStrictEqual(c.get('a.ts', h), sample);
  assert.strictEqual(c.get('a.ts', 'other-hash'), null);
});

test('prune drops files no longer present', () => {
  const c = new GraphCache();
  c.set('a.ts', 'h1', sample);
  c.set('b.ts', 'h2', sample);
  c.prune(new Set(['a.ts']));
  assert.strictEqual(c.size(), 1);
  assert.deepStrictEqual(c.get('a.ts', 'h1'), sample);
  assert.strictEqual(c.get('b.ts', 'h2'), null);
});

test('save then load round-trips through disk', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-'));
  const file = path.join(dir, 'sub', 'cache.json');
  const a = new GraphCache();
  a.set('a.ts', 'h1', sample);
  a.save(file);
  const b = new GraphCache();
  b.load(file);
  assert.deepStrictEqual(b.get('a.ts', 'h1'), sample);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('load starts empty when the cache file is missing', () => {
  const c = new GraphCache();
  c.load(path.join(os.tmpdir(), 'does-not-exist-12345', 'cache.json'));
  assert.strictEqual(c.size(), 0);
});
