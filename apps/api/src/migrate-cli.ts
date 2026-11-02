import { loadConfig } from './config.js';
import { createPool, migrate } from './db.js';

const pool = createPool(loadConfig().databaseUrl);
try {
  const applied = await migrate(pool, undefined, (m) => console.info(m));
  console.info(applied.length ? `Hotovo (${applied.length} migrací).` : 'Databáze je aktuální.');
} finally {
  await pool.end();
}
