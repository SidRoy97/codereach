import { test } from 'node:test';
import assert from 'node:assert';
import { DuplicateDetector } from '../../graph/DuplicateDetector';

const orig = 'function applyDiscount(order, rate) { let total = 0; for (const line of order.items) { total += line.price * line.qty; } const discount = total * rate; return total - discount; }';
const reformatted = 'function applyDiscount(order, rate) {\n  let total = 0;\n  for (const line of order.items) {\n    total += line.price * line.qty;\n  }\n  const discount = total * rate;\n  return total - discount;\n}';
const addedLine = 'function applyDiscount(order, rate) { let total = 0; for (const line of order.items) { total += line.price * line.qty; } const discount = total * rate; console.log(discount); return total - discount; }';
const unrelated = 'function parseConfig(path) { const raw = readFile(path); const cfg = JSON.parse(raw); validate(cfg); return cfg; }';

test('identical functions are flagged at ~1.0', () => {
  const pairs = new DuplicateDetector().findNearDuplicates([{ id: 'a', text: orig }, { id: 'b', text: orig }], 0.8);
  assert.strictEqual(pairs.length, 1);
  assert.ok(pairs[0].similarity > 0.99, `similarity ${pairs[0].similarity}`);
});

test('reformatted copy (whitespace only) is caught', () => {
  const pairs = new DuplicateDetector().findNearDuplicates([{ id: 'a', text: orig }, { id: 'b', text: reformatted }], 0.8);
  assert.strictEqual(pairs.length, 1);
  assert.ok(pairs[0].similarity > 0.95, `similarity ${pairs[0].similarity}`);
});

test('unrelated functions are not flagged', () => {
  const pairs = new DuplicateDetector().findNearDuplicates([{ id: 'a', text: orig }, { id: 'b', text: unrelated }], 0.8);
  assert.strictEqual(pairs.length, 0);
});

test('a high threshold excludes a copy with an added statement', () => {
  const items = [{ id: 'a', text: orig }, { id: 'c', text: addedLine }];
  assert.strictEqual(new DuplicateDetector().findNearDuplicates(items, 0.95).length, 0);
});
