import dns from 'node:dns';
import net from 'node:net';
import { promisify } from 'node:util';

const lookup = promisify(dns.lookup);

function privateAddress(address) {
  if (net.isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168);
  }
  return address === '::1' || address.startsWith('fc') ||
    address.startsWith('fd') || address.startsWith('fe80:');
}

export function parsePublicProductUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(url.protocol) ||
        url.username || url.password ||
        url.hostname === 'localhost' ||
        privateAddress(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

export async function assertPublicProductUrl(value) {
  const url = parsePublicProductUrl(value);
  if (!url) return null;
  const addresses = await lookup(url.hostname, { all: true });
  return addresses.some(({ address }) => privateAddress(address)) ? null : url;
}

export const PRODUCT_LINK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['identified_item', 'brand', 'model', 'reference', 'details', 'source_url'],
  properties: {
    identified_item: { type: 'string' },
    brand: { type: 'string' },
    model: { type: 'string' },
    reference: { type: 'string' },
    details: { type: 'array', items: { type: 'string' } },
    source_url: { type: 'string' }
  }
};

export const buildProductLinkPrompt = (url) => `
다음 공개 상품 페이지를 직접 확인해 제품을 식별하세요: ${url}

- 페이지의 제목, 설명, 사양에서 브랜드, 모델, 라인, 크기, 소재, 색상,
  시계라면 레퍼런스 번호를 찾습니다.
- 페이지에서 확인되지 않은 정보는 추측하지 않습니다.
- identified_item 은 상담에 바로 쓸 수 있게 브랜드 + 모델 + 레퍼런스를 합쳐 적습니다.
- source_url 은 확인한 원래 URL을 그대로 적습니다.
`;
