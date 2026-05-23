// LLM endpoint diagnostic — isolates "connection/client-state" vs "content".
//
// Symptom: in real compiles, sections 1-2 succeed (~30s) then section 3+ time
// out at 120s, deterministically, on two different endpoints, retries included.
// A SMALLER prompt (section 5) also fails while a LARGER one (section 1) works,
// so prompt size is NOT the cause.
//
// This script fires the EXACT SAME prompt several times in a row:
//   Phase A — one shared client, N sequential calls.
//     · If calls 1-2 pass and 3+ time out with identical content, the model
//       isn't choking on content — it's our client/connection state.
//   Phase B — only if A had failures: re-run the same prompt with a FRESH
//     client (new connection pool) per call.
//     · If B passes where A failed, it's connection-pool poisoning → fix is to
//       use a fresh connection per request.
//
// Run (needs your .env at repo root):
//   node scripts/diag-llm.mjs
// Tunables (env): DIAG_CALLS=6  DIAG_PROMPT_CHARS=46000  DIAG_TIMEOUT_MS=120000
import 'dotenv/config';
import { OpenAI } from 'openai';

const apiKey = (process.env.OPENAI_API_KEY ?? '').trim();
if (!apiKey) {
  console.error('✗ 缺少 OPENAI_API_KEY（请确认仓库根目录有 .env）');
  process.exit(1);
}
const baseURL = (process.env.OPENAI_BASE_URL ?? '').trim() || undefined;
const model =
  (process.env.NORMBRIDGE_COMPILE_MODEL ?? '').trim() ||
  (process.env.NORMBRIDGE_AGENT_MODEL ?? '').trim() ||
  'mimo-v2.5-pro';
const calls = Number.parseInt(process.env.DIAG_CALLS ?? '6', 10) || 6;
const promptChars = Number.parseInt(process.env.DIAG_PROMPT_CHARS ?? '46000', 10) || 46000;
const timeout = Number.parseInt(process.env.DIAG_TIMEOUT_MS ?? '120000', 10) || 120000;

const SYSTEM =
  'You compile one section of a technical-standard PDF into structured JSON ' +
  'with arrays clauses/requirements/references. Output ONLY a JSON object.';

// Build a fixed, realistic prompt of the requested size. Same bytes every call.
function buildPrompt(targetChars) {
  const lines = ['<page 12>'];
  let i = 0;
  let size = lines[0].length;
  while (size < targetChars) {
    const line = `  [b${1000 + i}] The contractor shall provide and install all materials in strict accordance with Section ${(i % 50) + 1}.${(i % 9) + 1}, subject to the Engineer's approval and the referenced standard ISO ${19650 + (i % 5)}-1.`;
    lines.push(line);
    size += line.length + 1;
    i += 1;
    if (i % 40 === 0) {
      const pg = `<page ${12 + i / 40}>`;
      lines.push(pg);
      size += pg.length + 1;
    }
  }
  return lines.join('\n');
}

const PROMPT = buildPrompt(promptChars);

function makeClient() {
  const opts = { apiKey, timeout, maxRetries: 0 };
  if (baseURL) opts.baseURL = baseURL;
  return new OpenAI(opts);
}

async function oneCall(client, label) {
  const t0 = Date.now();
  try {
    const res = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: PROMPT },
      ],
    });
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    const out = res.choices?.[0]?.message?.content ?? '';
    console.log(`  ${label} ✓ ${dt}s · 输出 ${out.length} 字符`);
    return true;
  } catch (err) {
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    const e = err ?? {};
    const detail = [e.name, e.status && `HTTP ${e.status}`, e.code && `code=${e.code}`, e.message]
      .filter(Boolean)
      .join(' · ');
    console.log(`  ${label} ✗ ${dt}s · ${detail}`);
    return false;
  }
}

async function main() {
  console.log(
    `诊断开始 · model=${model} · endpoint=${baseURL ?? 'OpenAI 默认'} · ` +
      `prompt=${PROMPT.length} 字符(~${Math.round(PROMPT.length / 4)} tokens) · timeout=${timeout / 1000}s`,
  );
  console.log(`\n[Phase A] 同一个 client，连续 ${calls} 次相同请求：`);
  const shared = makeClient();
  const results = [];
  for (let i = 1; i <= calls; i++) {
    results.push(await oneCall(shared, `A#${i}`));
  }

  const firstFail = results.indexOf(false);
  if (firstFail === -1) {
    console.log(
      '\n结论：相同 prompt 连续多次都成功 → 不是连接/状态问题。' +
        '真机失败更可能与“那几节的具体内容”有关（用 DIAG_PROMPT_CHARS 调大复现，或贴出失败节文本）。',
    );
    return;
  }

  console.log(
    `\nPhase A 在第 ${firstFail + 1} 次开始失败（prompt 完全相同）→ 强烈指向客户端连接/状态累积。`,
  );
  console.log('\n[Phase B] 每次都用全新 client（全新连接池），相同请求 3 次：');
  let freshOk = 0;
  for (let i = 1; i <= 3; i++) {
    if (await oneCall(makeClient(), `B#${i}`)) freshOk += 1;
  }
  if (freshOk >= 2) {
    console.log(
      '\n结论：全新连接稳定成功，而共享连接复用后失败 → 确认是 HTTP keep-alive 连接池“中毒”。' +
        '修复方向：每个请求用全新连接（禁用 keep-alive / 每节重建 client / 自定义 dispatcher）。',
    );
  } else {
    console.log(
      '\n结论：全新连接也失败 → 不是单纯连接复用问题，可能是端点对该 key 的并发/排队，或请求体本身。需进一步定位。',
    );
  }
}

main().catch((e) => {
  console.error('诊断脚本异常：', e);
  process.exit(1);
});
