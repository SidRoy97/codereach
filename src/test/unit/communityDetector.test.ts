import { test } from 'node:test';
import assert from 'node:assert';
import { CommunityDetector } from '../../graph/CommunityDetector';
import { CodeGraph } from '../../graph/CodeGraphTypes';

// I build two tight clusters joined by a single bridge edge.
function twoClusters(): CodeGraph {
  const node = (id: string) => ({ id, name: id, kind: 'function' as const, file: id[0] + '.ts', line: 1, nameColumn: 0 });
  const edge = (a: string, b: string) => ({ from: a, to: b, relation: 'calls' as const, confidence: 'extracted' as const });
  return {
    nodes: ['a1', 'a2', 'a3', 'b1', 'b2', 'b3'].map(node),
    edges: [
      edge('a1', 'a2'), edge('a2', 'a3'), edge('a3', 'a1'),
      edge('b1', 'b2'), edge('b2', 'b3'), edge('b3', 'b1'),
      edge('a1', 'b1'),
    ],
  };
}

test('separates two clusters into two subsystems', () => {
  const found = new CommunityDetector(() => twoClusters()).detect();
  assert.strictEqual(found.length, 2);
  assert.deepStrictEqual(found.map(c => c.size), [3, 3]);
});

test('keeps each cluster whole', () => {
  const found = new CommunityDetector(() => twoClusters()).detect();
  for (const c of found) {
    const prefix = c.members[0][0];
    assert.ok(c.members.every(m => m[0] === prefix), 'members share a cluster');
  }
});

test('returns nothing for an empty graph', () => {
  const found = new CommunityDetector(() => ({ nodes: [], edges: [] })).detect();
  assert.strictEqual(found.length, 0);
});
