import { Pool, QueryResult, types } from 'pg';
import { env } from '../config/env';

// int8 (BIGINT / COUNT) -> number. Paise amounts stay well below 2^53.
types.setTypeParser(20, (v) => parseInt(v, 10));
// date -> 'YYYY-MM-DD' string (avoid timezone shifts)
types.setTypeParser(1082, (v) => v);

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  // Hosted Postgres requires TLS. rejectUnauthorized stays off because Supabase's
  // pooler presents a cert this client has no CA for; the connection is still encrypted.
  ssl: env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  max: 5,
});

// Anything that can run a query: the pool or a transaction client.
export interface Db {
  query(text: string, values?: unknown[]): Promise<QueryResult<any>>;
}
