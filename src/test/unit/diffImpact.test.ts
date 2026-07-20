import { test } from 'node:test';
import assert from 'node:assert';
import { DiffImpact } from '../../graph/DiffImpact';
import { CodeGraph } from '../../graph/CodeGraphTypes';

// handler (a.ts) -> service (a.ts) -> repo (b.ts)
function sampleGraph(): CodeGraph {
  const node = (id: string, name: string, file: string) => ({ id, name, kind: 'function' as const, file, line: 1, nameColumn: 0 });
  const edge = (a: string, b: string) => ({ from: a, to: b, relation: 'calls' as const, confidence: 'extracted' as const });
  return {
    nodes: [node('a.ts::handler', 'handler', 'a.ts'), node('a.ts::service', 'service', 'a.ts'), node('b.ts::repo', 'repo', 'b.ts')],
    edges: [edge('a.ts::handler', 'a.ts::service'), edge('a.ts::service', 'b.ts::repo')],
  };
}

test('changing a leaf reports its downstream callers in other files', () => {
  const r = new DiffImpact(() => sampleGraph()).analyze(new Set(['b.ts']));
  assert.deepStrictEqual(r.impactedSymbols.map(n => n.name).sort(), ['handler', 'service']);
  assert.deepStrictEqual(r.impactedFiles, ['a.ts']);
});

test('changing a top-level caller impacts nothing downstream', () => {
  const r = new DiffImpact(() => sampleGraph()).analyze(new Set(['a.ts']));
  assert.strictEqual(r.impactedSymbols.length, 0);
  assert.strictEqual(r.impactedFiles.length, 0);
});

test('rows flag downstream impact as risky', () => {
  const di = new DiffImpact(() => sampleGraph());
  const rows = di.toRows(di.analyze(new Set(['b.ts'])));
  assert.strictEqual(rows.length, 2);
  assert.ok(rows.every(row => row.tone === 'danger' && row.badge === 'impacted'));
});
