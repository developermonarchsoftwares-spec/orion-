# User acceptance test (UAT) plan

**Status: PROPOSED — NOT APPROVED; no scenario has been executed.** Created 2026-10-07. Complements `UAT_RELEASE_RUNBOOK.md` (environment, database isolation, gates), which must be satisfied first. Run on **staging with synthetic data only**.

## 1. Entry criteria
- [ ] `npm run test:regression` green on the release commit (record commit below).
- [ ] Browser e2e (`npm run test:browser`) green against staging.
- [ ] Load test targets met (`TESTING_STRATEGY.md`), results in §4.
- [ ] `UAT_RELEASE_RUNBOOK.md` environment checklist complete; named UAT approver and testers assigned.
- [ ] Backup taken immediately before UAT data load (`BACKUP_AND_DISASTER_RECOVERY.md`).

## 2. Scenarios

Result: P = pass, F = fail (log a defect), B = blocked. Severity of a failure: S1 blocks release, S2 needs a fix or accepted workaround, S3 can follow.

| ID | Area | Scenario (as a customer unless stated) | Expected result | Result | Tester | Defect |
|---|---|---|---|---|---|---|
| A-01 | Accounts | Register with e-mail, verify e-mail, sign in | Account active, dashboard opens | | | |
| A-02 | Accounts | Sign in with Google | Account created or linked, no duplicate | | | |
| A-03 | Accounts | Forgot password, reset, sign in with new password | Old password and old sessions rejected | | | |
| A-04 | Accounts | Enable two-factor, sign out, sign in with code, use a recovery code | Works; recovery code works once | | | |
| D-01 | Discovery | Search businesses with filters; open a result | Relevant results, masked contact details | | | |
| D-02 | Discovery | Search people (decision makers) with role filters | Relevant results, contacts masked until unlocked | | | |
| L-01 | Leads | Unlock a business / person with enough credits | Details revealed, credits reduced by the stated amount, ledger entry | | | |
| L-02 | Leads | Try to unlock with too few credits | Clear message, nothing charged | | | |
| L-03 | Leads | Unlock the same lead twice | Not charged twice | | | |
| L-04 | Leads | Save leads and searches, reopen, delete | Persisted and removable | | | |
| C-01 | Credits & billing | Buy a credit package (test payment) | Credits added once, invoice available | | | |
| C-02 | Credits & billing | Refund a purchase (admin) | Credits and invoice adjusted | | | |
| C-03 | Credits & billing | Daily credit allowance rolls over | Balance as per plan rules | | | |
| E-01 | Export | Export unlocked leads to CSV | File opens in Excel; no formula injection (cells starting `=`, `+`, `-`, `@` neutralised) | | | |
| E-02 | Export | Schedule a recurring export | Runs at the time, file delivered | | | |
| I-01 | Integrations | Add a webhook; trigger an event | Signed delivery received; retries on failure | | | |
| P-01 | Privacy | Change consent choices; reload | Persisted, shown with date | | | |
| P-02 | Privacy | Download my data | JSON contains my data, no password hash or secrets | | | |
| P-03 | Privacy | Request account deletion, then cancel | Banner shows schedule; cancelled | | | |
| P-04 | Privacy | Request deletion; (staging: bring the date forward) wait for the job | Sign-in impossible, personal data gone, invoices remain | | | |
| AD-01 | Admin | Sign in as admin with e-mail code | Admin console opens; customers cannot reach it | | | |
| AD-02 | Admin | Import a CSV of businesses / people; review; publish | Errors reported per row; published records searchable | | | |
| AD-03 | Admin | Block an IP / set a user's rate limit | Takes effect, appears in audit log | | | |
| S-01 | Security | Customer calls an admin URL or another user's lead by ID | 403 / 404, no data | | | |
| S-02 | Security | Exceed the request allowance | 429 with a retry time, recovers after | | | |
| R-01 | Responsive | Use the main flows on a phone-width screen | Usable, no clipped controls | | | |
| R-02 | Resilience | (Operator) stop the search service, then restore | App degrades with a clear message, recovers | | | |

## 3. Exit criteria
- 100 % of scenarios executed; **no open S1**; every S2 fixed or accepted in writing by the approver; S3 logged with an owner.
- Performance and load results within targets or accepted in writing.
- Privacy scenarios P-01…P-04 all passed (legal requirement, not optional).

## 4. Record

| Item | Value |
|---|---|
| Release commit | NOT SET |
| UAT environment (name only) | NOT SET |
| Dates | NOT SET |
| Load test: p95 / error rate / requests per second | NOT RUN |
| Defects (S1 / S2 / S3 open) | — |

## 5. Sign-off

| Role | Name | Decision (ACCEPT / ACCEPT WITH CONDITIONS / REJECT) | Date |
|---|---|---|---|
| Business owner | NOT SET | | |
| QA lead | NOT SET | | |
| Engineering lead | NOT SET | | |
