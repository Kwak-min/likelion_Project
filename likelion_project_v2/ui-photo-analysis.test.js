import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');

test('photo analysis UI renders likelihood, price drivers, and extra photo needs', () => {
  assert.match(html, /진품 가능성 \$\{r\.auth\.likelihood/);
  assert.match(html, /현재 가격 형성 근거/);
  assert.match(html, /need_more_photos/);
});

test('repair text at photo step is not silently converted into zero photos', () => {
  assert.match(html, /if\(c\.step === 2 && !text\)/);
});
