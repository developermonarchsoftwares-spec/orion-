'use strict';
/**
 * Target selection shared by the scratch_*.js scripts.
 *
 * These scripts create, change and delete test data. They therefore never carry a connection string of their own and only run
 * against a LOCAL database that is named explicitly in SCRATCH_DATABASE_URL. DATABASE_URL (which in a developer's .env.local can
 * point at a shared or production database) is deliberately not consulted.
 *
 * The database must also be a DISPOSABLE Orion database (orion_scratch, orion_test_*, orion_verify_*, ...). The real `orion_db` and any
 * other application's database on the same local server are refused, so test data can never land in real data. Create one with
 * `CREATE DATABASE orion_scratch;` and apply the migrations to it.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function isLocalDatabaseUrl(url) {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return LOCAL_HOSTS.has(host) || host.endsWith('.localhost');
  } catch {
    return false;
  }
}

/** Same rule as apps/api/src/database/db-guard.ts (isDisposableOrionDatabase); a test keeps the two in step. */
function isDisposableOrionDatabase(name) {
  return /^orion_(scratch|test|verify)[a-z0-9_]*$/.test(name) || /^orion_[a-z0-9_]*_(scratch|test|verify)[a-z0-9_]*$/.test(name);
}

function databaseNameOf(url) {
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
  } catch {
    return '';
  }
}

function requireLocalDatabaseUrl(env = process.env) {
  const url = (env.SCRATCH_DATABASE_URL || '').trim();
  if (!url) {
    console.error('SCRATCH_DATABASE_URL is not set. Point it at a disposable LOCAL database to run this script.');
    process.exit(1);
  }
  if (!isLocalDatabaseUrl(url)) {
    console.error('SCRATCH_DATABASE_URL does not point at a local database host. This script writes data and refuses to run (value not printed).');
    process.exit(1);
  }
  if (!isDisposableOrionDatabase(databaseNameOf(url))) {
    console.error('SCRATCH_DATABASE_URL must name a disposable Orion database (orion_scratch, orion_test_*, orion_verify_*). The real orion_db and databases of other applications are refused. Value not printed.');
    process.exit(1);
  }
  return url;
}

/**
 * For the older scratch scripts that read DATABASE_URL from a .env file: validate SCRATCH_DATABASE_URL (as above) and make it the
 * DATABASE_URL of this process. dotenv never overrides an existing variable, so the script's own dotenv call cannot swap it back.
 * Call it as the FIRST statement of the script.
 */
function guardLegacyScratchWriter(env = process.env) {
  const url = requireLocalDatabaseUrl(env);
  env.DATABASE_URL = url;
  return url;
}

module.exports = { isLocalDatabaseUrl, isDisposableOrionDatabase, requireLocalDatabaseUrl, guardLegacyScratchWriter };
