import fs from 'node:fs/promises';
import OpenAI from 'openai';

const AUDIT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'findings'],
  properties: {
    summary: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['scenario_id', 'severity', 'issue', 'expected_fix'],
        properties: {
          scenario_id: { type: 'string' },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          issue: { type: 'string' },
          expected_fix: { type: 'string' }
        }
      }
    }
  }
};

export async function auditQa({
  inputPath,
  outputPath,
  model = process.env.MODEL_CHAT || 'gpt-5.6-luna'
}) {
  const qa = JSON.parse(await fs.readFile(inputPath, 'utf8'));
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await openai.responses.create({
    model,
    instructions: `당신은 명품 관리 상담 QA 감사자입니다.
10개 시나리오의 입력, 응답, slots, next_slot, 자동 violations를 검토하세요.
브랜드/제품 식별, 상세 품종, 제품명, 레퍼런스, 수리 위치, 증상 구조 적합성,
예상 수리비, 모드 일치, 이전 슬롯 고착, 범위 외 응답을 감사합니다.
실제 사용자 피해나 상담 진행을 막는 문제는 high입니다. 추측하지 마세요.`,
    input: JSON.stringify(qa.results),
    text: {
      format: {
        type: 'json_schema',
        name: 'qa_audit',
        schema: AUDIT_SCHEMA,
        strict: true
      }
    },
    max_output_tokens: 2200
  });
  const text = response.output_text || response.output?.flatMap(item =>
    item.content?.map(content => content.text || '') || []
  ).join('') || '';
  const audit = JSON.parse(text);
  await fs.writeFile(outputPath, `${JSON.stringify(audit, null, 2)}\n`);
  return audit;
}

if (process.argv[1]?.endsWith('qa-audit.mjs')) {
  const audit = await auditQa({
    inputPath: process.argv[2],
    outputPath: process.argv[3]
  });
  console.log(JSON.stringify({
    findings: audit.findings.length,
    high: audit.findings.filter(finding => finding.severity === 'high').length,
    output: process.argv[3]
  }));
}
