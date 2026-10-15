/**
 * Razorpay configuration check: `npm run payments:check`.
 *
 *  - reads apps/api/.env exactly like the API does and reports which settings are present and what mode the key belongs to;
 *  - makes ONE read-only call to Razorpay (lists one order) to see whether the key pair is accepted. It creates nothing and moves no money;
 *  - never prints a key id, a secret or any other credential: only yes/no facts and the HTTP status.
 *
 * Exit codes: 0 accepted, 2 configuration problem (something missing or malformed, or production would refuse payments), 3 Razorpay rejected the keys.
 */
import * as dotenv from 'dotenv';
import { ConfigService } from '@nestjs/config';
import { RazorpayService } from '../src/modules/payment/razorpay.service';

dotenv.config();

async function main() {
  const rz = new RazorpayService(new ConfigService());
  const d = rz.diagnose();
  const yn = (b: boolean) => (b ? 'yes' : 'NO');
  console.log('Razorpay configuration (no secrets are printed)');
  console.log(`  environment            ${process.env.NODE_ENV || '(NODE_ENV not set)'}`);
  console.log(`  order mode             ${d.mode}  (${d.mode === 'live-api' ? 'orders are created at Razorpay' : 'local mock orders: no real checkout can open'})`);
  console.log(`  key id present         ${yn(d.keyIdPresent)}   mode of the key: ${d.keyIdMode}`);
  console.log(`  key secret present     ${yn(d.secretPresent)}   looks well-formed: ${yn(d.secretLooksValid)}`);
  console.log(`  webhook secret present ${yn(d.webhookSecretPresent)}  (only needed for webhooks; payments verify without it)`);
  if (d.refusing.length) {
    console.log('\nPayments would be REFUSED:');
    for (const r of d.refusing) console.log(`  - ${r}`);
    process.exit(2);
  }
  if (d.mode !== 'live-api') {
    console.log('\nRAZORPAY_API_MODE is not "live": nothing was sent to Razorpay. Set RAZORPAY_API_MODE=live to create real (test-mode) orders.');
    process.exit(2);
  }
  const r = await rz.checkCredentials();
  if (r.accepted) {
    console.log(`\nRazorpay ACCEPTED the key pair (HTTP ${r.httpStatus}). Order creation can work${d.keyIdMode === 'test' ? ' in TEST mode (no real money)' : ' in LIVE mode (real money)'}.`);
    return;
  }
  if (r.httpStatus === 401 || r.httpStatus === 403) {
    console.log(`\nRazorpay REJECTED the key pair (HTTP ${r.httpStatus}, "Authentication failed").`);
    console.log('The settings above are well-formed, so the pair itself is not valid at Razorpay: it was regenerated, deleted, or the id and secret come from different');
    console.log('generations or modes. Fix: Razorpay Dashboard -> switch to the intended mode (Test/Live) -> Account & Settings -> API Keys -> Generate key,');
    console.log('then put BOTH new values in apps/api/.env and restart the API. A secret is shown only once at generation.');
    process.exit(3);
  }
  console.log(`\nRazorpay answered HTTP ${r.httpStatus}: not an authentication problem. Check network access to api.razorpay.com and try again.`);
  process.exit(2);
}

main().catch((e) => {
  console.error('check failed:', (e as Error).message);
  process.exit(2);
});
