# Document control block (TEMPLATE, blank)

**Status: TEMPLATE. Not a record, not an approval.** Copy the block in §1 to the top of any governed document (runbook, plan, report, approval record) and fill it in. Register each governed document in `DOCUMENT_CONTROL_REGISTER.md`.

Rules:
- Write `NOT SET` for anything unknown. Never guess, never fill from memory.
- Approval Status changes only when the named reviewer records it in the Sign-off row. Filling this block approves nothing.
- Never put into this block: connection strings, passwords, tokens, customer data, object keys or file names.
- Evidence and commit references must point to something that exists and can be re-checked. Do not link to files containing secrets.

## 1. Block to copy
```markdown
## Document control
| Field | Value |
|---|---|
| Project name | `[ ]` |
| Project lead | `[ ]` |
| Reviewer (must differ from the author of the change) | `[ ]` |
| Release version | `[ ]` |
| Target environment | `[ ]` (local / UAT / staging / production) |
| Approval status | `DRAFT — NOT APPROVED` |
| Sign-off date | `NOT SET` |
| Commit reference / artifact reference | `[ ]` (full commit SHA, tag, or build artifact ID + SHA-256) |

### Evidence
| ID | Description | Evidence link | Commit / artifact ref | Recorded by | Date |
|---|---|---|---|---|---|
| E-1 | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` |

### Audit notes
| Date | Author | Note (what was checked or changed, and why) |
|---|---|---|
| `[ ]` | `[ ]` | `[ ]` |
```

## 2. Field definitions
| Field | Meaning | Allowed values / format |
|---|---|---|
| Project name | Project or workstream the document belongs to | Free text, e.g. `Orion + Data Pipeline` |
| Project lead | Person accountable for the work | Name and contact channel (no secrets) |
| Reviewer | Person who checks the document before sign-off | Name; not the author of the change being reviewed |
| Release version | Version the document applies to | `MAJOR.MINOR.PATCH`, tag, or `NOT SET` |
| Target environment | Where the described change or release lands | `local`, `UAT`, `staging`, `production`, or `NOT SET` |
| Approval status | State of the document's approval | `DRAFT — NOT APPROVED`, `IN REVIEW`, `APPROVED`, `REJECTED`, `SUPERSEDED` |
| Sign-off date | Date the reviewer recorded approval | `YYYY-MM-DD` or `NOT SET`. Must be `NOT SET` unless status is `APPROVED` or `REJECTED` |
| Evidence link | Where the supporting evidence can be re-checked | Repo path, ticket, or artifact URL |
| Commit / artifact reference | Exact code or build the evidence relates to | Full SHA, tag, or artifact ID with SHA-256 |
| Audit notes | Append-only log of reviews and changes | One row per entry; never edit or delete earlier rows |

## 3. Status rules
1. `APPROVED` requires: Reviewer set, Sign-off date set, at least one Evidence row with a link, and a Commit / artifact reference.
2. Any material edit after sign-off returns the status to `IN REVIEW` and clears the Sign-off date. Record the reason in Audit notes.
3. A document that is replaced is marked `SUPERSEDED` with a pointer to its successor in Audit notes; it is not deleted.
4. Approval of one document is never approval of another document or of a different release.
