// Přihlášení e-mailem a heslem + serverové session.
// DOČASNÉ řešení pro MVP, dokud nebude rozhodnuté ADR k autentizaci (magic link / OIDC / passkeys).
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import type pg from 'pg';

export const SESSION_COOKIE = 'ms_session';
export const SESSION_TTL_MS = 14 * 24 * 3600 * 1000;

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function scrypt(password: string, salt: Buffer, keylen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password.normalize('NFKC'), salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 64 * 1024 * 1024 });
  return { salt, hash, params: SCRYPT };
}

export async function verifyPassword(password: string, stored: { salt: Buffer; hash: Buffer; params: typeof SCRYPT }) {
  const { N, r, p, keylen } = stored.params;
  const candidate = await scrypt(password, stored.salt, keylen, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return candidate.length === stored.hash.length && timingSafeEqual(candidate, stored.hash);
}

const sha256 = (token: string) => createHash('sha256').update(token).digest();

// Falešný záznam pro neexistující účet, aby odpověď trvala stejně dlouho (bez enumerace e-mailů).
let dummy: Promise<{ salt: Buffer; hash: Buffer; params: typeof SCRYPT }> | null = null;

export class AuthRepo {
  constructor(private readonly pool: pg.Pool, private readonly now: () => Date = () => new Date()) {}

  async setPassword(userId: string, password: string) {
    if (password.length < 8) throw new Error('Heslo musí mít aspoň 8 znaků');
    const { salt, hash, params } = await hashPassword(password);
    await this.pool.query(
      `insert into credentials (user_id, algo, params, salt, hash, updated_at) values ($1, 'scrypt', $2, $3, $4, now())
       on conflict (user_id) do update set params = excluded.params, salt = excluded.salt, hash = excluded.hash, updated_at = now()`,
      [userId, JSON.stringify(params), salt, hash],
    );
    // Změna hesla zneplatní všechny existující session.
    await this.pool.query('delete from sessions where user_id = $1', [userId]);
  }

  /** Vrátí userId, pokud heslo sedí. */
  async checkPassword(email: string, password: string): Promise<string | null> {
    const r = await this.pool.query(
      `select c.user_id, c.params, c.salt, c.hash from users u join credentials c on c.user_id = u.id where lower(u.email) = lower($1)`,
      [email],
    );
    const row = r.rows[0];
    if (!row) {
      dummy ??= hashPassword('dummy-password-for-timing');
      await verifyPassword(password, await dummy);
      return null;
    }
    const ok = await verifyPassword(password, { salt: row.salt, hash: row.hash, params: row.params });
    return ok ? row.user_id : null;
  }

  async createSession(userId: string, meta: { userAgent?: string; ip?: string } = {}) {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(this.now().getTime() + SESSION_TTL_MS);
    await this.pool.query(
      'insert into sessions (token_hash, user_id, expires_at, user_agent, ip) values ($1, $2, $3, $4, $5)',
      [sha256(token), userId, expiresAt, meta.userAgent?.slice(0, 300) ?? null, meta.ip ?? null],
    );
    return { token, expiresAt };
  }

  async userIdForToken(token: string): Promise<string | null> {
    if (!token || token.length > 200) return null;
    const r = await this.pool.query('select user_id from sessions where token_hash = $1 and expires_at > $2', [sha256(token), this.now()]);
    return r.rows[0]?.user_id ?? null;
  }

  async deleteSession(token: string) {
    await this.pool.query('delete from sessions where token_hash = $1', [sha256(token)]);
  }

  async purgeExpired() {
    const r = await this.pool.query('delete from sessions where expires_at <= $1', [this.now()]);
    return r.rowCount ?? 0;
  }
}
