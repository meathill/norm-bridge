// Reliability test cases for a compiled standard, run against the REAL project
// DB + extracted artifacts. This is the automated version of "open the PDF and
// check 10 quotes by hand" — it checks ALL of them, and is the make-or-break
// gate for traceability (a citation whose quote isn't actually in the source is
// a hallucination and fails the build).
//
// Run (Node 24+ ships node:sqlite; add the flag if your build still gates it):
//   node --experimental-sqlite scripts/check-citations.mjs "<项目目录或 .sqlite 路径>"
//
// Exit code: 0 = all critical checks pass; 1 = a critical check failed.
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

const arg = process.argv[2];
if (!arg) {
  console.error(
    '用法: node --experimental-sqlite scripts/check-citations.mjs <项目目录或 .sqlite 路径>',
  );
  process.exit(2);
}

let projectDir;
let dbPath;
if (existsSync(arg) && statSync(arg).isDirectory()) {
  projectDir = arg;
  dbPath = join(arg, 'db', 'normbridge.sqlite');
} else {
  dbPath = arg;
  projectDir = dirname(dirname(arg)); // <proj>/db/normbridge.sqlite -> <proj>
}
if (!existsSync(dbPath)) {
  console.error(`找不到数据库：${dbPath}`);
  process.exit(2);
}

// Fold the punctuation that legitimately differs between the model's quote and
// the PDF text — smart quotes vs straight, en/em-dashes vs hyphen — so we don't
// false-alarm on typography. Anything still unmatched is a real concern.
const normalize = (s) =>
  (s ?? '')
    .toLowerCase()
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
const MODAL = /\b(shall not|must not|shall|must|should|is required to|are required to)\b/i;
const SAMPLE = 8; // how many failing examples to print per check

const db = new DatabaseSync(dbPath);

// Build page → normalized full-page text, per source, from the extract artifacts.
// Used to verify each citation quote actually appears verbatim on its page.
const pageTextBySource = new Map();
const wholeDocBySource = new Map(); // sourceId -> normalized full-document text
function pageTextFor(sourceId) {
  if (pageTextBySource.has(sourceId)) return pageTextBySource.get(sourceId);
  const f = join(projectDir, 'artifacts', 'standards', sourceId, 'text-blocks.json');
  const map = new Map();
  if (existsSync(f)) {
    const blocks = JSON.parse(readFileSync(f, 'utf8'));
    const byPage = new Map();
    let maxPage = 0;
    for (const b of blocks) {
      maxPage = Math.max(maxPage, b.page ?? 0);
      byPage.set(b.page, `${byPage.get(b.page) ?? ''} ${b.text ?? ''}`);
    }
    for (const [p, t] of byPage) map.set(p, normalize(t));
    map.maxPage = maxPage;
    wholeDocBySource.set(sourceId, normalize([...byPage.values()].join(' ')));
  }
  pageTextBySource.set(sourceId, map);
  return map;
}

const results = [];
function record(name, critical, failures, total, samples) {
  results.push({ name, critical, failures, total, samples });
}

// ── 用例 1：每条 requirement 都要有引用地址（可追溯性）────────────────────────
{
  const total = db.prepare('SELECT COUNT(*) c FROM requirements').get().c;
  const rows = db
    .prepare(
      `SELECT r.id, r.requirement_text AS text FROM requirements r
       WHERE NOT EXISTS (SELECT 1 FROM requirement_citations rc WHERE rc.requirement_id = r.id)`,
    )
    .all();
  record(
    '每条 requirement 都有引用',
    true,
    rows.length,
    total,
    rows.slice(0, SAMPLE).map((r) => r.text?.slice(0, 100)),
  );
}

