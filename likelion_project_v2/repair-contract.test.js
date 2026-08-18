import assert from 'node:assert/strict';
import test from 'node:test';

import { REPAIR_REPORT_SCHEMA, REPAIR_SYSTEM } from './prompts.js';

test('repair consultation acts as luxury product management and collects identity fields', () => {
  assert.match(REPAIR_SYSTEM, /명품 관리.*판별/s);
  for (const field of ['category', 'variant', 'product_name', 'reference', 'repair_area']) {
    assert.match(REPAIR_SYSTEM, new RegExp(field));
  }
  assert.match(REPAIR_SYSTEM, /예상 수리비.*구간/s);
});

test('repair estimate items expose repair area and price range', () => {
  const item = REPAIR_REPORT_SCHEMA.properties.items.items;
  assert.ok(item.required.includes('repair_area'));
  assert.ok(item.required.includes('low'));
  assert.ok(item.required.includes('high'));
  assert.ok(REPAIR_REPORT_SCHEMA.required.includes('product_identity'));
  assert.ok(REPAIR_REPORT_SCHEMA.required.includes('reference'));
});
