# Data classification (Phase 10)

**Status: engineering control, not a legal determination.** This document defines how Orion groups the data it holds, how a class is decided for a value, and what each class may show to a customer. It does not say Orion complies with any law. The open policy decisions are listed in section 9 and need the business owner and counsel.

Code: `apps/api/src/common/privacy/data-classification.ts` (pure functions, no database). Tests: `common/privacy/__tests__/data-classification.spec.ts` (40) and `test/privacy-classification.e2e-spec.ts` (13 + 2 todo).

## 1. Principles

1. **A class is an inference, never a verification.** Every result carries `inferred: true`, a confidence (`HIGH`, `MEDIUM`, `LOW`) and a short internal reason. Customers see only the coarse label (`emailKind` / `phoneKind`: `BUSINESS`, `INDIVIDUAL_WORK`, `PERSONAL`, `UNKNOWN`); the reason and confidence stay internal.
2. **Uncertain means `UNKNOWN`, and `UNKNOWN` is restricted.** A value whose owner cannot be told from the value and its context is never labelled personal or business on appearance alone.
3. **Public is not free to reuse.** A value found in public (a website, a registry) is still classified by what it identifies. Public availability is not treated as permission to collect, resell or export without limit.
4. **No stored classification.** The class is derived at the moment of use from the value and what is known about the contact (name, company domains, direct-dial flag). Nothing is added to the database, and nothing can drift out of date. The cost: a reviewer cannot correct a class (section 8).
5. **One decision point.** Detail pages, the unlocked list, the exports and the CRM sync all call the same presenter, so a policy change applies to every path.

## 2. The classes

| Class | Meaning | Examples in Orion |
|---|---|---|
| `PUBLIC_BUSINESS_DATA` | Identifies the organisation, published by a registry or the company | Company name, legal name, CIN, LEI, UDYAM, registration number, GSTIN of a company, industry, size ranges, city and state, website |
| `BUSINESS_CONTACT_DATA` | Reaches the organisation or a function, not one person | `info@`, `sales@`, `accounts@` mailboxes; landline and toll-free numbers; street address of the premises; a company PAN, TAN |
| `INDIVIDUAL_WORK_CONTACT` | Identifies one employee in a work role | `first.last@company.com`, a named contact's title, department and professional profile link, a mobile-format number of a named contact |
| `PERSONAL_CONTACT_DATA` | Evidently the private channel or identifier of an individual | A free-mail address built from the contact's own name; the PAN of an individual; a GSTIN that embeds an individual PAN |
| `SENSITIVE_INTERNAL_DATA` | Orion's own working data about records | `metadata` columns, `source_id`, pipeline and batch ids, evidence URLs and fingerprints, moderation and review notes, duplicate scores, per-contact confidence |
| `CUSTOMER_ACCOUNT_DATA` | Orion's customers | User e-mail, name, phone, organisation, saved searches and leads, unlocks, API key prefixes |
| `PAYMENT_DATA` | Money movement | Payment orders, invoices, refunds, credit ledger, subscription state (card data is never stored) |
| `SECURITY_DATA` | Secrets and security records | Password hash, two-factor secret, token hashes, sealed integration credentials, audit and traffic logs |
| `UNKNOWN` | Not enough evidence | A free-mail address with no tie to the contact; a corporate address with no recognisable pattern; a foreign or malformed phone; an unrecognised identifier |

## 3. How a contact value is classified

### E-mail (`classifyEmail`)
Inputs: the address, the contact's name, the company's known domains.

| Rule (first match) | Class | Confidence |
|---|---|---|
| Not a well-formed address | `UNKNOWN` | LOW |
| Free-mail provider, local part built from the contact's name | `PERSONAL_CONTACT_DATA` | MEDIUM |
| Free-mail provider, anything else (including `info@gmail.com`) | `UNKNOWN` | LOW |
| Role local part (`info`, `sales`, `support`, `accounts`, `hr`, ...) on a company domain | `BUSINESS_CONTACT_DATA` | HIGH on a known company domain, else MEDIUM |
| Local part built from the contact's name on a company domain | `INDIVIDUAL_WORK_CONTACT` | HIGH on a known company domain, else MEDIUM |
| Two alphabetic parts joined by `.`, `_` or `-` (name shape) with no matching contact | `INDIVIDUAL_WORK_CONTACT` | LOW |
| Anything else on a company domain | `UNKNOWN` | LOW |

A corporate-domain address is not assumed to be non-personal; a free-mail address is not assumed to be personal. A `+tag` is ignored.