// ── 用例 2：引用 quote 必须出现在原文（抓幻觉）★最关键 ───────────────────────
// 三档判定：① 命中该页 → PASS；② 命中邻页/他页（真文本、页码偏） → WARN；
// ③ 全文都找不到 → 疑似幻觉，FAIL。
{
  const cites = db.prepare('SELECT source_id AS s, page, quote FROM citations').all();
  let total = 0;
  let onPage = 0;
  const offPage = []; // 真文本但不在标注页
  const notFound = []; // 全文找不到 → 疑似幻觉
  for (const c of cites) {
    if (c.page == null || !c.quote) continue;
    total += 1;
    const pages = pageTextFor(c.s);
    const q = normalize(c.quote);
    if (pages.get(c.page)?.includes(q)) {
      onPage += 1;
    } else if ((wholeDocBySource.get(c.s) ?? '').includes(q)) {
      // Which page does it really live on? (report the first match for debugging)
      let realPage = '?';
      for (const [p, t] of pages) {
        if (typeof p === 'number' && t.includes(q)) {
          realPage = p;
          break;
        }
      }
      offPage.push(`标注 p${c.page} 实际 p${realPage}: "${c.quote.slice(0, 70)}"`);
    } else {
      notFound.push(`p${c.page}: "${c.quote.slice(0, 80)}"`);
    }
  }
  // Critical check: only true "nowhere in the document" counts as a failure.
  record(
    '引用 quote 出现在原文（抓幻觉）',
    true,
    notFound.length,
    total,
    notFound.slice(0, SAMPLE),
  );
  // Informational: real text but page attribution is off.
  record(
    `引用页码精确命中（命中该页 ${onPage}，偏页=真文本但页号不准）`,
    false,
    offPage.length,
    total,
    offPage.slice(0, SAMPLE),
  );
}

// ── 用例 3：引用页码落在文档页数范围内 ───────────────────────────────────────
{
  const cites = db
    .prepare('SELECT source_id AS s, page FROM citations WHERE page IS NOT NULL')
    .all();
  const fails = [];
  for (const c of cites) {
    const pages = pageTextFor(c.s);
    const maxPage = pages.maxPage ?? 0;
    if (c.page < 1 || (maxPage > 0 && c.page > maxPage))
      fails.push(`page ${c.page} (max ${maxPage})`);
  }
  record('引用页码在文档范围内', true, fails.length, cites.length, fails.slice(0, SAMPLE));
}

// ── 用例 4：requirement 文本含情态动词（确实是“规范”而非随机句）───────────────
{
  const rows = db.prepare('SELECT requirement_text AS text FROM requirements').all();
  const fails = rows.filter((r) => !MODAL.test(r.text ?? ''));
  record(
    'requirement 含 shall/must 等情态动词',
    false,
    fails.length,
    rows.length,
    fails.slice(0, SAMPLE).map((r) => r.text?.slice(0, 100)),
  );
}

// ── 用例 5：requirement.clause_id 闭环（不悬空）───────────────────────────────
{
  const total = db.prepare('SELECT COUNT(*) c FROM requirements').get().c;
  const dangling = db
    .prepare(
      `SELECT COUNT(*) c FROM requirements r
       WHERE r.clause_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM clauses cl WHERE cl.id = r.clause_id)`,
    )
    .get().c;
  record('requirement 的 clause 链接不悬空', true, dangling, total, []);
}

db.close();

// ── 输出 ─────────────────────────────────────────────────────────────────────
console.log(`检查数据库：${dbPath}\n`);
let criticalFailed = false;
for (const r of results) {
  const ok = r.failures === 0;
  if (!ok && r.critical) criticalFailed = true;
  const tag = ok ? '✅ PASS' : r.critical ? '❌ FAIL' : '⚠️  WARN';
  console.log(
    `${tag}  ${r.name} — ${r.total - r.failures}/${r.total} 通过${r.failures ? `，${r.failures} 失败` : ''}`,
  );
  for (const s of r.samples) console.log(`        · ${s}`);
}
console.log(`\n${criticalFailed ? '❌ 有关键用例失败（见上）。' : '✅ 全部关键用例通过。'}`);
process.exit(criticalFailed ? 1 : 0);
