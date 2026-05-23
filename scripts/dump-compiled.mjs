// Dump compiled requirements + their citation addresses straight from a project's
// SQLite DB, so you can eyeball them against the source PDF — independent of the
// search ranking. Validates COMPILE accuracy (is each requirement real and is its
// page+quote verbatim?) before you test SEARCH.
//
// Run (Node 24 ships node:sqlite; add the flag if your build still gates it):
//   node --experimental-sqlite scripts/dump-compiled.mjs "<项目目录或 .sqlite 路径>" [样本数]
// e.g.
//   node --experimental-sqlite scripts/dump-compiled.mjs "/Users/meathill/Documents/nb阿联酋" 40
import { DatabaseSync } from 'node:sqlite';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const arg = process.argv[2];
const sampleN = Number.parseInt(process.argv[3] ?? '40', 10) || 40;
if (!arg) {
  console.error(
    '用法: node --experimental-sqlite scripts/dump-compiled.mjs <项目目录或 .sqlite 路径> [样本数]',
  );
  process.exit(1);
}

// Accept either the project dir (…/db/normbridge.sqlite) or a direct .sqlite path.
let dbPath = arg;
if (existsSync(arg) && statSync(arg).isDirectory()) {
  dbPath = join(arg, 'db', 'normbridge.sqlite');
}
if (!existsSync(dbPath)) {
  console.error(`找不到数据库：${dbPath}`);
  process.exit(1);
}

const db = new DatabaseSync(dbPath);
const count = (sql) => db.prepare(sql).get()?.c ?? 0;

console.log(`DB: ${dbPath}\n`);
console.log('总量：');
console.log(`  标准   ${count('SELECT COUNT(*) c FROM standards')}`);
console.log(`  条款   ${count('SELECT COUNT(*) c FROM clauses')}`);
console.log(`  规范   ${count('SELECT COUNT(*) c FROM requirements')}`);
console.log(`  引用   ${count('SELECT COUNT(*) c FROM citations')}`);
console.log(`  引用标准 ${count('SELECT COUNT(*) c FROM standard_catalog')}`);

// How many requirements actually carry a citation address (the traceability gate).
const withCite = count('SELECT COUNT(DISTINCT requirement_id) c FROM requirement_citations');
const totalReq = count('SELECT COUNT(*) c FROM requirements');
console.log(
  `\n带引用地址的 requirement：${withCite}/${totalReq}` +
    (totalReq ? `（${Math.round((withCite / totalReq) * 100)}%）` : ''),
);

console.log(`\n样本（前 ${sampleN} 条 requirement，按条款页码排序）：`);
const rows = db
  .prepare(
    `SELECT r.requirement_text AS text, r.severity AS severity,
            cl.clause_no AS clauseNo, cl.title AS clauseTitle,
            cit.page AS page, cit.quote AS quote
     FROM requirements r
     LEFT JOIN clauses cl ON cl.id = r.clause_id
     LEFT JOIN requirement_citations rc ON rc.requirement_id = r.id
     LEFT JOIN citations cit ON cit.id = rc.citation_id
     ORDER BY cl.page_start, r.id
     LIMIT ?`,
  )
  .all(sampleN);

for (const r of rows) {
  const sev = r.severity ? `[${r.severity}]` : '[?]';
  const where = r.clauseNo
    ? ` (条款 ${r.clauseNo}${r.clauseTitle ? ` ${r.clauseTitle}` : ''})`
    : '';
  const cite = r.page != null ? `p${r.page}: “${(r.quote ?? '').slice(0, 160)}”` : '（无引用地址）';
  console.log(`\n${sev}${where}`);
  console.log(`  规范: ${(r.text ?? '').slice(0, 220)}`);
  console.log(`  引用: ${cite}`);
}

console.log('\n引用标准（catalog）：');
for (const c of db
  .prepare('SELECT code, origin FROM standard_catalog ORDER BY origin DESC, code LIMIT 40')
  .all()) {
  console.log(`  [${c.origin}] ${c.code}`);
}

db.close();
