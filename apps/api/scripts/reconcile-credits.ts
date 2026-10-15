/**
 * READ-ONLY credit and billing reconciliation. It never writes: everything runs inside one READ ONLY transaction, and it prints counts
 * (and, with --details, shortened wallet ids; never e-mails, names or any other personal data).
 *
 *   npm run db:reconcile-credits             summary
 *   npm run db:reconcile-credits -- --details  also list the first wallets that fail each check
 *
 * Exit code 1 when a HARD invariant is broken (a wallet that is negative or does not add up, a payment credited twice, a duplicate
 * invoice or unlock). The softer checks (a ledger that does not sum to the balance, unlock charges without an unlock row) are
 * reported as warnings: they have legitimate historical causes (rows removed by clean-up scripts, a business deleted after it was
 * unlocked) and need a human to look at them before launch.
 *
 * Meant for the local database and, with its connection URL, for a production copy or the production database before launch.
 */
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { Pool } from 'pg';
import { verifiedConnection } from '../src/database/tls';
import { assertLocalDatabaseAllowed, describeTarget } from '../src/database/db-guard';

interface ICheck {
  id: string;
  label: string;
  hard: boolean;
  count: string;
  sample?: string;
}

const CHECKS: ICheck[] = [
  { id: 'balance-sum', label: 'wallets whose balance is not daily + purchased', hard: true,
    count: `SELECT count(*)::int AS n FROM user_wallets WHERE balance <> daily_credits + purchased_credits`,
    sample: `SELECT left(id::text, 8) AS wallet FROM user_wallets WHERE balance <> daily_credits + purchased_credits LIMIT 20` },
  { id: 'negative', label: 'wallets with a negative balance, daily or purchased amount', hard: true,
    count: `SELECT count(*)::int AS n FROM user_wallets WHERE daily_credits < 0 OR purchased_credits < 0 OR balance < 0`,
    sample: `SELECT left(id::text, 8) AS wallet FROM user_wallets WHERE daily_credits < 0 OR purchased_credits < 0 OR balance < 0 LIMIT 20` },
  { id: 'duplicate-credit', label: 'payments credited more than once (same reference and type)', hard: true,
    count: `SELECT count(*)::int AS n FROM (SELECT 1 FROM credit_transactions WHERE reference_id IS NOT NULL AND type::text IN ('PACKAGE_PURCHASE','PURCHASE') GROUP BY reference_id, type HAVING count(*) > 1) x` },
  { id: 'duplicate-invoice', label: 'payments with more than one invoice', hard: true,
    count: `SELECT count(*)::int AS n FROM (SELECT 1 FROM invoices GROUP BY payment_id HAVING count(*) > 1) x` },
  { id: 'duplicate-refund', label: 'payments refunded more than once', hard: true,
    count: `SELECT count(*)::int AS n FROM (SELECT 1 FROM refunds GROUP BY payment_id HAVING count(*) > 1) x` },
  { id: 'duplicate-unlock', label: 'customer/business pairs unlocked more than once', hard: true,
    count: `SELECT count(*)::int AS n FROM (SELECT 1 FROM lead_unlocks GROUP BY user_id, business_id HAVING count(*) > 1) x` },
  { id: 'ledger-sum', label: 'wallets whose ledger does not add up to the balance', hard: false,
    count: `SELECT count(*)::int AS n FROM user_wallets w WHERE w.balance <> coalesce((SELECT sum(amount) FROM credit_transactions t WHERE t.wallet_id = w.id), 0)`,
    sample: `SELECT left(w.id::text, 8) AS wallet, w.balance, coalesce((SELECT sum(amount) FROM credit_transactions t WHERE t.wallet_id = w.id), 0)::int AS ledger_sum FROM user_wallets w WHERE w.balance <> coalesce((SELECT sum(amount) FROM credit_transactions t WHERE t.wallet_id = w.id), 0) LIMIT 20` },
  { id: 'ledger-snapshot', label: 'ledger rows whose balance_after is not their own daily + purchased snapshot', hard: false,
    count: `SELECT count(*)::int AS n FROM credit_transactions WHERE balance_after <> daily_balance_after + purchased_balance_after` },
  { id: 'unlock-without-row', label: 'unlock charges with no matching unlock row (e.g. the business was deleted afterwards)', hard: false,
    count: `SELECT count(*)::int AS n FROM credit_transactions t WHERE t.type::text = 'UNLOCK_LEAD' AND NOT EXISTS (SELECT 1 FROM lead_unlocks u WHERE u.user_id = t.user_id AND u.business_id::text = t.reference_id)` },
  { id: 'unlock-without-charge', label: 'unlock rows with no matching charge (access that was never paid for)', hard: true,
    count: `SELECT count(*)::int AS n FROM lead_unlocks u WHERE u.credits_spent > 0 AND NOT EXISTS (SELECT 1 FROM credit_transactions t WHERE t.type::text = 'UNLOCK_LEAD' AND t.user_id = u.user_id AND t.reference_id = u.business_id::text)` },
  { id: 'refund-without-ledger', label: 'refunds that reversed credits but have no REFUND ledger row', hard: false,
    count: `SELECT count(*)::int AS n FROM refunds r WHERE r.credits_reversed > 0 AND NOT EXISTS (SELECT 1 FROM credit_transactions t WHERE t.type::text = 'REFUND' AND t.reference_id = r.payment_id)` },
];

async function main() {
  const details = process.argv.includes('--details');
  const url = (process.env.DATABASE_URL ?? '').replace('-pooler.', '.');
  const target = assertLocalDatabaseAllowed(url);
  console.log(`Reconciling (read only): ${describeTarget(target)}`);
  const pool = new Pool(verifiedConnection(url));
  const client = await pool.connect();
  let hardFailures = 0;
  try {
    await client.query('BEGIN READ ONLY');
    const wallets = (await client.query('SELECT count(*)::int AS n FROM user_wallets')).rows[0].n;
    console.log(`wallets: ${wallets}\n`);
    for (const check of CHECKS) {
      const n = Number((await client.query(check.count)).rows[0].n);
      const status = n === 0 ? 'ok  ' : check.hard ? 'FAIL' : 'WARN';
      if (n > 0 && check.hard) hardFailures++;
      console.log(`${status}  ${String(n).padStart(6)}  ${check.label}`);
      if (details && n > 0 && check.sample) console.table((await client.query(check.sample)).rows);
    }
    await client.query('ROLLBACK');
  } finally {
    client.release();
    await pool.end();
  }
  console.log(hardFailures ? `\n${hardFailures} hard check(s) failed.` : '\nNo hard invariant is broken. Review any WARN lines before launch.');
  process.exit(hardFailures ? 1 : 0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
