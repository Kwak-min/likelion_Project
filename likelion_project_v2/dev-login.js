export function devLoginUser(email, password, production) {
  if (production || email !== 'a@naver.com' || password !== 'aaaaaaaa') return null;
  return {
    id: 'U-DEMO',
    name: '데모 사용자',
    email: 'a@naver.com',
    phone: '010-0000-0000',
    role: 'customer'
  };
}
