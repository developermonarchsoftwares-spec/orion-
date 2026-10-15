# Privacy engineering overview

**Status: engineering notes, not legal advice and not a compliance statement.** The legal and policy side (Privacy Policy text, lawful bases, data-subject procedures, sub-processors) is in `PRIVACY_COMPLIANCE.md`. The classification model is in `DATA_CLASSIFICATION.md`. Earlier findings are in `PRIVACY_AUDIT_REPORT.md` and `SECURITY_GAP_REPORT.md`.

## 1. Whose data Orion holds

| Group | Data | Where |
|---|---|---|
| Customers | Account, usage, saved work, billing records | `users`, `saved_*`, `credit_*`, `payment_*`, `export_jobs` |
| Business contacts (third parties) | Name, title, work e-mail, phone, professional profile link, sometimes a mobile number or a free-mail address | `business_contacts` (company imports), `people` / `person_contacts` (People module) |
| Business owners (third parties) | Tax and registry numbers; for a proprietorship the PAN is the individual's own identifier | `business_identifiers` |

The third-party individuals are data subjects who never signed up. They are the group Phase 10 is about.

## 2. What Phase 10 added

1. **A classification layer** (eight classes plus `UNKNOWN`), derived at use, never stored, always marked as an inference. Definitions, criteria and the field map: `DATA_CLASSIFICATION.md`.
2. **Type-aware masking on the server** before a locked contact leaves the API: a personal or unclassified address keeps one character and the provider; an individual work address keeps one character and masks the company domain; a mobile-format number keeps its last two digits; a business line keeps two digits at each end. The previous mask also showed the last character of the local part; that is gone.
3. **One disclosure policy** used by the company detail, the unlocked list, the exports and the CRM sync (`DISCLOSURE_POLICY`), so a future decision to withhold a class applies to every path at once.
4. **Individual tax identifiers protected**: the PAN of an individual, and the PAN embedded in a GSTIN, are never shown in full, before or after unlock. Before unlock, identifiers show nothing identifying (the GSTIN keeps its state code; the CIN, a public registry number, stays visible).
5. **Customers can see how Orion read a contact**: each contact now carries `emailKind` and `phoneKind` (`BUSINESS`, `INDIVIDUAL_WORK`, `PERSONAL`, `UNKNOWN`). The reason and confidence are not returned.
6. **Profile response trimmed**: `GET /user/profile` and `/user/me` no longer return the free-form `metadata` JSON, the erasure marker `deletedAt`, or the identity-provider subject ids (`googleId`, `microsoftId`, `providerId`). `jobTitle`, `googleLinked` and `microsoftLinked` are still returned.

## 3. What was already in place and was verified, not rebuilt

| Control | Where | Evidence |
|---|---|---|
| Locked contacts masked before unlock; address masked; owner-only values after unlock | `discover.service.ts` | `lead-discovery-unlock`, `admin-import-pipeline`, `security-hardening` e2e |
| Search results carry availability flags only | `discover.service.ts`, Typesense and Postgres providers | verified again in `privacy-classification.e2e-spec.ts` |
| People: only published contact points, only after person unlock, personal e-mail not modelled, shared mailboxes dropped, hashed suppression of LinkedIn / work e-mail / phone enforced in ingestion, unlock and publishing | `people/*` | `people-suppression`, `people-review`, `person-record.normalizer` specs |
| Consent ledger, access export, erasure with a 7-day cooling-off, retention job, request tracking | `modules/privacy` | `privacy.integration.spec.ts` |
| Export owner scoping, published-only, caps, audit | `modules/export` | Phase 9 tests |
| Errors never carry SQL, paths or stacks in production | `all-exceptions.filter.ts` | Phase 7 and 9 tests |

## 4. Where Orion does not protect data yet

| Gap | Effect | Reference |
|---|---|---|
| **No suppression or removal mechanism for company contacts** | A company contact who asks to be removed can be re-imported, re-published, shown, exported and pushed to a CRM. People contacts are covered; company contacts are not. | SG-05, P9-12. Not worked around: a mechanism the search, unlock, export and CRM paths do not all enforce would be worse than none. |
| No stored classification, no reviewer correction, no audit of a correction | A wrong inference cannot be fixed or traced | `DATA_CLASSIFICATION.md` section 8; needs an additive migration |
| After unlock, personal and unclassified contact values are shown in full, and a customer can export them | The classification protects the preview, not the paid result | Policy decision 1 and 2 (`DATA_CLASSIFICATION.md` section 9) |
| Company imports have no source approval or provenance | Cannot tell where a contact came from or on what basis | SG-04, SG-05 |
| Administrator views were not re-audited field by field | Admin access is role-gated server-side (Phase 5), but the web gateway's admin business list and the import review were not checked for which contact fields they return, and there is no field-level admin view and no access log for reads | Remaining risk; no admin business endpoint exists in the NestJS API |
| Stored exports contain contact data for 7 days | Reduces to the retention table; erased with the account | `PRIVACY_COMPLIANCE.md` section 3 |
| Backups contain everything | Aged out by the backup policy; deletions must be re-applied after a restore | `BACKUP_AND_DISASTER_RECOVERY.md` |
| Data in a customer's own CRM or downloaded files | Outside Orion once delivered | Cannot be recalled |

## 5. Rules for new code

1. Never return a database row from a customer-facing endpoint. Build the response field by field (the presenter in `data-classification.ts` is the model).
2. Never add a contact value to a response without going through `presentCompanyContact` (or the People card builder).
3. A new column holding information about a person must be added to the field map in `DATA_CLASSIFICATION.md` and to the classification test.
4. Never log a contact value, an identifier or a token. Audit entries hold counts and ids.
5. A new export or integration that sends contact data must apply the same disclosure policy.

## 6. Open decisions

See `DATA_CLASSIFICATION.md` section 9 and `PRIVACY_COMPLIANCE.md` section 4. In short: show personal or unclassified contacts after unlock or not; PAN of proprietors; the company-contact suppression design; lawful basis and notice for third-party contacts; whether to persist classifications.