### Phone (`classifyPhone`), India-aware
| Rule | Class | Confidence |
|---|---|---|
| Toll-free `1800` / `1860` | `BUSINESS_CONTACT_DATA` | HIGH |
| Ten national digits with the trunk `0` (STD format) | `BUSINESS_CONTACT_DATA` | MEDIUM |
| Ten digits starting 6 to 9 | `INDIVIDUAL_WORK_CONTACT` | MEDIUM when flagged direct-dial, else LOW |
| Ten digits starting 1 to 5 | `BUSINESS_CONTACT_DATA` | MEDIUM |
| Foreign (+ other than +91), wrong length, empty | `UNKNOWN` | LOW |

A mobile-format number is **not** called personal: whether it is a work line is not knowable from the number, so it is the individual class with low confidence and it is masked as strongly as a personal one. Limitation: a landline written without the trunk `0` (for example `+91 80 2345 6789`) has ten national digits starting with 8 and reads as a mobile. That errs on the protective side. WhatsApp use cannot be detected.

### Identifiers (`classifyIdentifier`)
| Type | Class |
|---|---|
| CIN, LEI, REG_NO, UDYAM | `PUBLIC_BUSINESS_DATA` |
| GSTIN whose embedded PAN has a company entity code | `PUBLIC_BUSINESS_DATA` |
| GSTIN whose embedded PAN is an individual's (4th PAN character `P`) | `PERSONAL_CONTACT_DATA` |
| PAN with a company entity code (A, B, C, F, G, H, J, L, T) | `BUSINESS_CONTACT_DATA` |
| PAN of an individual, or a PAN that cannot be parsed | `PERSONAL_CONTACT_DATA` (unparseable: LOW) |
| TAN | `BUSINESS_CONTACT_DATA` |
| OTHER, malformed GSTIN | `UNKNOWN` |

## 4. Field map

"Resolved" means decided per value by the functions above. Fields not in this table were not found in any customer-facing path.

| Field | Class | Customer-facing? |
|---|---|---|
| `businesses.name`, `legal_name`, `description`, size and revenue ranges, `founding_year`, `industry`, `category`, logo, `is_verified` | `PUBLIC_BUSINESS_DATA` | Yes (all customers) |
| `businesses.metadata`, `source_id`, `master_business_id`, `status`, `published_at`, `is_enriched` | `SENSITIVE_INTERNAL_DATA` | No (`status` only decides visibility) |
| `business_locations.address_line1/2` | `BUSINESS_CONTACT_DATA` | Masked until unlock; city, state, district, pincode shown |
| `business_contacts.full_name`, `title`, `department` | `INDIVIDUAL_WORK_CONTACT` | First name and title before unlock, full after |
| `business_contacts.email` | Resolved (`classifyEmail`) | Masked until unlock |
| `business_contacts.phone`, `is_direct_dial` | Resolved (`classifyPhone`) | Masked until unlock |
| `business_contacts.linkedin_url` | `INDIVIDUAL_WORK_CONTACT` | Withheld until unlock |
| `business_contacts.is_email_verified`, `is_phone_verified` | Quality indicator | Yes |
| `business_contacts.metadata` | `SENSITIVE_INTERNAL_DATA` | No |
| `business_identifiers` (CIN, GSTIN, PAN, TAN, UDYAM, LEI) | Resolved (`classifyIdentifier`) | Masked until unlock; individual PAN never in full |
| `digital_presences` (website, profile links, tech stack) | `PUBLIC_BUSINESS_DATA` | Yes |
| `person_contacts` (work e-mail, phone, mobile) | `INDIVIDUAL_WORK_CONTACT` | After person unlock, published contacts only; personal e-mail is not modelled; shared mailboxes are dropped at ingestion |
| `people_evidence.source_url`, `source_reference`, `fingerprint`; `person_contacts.confidence_score` internals | `SENSITIVE_INTERNAL_DATA` | No (People cards show a verification level) |
| `users` (email, names, phone, organisation, role, status) | `CUSTOMER_ACCOUNT_DATA` | Own profile only |
| `users.password_hash`, `two_factor_secret`; refresh and auth tokens; API key hashes; admin OTPs | `SECURITY_DATA` | Never |
| `users.metadata`, `deleted_at`, `google_id`, `microsoft_id`, `provider_id` | `SENSITIVE_INTERNAL_DATA` | **No (removed from the profile response in Phase 10)** |
| `payment_orders`, `invoices`, `refunds`, `credit_transactions`, `user_wallets` | `PAYMENT_DATA` | Own records only |
| `audit_logs`, traffic logs, import validation logs, `export_jobs.content` | `SECURITY_DATA` / `CUSTOMER_ACCOUNT_DATA` | Own export metadata only; audit trail admin-only |
| Suppression and removal status | Business rule | People: enforced. Company contacts: **does not exist** (SG-05) |

