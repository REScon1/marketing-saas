// Nastaví heslo uživateli (dočasné admin řešení, než bude hotová autentizace dle ADR).
// Použití: pnpm --filter @ms/api set-password <email>   (heslo se čte z proměnné NEW_PASSWORD)
import { AuthRepo } from './auth.js';
import { loadConfig } from './config.js';
import { createPool } from './db.js';

const email = process.argv[2];
const password = process.env.NEW_PASSWORD;
if (!email || !password) {
  console.error('Použití: NEW_PASSWORD=… pnpm --filter @ms/api set-password <email>');
  process.exit(2);
}
const pool = createPool(loadConfig().databaseUrl);
try {
  const r = await pool.query<{ id: string }>('select id from users where lower(email) = lower($1)', [email]);
  if (!r.rows[0]) {
    console.error(`Uživatel ${email} neexistuje`);
    process.exitCode = 1;
  } else {
    await new AuthRepo(pool).setPassword(r.rows[0].id, password);
    console.info(`Heslo pro ${email} nastaveno (existující session zneplatněny).`);
  }
} finally {
  await pool.end();
}
