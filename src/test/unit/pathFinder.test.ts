import { test } from 'node:test';
import assert from 'node:assert';
import { PathFinder } from '../../graph/PathFinder';
import { CodeGraph } from '../../graph/CodeGraphTypes';

// I build a small three-file call graph for the path tests to run against.
function sampleGraph(): CodeGraph {
  return {
    nodes: [
      { id: 'a.js::login',     name: 'login',     kind: 'function', file: 'a.js', line: 1,  nameColumn: 0 },
      { id: 'a.js::checkPass', name: 'checkPass', kind: 'function', file: 'a.js', line: 9,  nameColumn: 0 },
      { id: 'b.js::query',     name: 'query',     kind: 'function', file: 'b.js', line: 3,  nameColumn: 0 },
      { id: 'b.js::dbWrite',   name: 'dbWrite',   kind: 'function', file: 'b.js', line: 20, nameColumn: 0 },
      { id: 'c.js::unrelated', name: 'unrelated', kind: 'function', file: 'c.js', line: 1,  nameColumn: 0 },
    ],
    edges: [
      { from: 'a.js::login',     to: 'a.js::checkPass', relation: 'calls', confidence: 'extracted' },
      { from: 'a.js::checkPass', to: 'b.js::query',     relation: 'calls', confidence: 'extracted' },
      { from: 'b.js::query',     to: 'b.js::dbWrite',   relation: 'calls', confidence: 'extracted' },
    ],
  };
}

test('finds a forward path across files', () => {
  const rows = new PathFinder(() => sampleGraph()).find('a.js::login', 'b.js::dbWrite');
  assert.deepStrictEqual(rows.map(r => r.label), ['login', 'checkPass', 'query', 'dbWrite']);
  assert.deepStrictEqual(rows.map(r => r.badge), ['start', 'calls', 'calls', 'calls']);
});

test('finds a reverse path and tags direction as called by', () => {
  const rows = new PathFinder(() => sampleGraph()).find('b.js::dbWrite', 'a.js::login');
  assert.deepStrictEqual(rows.map(r => r.label), ['dbWrite', 'query', 'checkPass', 'login']);
  assert.deepStrictEqual(rows.map(r => r.badge), ['start', 'called by', 'called by', 'called by']);
});

test('returns no rows when there is no connection', () => {
  const rows = new PathFinder(() => sampleGraph()).find('a.js::login', 'c.js::unrelated');
  assert.strictEqual(rows.length, 0);
});