## 5. Masking rules (before unlock)

Masking is done on the server before the response is built. No CSS or client logic is involved, and the raw value is not in the response.

| Value | Rule | Example (synthetic) |
|---|---|---|
| Personal or unclassified free-mail | First character, five stars, provider kept | `r*****@gmail.com` |
| Individual work address | First character, five stars, company domain masked | `a*****@a***e.com` |
| Role mailbox | Role name kept, company domain masked | `info@a***e.com` |
| Mobile-format or unclassified phone | Dial prefix and last two digits | `+91 ********71` |
| Business line (landline, toll-free) | First two and last two digits | `22******89` |
| Short or unusable phone | Fixed placeholder | `***-***-****` |
| Contact name | First name, then `***` | `Asha ***` |
| Profile link | Fixed placeholder | `https://linkedin.com/in/***` |
| GSTIN | State code, then stars | `27*************` |
| PAN, TAN, other numbers | Stars only | `**********` |
| CIN | Shown (public registry number), as before | |
| Street address | Fixed placeholder | `*** Locked Address ***` |

Every masked e-mail and phone (six digits or more) contains `***`, which the existing tests rely on. The old mask showed the first and last character of the local part and the first and last character of the domain label; the last character is no longer shown.

## 6. Disclosure after unlock

`DISCLOSURE_POLICY` in the code:

| Setting | Value | Meaning |
|---|---|---|
| `personalContactAfterUnlock` | `true` | A contact value classed `PERSONAL_CONTACT_DATA` is shown in full to a customer who unlocked the company (the current product rule) |
| `unknownContactAfterUnlock` | `true` | An unclassified contact value is shown in full after unlock |
| `individualPanAfterUnlock` | `false` | The PAN of an individual, and the PAN inside such a GSTIN, is never shown in full |

If a setting is `false`, the value stays masked after unlock, the contact carries `emailRestricted` / `phoneRestricted: true`, and the export and CRM sync apply the same rule automatically (unit test of the switch).

The unlock itself is untouched: same credit rule, same endpoint, same idempotency.

## 7. Where it is applied

| Path | Applies |
|---|---|
| Business detail, by slug or id, signed in or anonymous (`/discover/businesses/:id`, `/businesses/:id`) | Presenter + identifier disclosure; adds `emailKind` / `phoneKind` |
| Unlocked-leads list (`/unlock/history`) | Presenter (unlocked); adds the kinds |
| `unlocked-leads` export (CSV, XLSX) | Presenter (unlocked) for e-mail and phone; identifiers are not part of the export |
| HubSpot sync | Presenter (unlocked) for e-mail and phone |
| Search results | No contact values at all: only `hasEmail` / `hasPhone` flags (already so; verified) |
| People cards and People export | Existing controls (published contacts, unlock gate, suppression); not changed |
| Web gateway search and export | Contact values withheld until unlock (existing); detail is served by the API |

## 8. Uncertainty and what cannot be done yet

- **No stored class, no reviewer override.** A wrong inference cannot be corrected by an administrator, so a correction cannot be audited. Persisting `email_class` / `phone_class` / `class_source` columns on `business_contacts` (additive, nullable, no data change) would enable this; it needs a new migration through `npm run db:migration:new` and was not done because Phase 10 forbids schema change without authorisation. **Schema change recommended, not required for the controls above.**
- **Suppression for company contacts does not exist** (SG-05). Classification does not substitute for it: a removal request for a company contact is not honoured anywhere. No disconnected mechanism was created.
- **Name matching is heuristic** (first, last, initials, containment of a name part of four letters or more). A shared first name between a mailbox and a different person is the main false-positive risk; the result is still only `INDIVIDUAL_WORK_CONTACT` or `PERSONAL_CONTACT_DATA` at MEDIUM, and both are masked.
- **Free-mail business owners**: many small Indian businesses use a free-mail address as their company address. Those are `UNKNOWN`, masked strongly before unlock, shown in full after (policy).
- **Foreign numbers and formats** are not assessed (`UNKNOWN`).

## 9. Policy and legal decisions still open

1. Whether `PERSONAL_CONTACT_DATA` values may be shown after unlock at all (`personalContactAfterUnlock`).
2. Whether `UNKNOWN` values may be shown after unlock.
3. Whether the PAN of a proprietor may ever be shown (default no).
4. The lawful basis and notice for holding contact data of individuals who are not customers, and the removal route for them (see `PRIVACY_COMPLIANCE.md` section 4 and `PEOPLE_SUPPRESSION.md`).
5. Retention of stored classification inputs, and the company-contact suppression model (SG-05).
6. Whether the People confidence level (`High (87)`) should remain a numeric score in exports (carried over from Phase 9).
