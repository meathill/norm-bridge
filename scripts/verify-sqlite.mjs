import { app } from 'electron';

async function main() {
  await app.whenReady();

  console.log('[verify-sqlite] electron version', process.versions.electron);
  console.log('[verify-sqlite] node version    ', process.versions.node);

  let sqliteModule;
  try {
    sqliteModule = await import('node:sqlite');
    console.log('[verify-sqlite] import("node:sqlite"): OK');
  } catch (err) {
    console.error('[verify-sqlite] import("node:sqlite") FAILED:', err.message);
    app.exit(2);
    return;
  }

  try {
    const { DatabaseSync } = sqliteModule;
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)');
    db.prepare('INSERT INTO t (name) VALUES (?)').run('hello');
    const row = db.prepare('SELECT name FROM t WHERE id = 1').get();
    if (row && row.name === 'hello') {
      console.log('[verify-sqlite] in-memory read/write: OK');
      db.close();
      app.exit(0);
      return;
    }
    console.error('[verify-sqlite] unexpected row', row);
    app.exit(3);
  } catch (err) {
    console.error('[verify-sqlite] runtime error:', err.message);
    app.exit(4);
  }
}

main().catch((err) => {
  console.error('[verify-sqlite] fatal', err);
  app.exit(5);
});
