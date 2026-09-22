const { Pool } = require('pg');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function getDatabaseUrl() {
  const envPaths = [
    path.resolve(process.cwd(), '.env.local'),
    path.resolve(process.cwd(), '.env'),
  ];
  for (const p of envPaths) {
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, 'utf8');
      const match = content.match(/^DATABASE_URL\s*=\s*["']?([^"'\r\n]+)["']?/m);
      if (match && match[1]) {
        return match[1].trim();
      }
    }
  }
  return process.env.DATABASE_URL;
}

const dbUrl = getDatabaseUrl();
console.log('Connecting to PostgreSQL database for login test...');

const pool = new Pool({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false },
});

function verifyPassword(password, storedHashStr) {
  if (!storedHashStr) return false;
  if (storedHashStr.startsWith('$2')) {
    try {
      const bcrypt = require('bcrypt');
      return bcrypt.compareSync(password, storedHashStr);
    } catch {
      return false;
    }
  }
  if (!storedHashStr.includes(':')) return false;
  const [salt, hash] = storedHashStr.split(':');
  const verifyHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(verifyHash, 'hex'));
  } catch {
    return false;
  }
}

async function runTest() {
  const client = await pool.connect();
  try {
    console.log('--- Testing User Login Lookup ---');
    const res = await client.query('SELECT id, email, password_hash, first_name, last_name, role, status, metadata FROM users LIMIT 5');
    console.log(`Found ${res.rows.length} users in database.`);
    
    if (res.rows.length === 0) {
      console.log('No users found in database.');
      return;
    }

    const testUser = res.rows[0];
    console.log(`Selected User for test: ID=${testUser.id}, Email=${testUser.email}, Status=${testUser.status}`);

    // Single-device session ID test
    const newSessionId = crypto.randomUUID();
    const currentMeta = typeof testUser.metadata === 'object' && testUser.metadata ? testUser.metadata : {};
    const updatedMeta = { ...currentMeta, activeSessionId: newSessionId };

    await client.query(
      'UPDATE users SET metadata = $1::jsonb, last_login_at = NOW(), updated_at = NOW() WHERE id = $2',
      [JSON.stringify(updatedMeta), testUser.id]
    );

    const recheck = await client.query('SELECT metadata FROM users WHERE id = $1', [testUser.id]);
    const savedSessionId = recheck.rows[0]?.metadata?.activeSessionId;

    if (savedSessionId === newSessionId) {
      console.log('PASS: Single-Device activeSessionId updated and persisted successfully in PostgreSQL!');
    } else {
      console.error(`FAIL: Expected ${newSessionId}, got ${savedSessionId}`);
    }

  } catch (err) {
    console.error('Test error:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

runTest();
