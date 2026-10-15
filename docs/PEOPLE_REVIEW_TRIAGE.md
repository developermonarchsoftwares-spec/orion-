# People review triage (Phase 6.10)

One **read-only**, reviewer-only list over quality signals that already exist. It answers *what needs review, why, which entity, how important, and where to go*. It stores nothing (no migration), has no lifecycle, and resolves nothing: every item is derived on each request from the underlying record, so it appears and disappears exactly when that record's own state changes. It does not duplicate quarantine, conflict, verification or role-review state, and it never bypasses `PeoplePublishingService` or the verification workflow.

`GET /internal/people-review/triage` (extends the existing review controller).

## Categories → existing signals
| Category | Source (active state only) |
| --- | --- |
| `QUARANTINE` | `people_ingestion_quarantine` PENDING (reason not mapped below) |
| `SUPPRESSION` | quarantine PENDING with `SUPPRESSED_PERSON` / `PERSON_SUPPRESSED` |
| `IDENTITY` | quarantine PENDING with `AMBIGUOUS_IDENTITY`, `AMBIGUOUS_COMPANY_MATCH`, `BUSINESS_NOT_FOUND`; open conflict `IDENTITY_LINKEDIN` |
| `CONTACT` | open conflicts `CONTACT_MULTIPLE_PEOPLE`, `CONTACT_CONFLICTING_VALUES` |
| `CONFLICT` | open conflicts `ROLE_TITLE`, `ROLE_CURRENCY`, `COMPANY_RELATIONSHIP` |
| `VERIFICATION` | roles (not rejected) and contacts whose verification status is `CONFLICTED` |
| `CLASSIFICATION` | PENDING, auto-classified roles whose seniority is `UNKNOWN` (the `UNCLASSIFIED_TITLE` case) |

Suppressed people's roles/contacts are not listed. Items reference the underlying object (`refType` QUARANTINE / CONFLICT / ROLE / CONTACT, `refId`); the item id is `<source>:<underlying id>`, so one underlying issue is one item.

## Priority (fixed rules, no score, no ML)
`CRITICAL` suppression hit; any open conflict or verification dispute on a person with a **published** role (customer-visible data at risk). `HIGH` identity quarantine; other open conflicts and disputes. `NORMAL` other quarantine (data to fix). `LOW` unclassified title on a pending role.

## Ordering and pagination
Priority, then oldest detection first, then id: a total, stable order. Page / limit (max 100) with `pagination.totalItems`, like the other review lists; the page is cut in SQL. Filters: `category`, `priority` (comma lists), `status` (status of the underlying record), `q` (person / company), `personId`, `businessId`, `detectedFrom`, `detectedTo`.

## Links to existing workflows
`link.workflow` + `link.path`: quarantine → `QUARANTINE_REVIEW` (`/internal/people-review/quarantine/:id`); conflicts, roles, classification → `ROLE_REVIEW` (`/roles/:id`, whose detail already lists the person's conflicts); verification → `VERIFICATION_REVIEW` (the role detail's verification panel, actions on `/internal/people-verification`). The admin UI's new **Triage** tab opens the existing drawers; all actions stay where they were, with their own permissions.

## RBAC and exposure
SUPER_ADMIN, ADMIN, DATA_MANAGER may read (like the rest of the review reads); customers 403; anonymous 401. There is no write route. Items carry only: id, category, reason code (an existing machine code), priority, underlying status, reference ids, person / company names, times, link. No raw payload, digest, rule id, source key, contact value or reviewer identity; no customer API or customer-facing code knows triage (tested).

## Non-goals
Conflict resolution, snooze / dismiss (no audit-backed need was found; it would create a status that can disagree with the underlying state), unsuppress, source ranking, automatic verification, freshness policy, customer contract changes, external acquisition, new queue infrastructure, ML prioritisation.
