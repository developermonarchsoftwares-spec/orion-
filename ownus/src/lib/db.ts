import { Pool } from 'pg';

let pool: Pool | null = null;

export function getDbPool(): Pool | null {
  let dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return null;
  if (dbUrl.includes('-pooler.')) {
    dbUrl = dbUrl.replace('-pooler.', '.');
  }
  if (!pool) {
    pool = new Pool({
      connectionString: dbUrl,
      ssl: { rejectUnauthorized: false },
      max: 3,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }
  return pool;
}

export async function queryDb<T = any>(text: string, params: any[] = []): Promise<T[]> {
  const p = getDbPool();
  if (!p) return [];
  try {
    const res = await p.query(text, params);
    return res.rows;
  } catch (err) {
    console.error('[Database Query Error]', err);
    return [];
  }
}
