import { test } from 'node:test';
import assert from 'node:assert';
import { ImpactAnalyzer } from '../../graph/ImpactAnalyzer';
import { CodeGraph } from '../../graph/CodeGraphTypes';

// I build a graph where one leaf is called through two layers, plus dead code.
function sampleGraph(): CodeGraph {
  return {
    nodes: [
      { id: 'a.ts::handler', name: 'handler', kind: 'function', file: 'a.ts', line: 1, nameColumn: 0 },
      { id: 'a.ts::service', name: 'service', kind: 'function', file: 'a.ts', line: 5, nameColumn: 0 },
      { id: 'b.ts::repo',    name: 'repo',    kind: 'function', file: 'b.ts', line: 2, nameColumn: 0 },
      { id: 'b.ts::orphan',  name: 'orphan',  kind: 'function', file: 'b.ts', line: 9, nameColumn: 0 },
    ],
    edges: [
      { from: 'a.ts::handler', to: 'a.ts::service', relation: 'calls', confidence: 'extracted' },
      { from: 'a.ts::service', to: 'b.ts::repo',    relation: 'calls', confidence: 'inferred'  },
    ],
  };
}

test('reports direct callers and full transitive impact', () => {
  const impact = new ImpactAnalyzer(sampleGraph()).analyze('b.ts::repo');
  assert.ok(impact);
  assert.deepStrictEqual(impact!.directCallers.map(n => n.name), ['service']);
  assert.deepStrictEqual(impact!.affected.map(n => n.name).sort(), ['handler', 'service']);
});

test('blast radius counts other files a change would reach', () => {
  assert.strictEqual(new ImpactAnalyzer(sampleGraph()).blastRadiusForFile('b.ts'), 1);
});

test('finds symbols nothing calls', () => {
  const unused = new ImpactAnalyzer(sampleGraph()).findUnusedSymbols().map(n => n.name);
  assert.deepStrictEqual(unused.sort(), ['handler', 'orphan']);
});
