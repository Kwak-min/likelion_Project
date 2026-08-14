import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PHOTO_ANALYSIS_SCHEMA,
  PHOTO_MARKET_SCHEMA,
  buildPhotoMarketSearch
} from './prompts.js';

test('photo analysis contract exposes authenticity probability and market formation', () => {
  assert.ok(PHOTO_ANALYSIS_SCHEMA.required.includes('authenticity_likelihood'));
  assert.ok(PHOTO_ANALYSIS_SCHEMA.required.includes('identified_item'));
  assert.ok(PHOTO_MARKET_SCHEMA.required.includes('market_low'));
  assert.ok(PHOTO_MARKET_SCHEMA.required.includes('market_mode'));
  assert.ok(PHOTO_MARKET_SCHEMA.required.includes('market_high'));
  assert.deepEqual(PHOTO_ANALYSIS_SCHEMA.properties.authenticity_likelihood.minimum, 0);
  assert.deepEqual(PHOTO_ANALYSIS_SCHEMA.properties.authenticity_likelihood.maximum, 100);
});

test('photo market prompt requests current comparable sales and price drivers', () => {
  const prompt = buildPhotoMarketSearch({
    identified_item: '롤렉스 서브마리너',
    condition_grade: 'B+',
    condition_notes: '베젤 사용감'
  });

  assert.match(prompt, /최근 3개월/);
  assert.match(prompt, /가격 형성 요인/);
  assert.match(prompt, /롤렉스 서브마리너/);
});
