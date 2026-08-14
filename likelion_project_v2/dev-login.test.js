import assert from 'node:assert/strict';
import test from 'node:test';

import { devLoginUser } from './dev-login.js';

test('a@naver.com/aaaaaaaa logs in only outside production', () => {
  assert.equal(devLoginUser('a@naver.com', 'wrong', false), null);
  assert.equal(devLoginUser('a@naver.com', 'aaaaaaaa', true), null);
  assert.deepEqual(devLoginUser('a@naver.com', 'aaaaaaaa', false), {
    id: 'U-DEMO',
    name: '데모 사용자',
    email: 'a@naver.com',
    phone: '010-0000-0000',
    role: 'customer'
  });
});
