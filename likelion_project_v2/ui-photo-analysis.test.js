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
  // 사진 단계는 REPAIR_ORDER 에서 photos 위치(index 7)와 매칭되고,
  // 실제 첨부 사진이 없으면 텍스트만으로는 진행할 수 없습니다.
  assert.match(html, /Consult\.REPAIR_ORDER\[c\.step\] === 'photos'/);
  assert.match(html, /!c\.photos\.length && text !== '사진 없이 진행할게요'/);
});
