import assert from 'node:assert/strict';
import test from 'node:test';

import { QA_SCENARIOS, validateQaResult } from './qa-runner.mjs';

test('QA runner defines exactly ten independent consultation scenarios', () => {
  assert.equal(QA_SCENARIOS.length, 10);
  assert.equal(new Set(QA_SCENARIOS.map(scenario => scenario.id)).size, 10);
  assert.ok(QA_SCENARIOS.every(scenario =>
    scenario.mode && scenario.history.length && typeof scenario.validate === 'function'
  ));
});

test('QA validator reports response contract violations', () => {
  const result = validateQaResult(QA_SCENARIOS[0], {
    status: 200,
    body: { reply: '', slots: {}, next_slot: 'unknown' }
  });
  assert.ok(result.violations.length >= 2);
});
