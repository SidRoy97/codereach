import { test } from 'node:test';
import assert from 'node:assert';
import { Explainer } from '../../graph/Explainer';
import { CodeGraph } from '../../graph/CodeGraphTypes';

function sampleGraph(): CodeGraph {
  const node = (id: string, name: string) => ({ id, name, kind: 'function' as const, file: 'a.ts', line: 1, nameColumn: 0 });
  const edge = (a: string, b: string) => ({ from: a, to: b, relation: 'calls' as const, confidence: 'extracted' as const });
  return {
    nodes: [node('a.ts::handler', 'handler'), node('a.ts::service', 'service'), node('a.ts::repo', 'repo')],
    edges: [edge('a.ts::handler', 'a.ts::service'), edge('a.ts::service', 'a.ts::repo')],
  };
}

test('lists the symbol, its callers, and its callees', () => {
  const rows = new Explainer(() => sampleGraph()).explain('a.ts::service');
  assert.strictEqual(rows[0].label, 'service');
  assert.deepStrictEqual(rows.map(r => r.badge), ['this symbol', 'called by', 'calls']);
  assert.deepStrictEqual(rows.map(r => r.label), ['service', 'handler', 'repo']);
});

test('returns empty for an unknown symbol', () => {
  const rows = new Explainer(() => sampleGraph()).explain('nope');
  assert.strictEqual(rows.length, 0);
});
