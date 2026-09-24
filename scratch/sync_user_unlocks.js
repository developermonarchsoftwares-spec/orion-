const { Pool } = require('pg');
require('dotenv').config({ path: 'ownus/.env.local' });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  try {
    // 1. Give developer.monarchsoftwares@gmail.com all unlocks
    const devUserId = '7f42be82-dd77-4e6d-a4d8-ba0c74fab121';
    const insertRes = await pool.query(`
      INSERT INTO lead_unlocks (id, user_id, business_id, credits_spent, unlocked_at)
      SELECT gen_random_uuid(), $1, b.id, 1, NOW()
      FROM businesses b
      WHERE (b.status = 'PUBLISHED' OR LOWER(b.status::text) = 'published')
      AND NOT EXISTS (
        SELECT 1 FROM lead_unlocks lu 
        WHERE lu.user_id = $1 
        AND lu.business_id = b.id
      )
    `, [devUserId]);
    console.log('Inserted unlocks for developer.monarchsoftwares@gmail.com:', insertRes.rowCount);

    // 2. Also ensure any other registered user in users table has all published unlocks
    const allUsers = await pool.query(`SELECT id, email FROM users`);
    for (const u of allUsers.rows) {
      const uRes = await pool.query(`
        INSERT INTO lead_unlocks (id, user_id, business_id, credits_spent, unlocked_at)
        SELECT gen_random_uuid(), $1, b.id, 1, NOW()
        FROM businesses b
        WHERE (b.status = 'PUBLISHED' OR LOWER(b.status::text) = 'published')
        AND NOT EXISTS (
          SELECT 1 FROM lead_unlocks lu 
          WHERE lu.user_id = $1 
          AND lu.business_id = b.id
        )
      `, [u.id]);
      if (uRes.rowCount > 0) {
        console.log(`Inserted ${uRes.rowCount} unlocks for user ${u.email} (${u.id})`);
      }
    }

    const counts = await pool.query('SELECT u.email, lu.user_id, count(*) FROM lead_unlocks lu JOIN users u ON lu.user_id = u.id GROUP BY u.email, lu.user_id');
    console.log('Final counts:', counts.rows);
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await pool.end();
  }
}

run();
