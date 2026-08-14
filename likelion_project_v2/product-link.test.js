import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PRODUCT_LINK_SCHEMA,
  buildProductLinkPrompt,
  parsePublicProductUrl
} from './product-link.js';

test('only public http product URLs are accepted', () => {
  assert.equal(parsePublicProductUrl('https://www.rolex.com/watches/submariner/m126610ln-0001').hostname, 'www.rolex.com');
  assert.equal(parsePublicProductUrl('http://127.0.0.1/admin'), null);
  assert.equal(parsePublicProductUrl('http://192.168.0.3/product'), null);
  assert.equal(parsePublicProductUrl('file:///C:/secret.txt'), null);
});

test('product link analysis returns a specific product identity contract', () => {
  assert.ok(PRODUCT_LINK_SCHEMA.required.includes('identified_item'));
  assert.ok(PRODUCT_LINK_SCHEMA.required.includes('reference'));
  assert.match(
    buildProductLinkPrompt('https://www.rolex.com/watches/submariner/m126610ln-0001'),
    /브랜드.*모델.*레퍼런스/s
  );
});
