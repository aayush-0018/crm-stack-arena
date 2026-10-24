import fs from 'fs';
import path from 'path';
import { pool } from '../src/db/pool';
import { withTransaction } from '../src/db/tx';

const DIR = path.join(__dirname, '..', 'db', 'migrations');

async function main() {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  const applied = new Set(
    (await pool.query(`SELECT filename FROM schema_migrations`)).rows.map((r) => r.filename as string),
  );

  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(DIR, file), 'utf8');
    await withTransaction(async (c) => {
      await c.query(sql);
      await c.query(`INSERT INTO schema_migrations (filename) VALUES ($1)`, [file]);
    });
    console.log(`applied ${file}`);
  }
  console.log('migrations up to date');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
