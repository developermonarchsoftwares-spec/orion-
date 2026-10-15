# CI/CD pipeline security and software supply chain review (Phase 26)

Date: 2026-10-13. Scope: the repository's workflow, install and build paths, lockfiles, containers and release path. Nothing was committed, pushed, deployed or rotated. No provider setting was read or changed (no provider access exists in this environment). No secret value was printed.

## 1. Pipeline inventory

| Item | Evidence | State |
|---|---|---|
| Workflow | `.github/workflows/test.yml` (the only one) | **Untracked, never run on GitHub.** |
| Triggers | `push` to `main`; `pull_request` | Not `pull_request_target`: forks get a read-only token and no secrets. |
| Token | top-level `permissions: contents: read` | Least privilege; no job widens it. |
| Secrets | no `secrets.*` reference anywhere | None used; tests run on in-memory PostgreSQL (PGlite). |
| Expressions | `github.ref`, `github.event_name` only | No untrusted text (branch names, PR titles, commit messages) is interpolated into a shell. |
| Deploy step | none | The workflow only tests. Vercel deploys through its own git integration, outside the repository. |
| Web host | Vercel project `orion-api`, root `ownus`, Node 24.x (from `.vercel`) | Settings not verifiable from here. |
| API host | not identified | No pipeline exists for it. Docker images are built elsewhere. |
| Containers | `apps/api/Dockerfile`, `ownus/Dockerfile`, `docker-compose.yml` | Not buildable here (no daemon); never scanned. |
| Package sources | `package-lock.json` (workspaces `apps/*`, `packages/*`) and `ownus/package-lock.json` | Both tracked, lockfileVersion 3. |

## 2. Controls verified

- Every `resolved` entry is `https://registry.npmjs.org`; no git, file or http dependency; no missing integrity hash (root 983 packages, web 593). The three non-registry root entries are the workspace links.
- `npm audit signatures`: root 900 packages with verified registry signatures and 118 with verified provenance attestations; web 509 and 152. This proves the registry served what was signed; it is not proof that the code is benign.
- No lifecycle script (`install`, `prepare`, `postinstall`, `publish`) in the four `package.json` files and no script that fetches from the network. Only override: `shell-quote ^1.11.0`.
- Install scripts exist in dependencies (root: `@esbuild-kit/core-utils/esbuild`, `@parcel/watcher`, `@scarf/scarf`, `bcrypt`, `esbuild`, `unrs-resolver`; web: `bcrypt`, `core-js`, `unrs-resolver`). They run during `npm ci`. They are not blocked, because `bcrypt` needs its native build; this stays an accepted exposure (R-044).
- The secret scanner covers the workflow file, never prints values, scans git remotes and `NEXT_PUBLIC_` names, and passes its 11-case self-test. Working tree and git configuration: 0 findings.
- Production-dependency audit: root 0 high or critical (2 moderate), web 0 vulnerabilities.
- The remote URL carries no credential.

## 3. Confirmed defects and fixes

| # | Finding | Fix |
|---|---|---|
| C-1 | **The workflow was not valid YAML.** A step name contained `: ` (introduced by the Phase 19 edit), so GitHub would have rejected the file and no check would ever have run. Found by parsing the file, which no earlier phase did. | Name reworded. Parsed with a YAML parser: 18 steps, triggers and concurrency as intended. |
| C-2 | Actions pinned to moving tags (`@v4`). A retagged release would run with the job's token. | Pinned to commit SHAs read from the public repositories with `git ls-remote` on 2026-10-13: `actions/checkout` v4.2.2 = `11bd71901bbe5b1630ceea73d27597364c9af683`, `actions/setup-node` v4.4.0 = `49933ea5288caeca8642d1e84afbd3f7d6820020` (both lightweight tags, so the tag SHA is the commit). The version stays in a comment. The SHAs were not compared with a release page; Dependabot (below) keeps them current. |
| C-3 | The checkout kept the token in `.git/config`, readable by every dependency install script. | `persist-credentials: false`. No step needs to push. |
| C-4 | `cancel-in-progress: true` applied to pushes on `main`, so a newer push hid the result of the older one. | Cancel only for pull requests. |
| C-5 | `@scarf/scarf` install script reports usage from the build machine. | `SCARF_ANALYTICS: 'false'` for the job. |
| C-6 | Registry signature check was not part of CI. | Added `npm audit signatures` for both lockfiles. |
| C-7 | Audits only covered production dependencies. | Added an audit of all dependencies that fails on **critical** only. High findings in development tools are listed in section 5, not gated (changing versions to quiet them is out of scope and one suggested fix is a major downgrade). Current result: no critical in either tree. |
| C-8 | Migration journal check existed but was not in CI. | Added `db:migration:check` (journal consistent, 26 entries). |
| C-9 | The API image cannot report which revision it runs (`MonitoringService.appInfo` reads `GIT_SHA`). | `ARG GIT_SHA` / `ENV GIT_SHA` in `apps/api/Dockerfile` with the build command in a comment. Default `unknown`. Image not built (no daemon). |
| C-10 | No owners for the files that decide what runs and ships; no automated dependency proposals. | Added `.github/CODEOWNERS` and `.github/dependabot.yml` (weekly, limited, no auto-merge). **Inert until GitHub settings are switched on** (section 9). The only GitHub identity the repository shows is the account in its remote; one owner means no second reviewer exists. |

All existing steps are unchanged and in the same order; nothing was loosened. The edited file was parsed, the secret scan and self-test re-run, and the added commands run locally (journal check passed; critical-level audits exit 0). The workflow itself has still **not** run on GitHub.

## 4. Gate matrix: what stops what

| Gate | In CI | Blocks a merge | Blocks a Vercel deploy |
|---|---|---|---|
| Install from lockfile (`npm ci`) | yes | only if the check is required | **no** |
| Secret scan (tree) | yes | same | no |
| Secret history scan | no (tool exists; 3 historical values, rotation pending) | n/a | no |
| Signatures, audits | yes | same | no |
| Type-check, builds, unit, integration, security, perf, e2e | yes | same | no (Vercel builds on its own) |
| Playwright, lint, container scan | **no** | n/a | no |

"Required check" and "branch protection" are GitHub settings. **There is no evidence they are on.** Until they are, a failing run does not stop a push to `main`, and Vercel's integration deploys what is on `main` whatever the run says.

## 5. Dependency and supply chain findings

- Web development toolchain: `eslint-config-next` 16.3.4 → `@next/eslint-plugin-next` → `fast-glob` → `micromatch` 4.0.8 → `braces` 3.0.3 (GHSA-vfj7-8cjw-p6xm, stack exhaustion on crafted patterns): **5 high**, build-time only, not in the production tree. npm's suggested fix is a downgrade to `eslint-config-next@14.2.35`; **not applied**. Needs a decision when a compatible release exists.
- Root: 25 moderate in total; 2 in production (`@nestjs/swagger`, `js-yaml`), 0 high. Not changed.
- **SBOM:** `npm sbom --sbom-format cyclonedx --omit=dev` works for the root (CycloneDX 1.5, 126 production components). For the web app it fails (`ESBOMPROBLEMS`: the lockfile lacks `@emnapi/runtime@^1.11.3`, an optional platform package of `sharp`). `npm ci` succeeds. No SBOM is generated or published by CI; no file was created for it. Regenerating the web lockfile would change dependency resolution and was not done.
- No signing, attestation or provenance is produced for the project's own artifacts. Vercel rebuilds from source, so **the artifact tested in CI is not the artifact deployed**. Builds are not claimed to be reproducible.
- Docker: `node:20-alpine` (floating tag, Node 20 versus 22 in CI and 24 on Vercel), `npm install` and no lockfile copied, so an image can contain versions nobody tested. **Not changed in this phase** (cannot be built or verified here); R-043.
- Node versions differ across CI (22), Docker (20) and Vercel (24); there is no `.nvmrc` or `engines` field.

## 6. Tests and validation

- YAML parse of workflow and Dependabot file: passed; 18 steps listed.
- `node ops/security/scan-secrets.mjs --self-test`: 11 cases passed; scan: 0 findings.
- `npm run db:migration:check`: journal consistent, 26 entries.
- `npm audit --audit-level=critical`: exit 0 (root and web). `npm audit signatures`: see section 2.
- `git diff` of the Dockerfile: 4 lines added. No other step or test was altered, so the Phase 25 regression results stand (e2e 625 passed, 0 failed; unit 840; integration 962; web 264).
- Not run: GitHub Actions itself, actionlint (not installed), Docker builds, Playwright, lint, container scan.

## 7. Release path as it stands

1. Work is uncommitted; nothing reaches GitHub or Vercel until the commit plan is approved.
2. Push to `main` → Vercel builds and deploys the web app (assumed from the `.vercel` project; unverified). GitHub Actions runs in parallel and cannot stop it unless Vercel is told to wait for checks.
3. API: no pipeline, host unknown.
4. Rollback and runbook: `PRODUCTION_DEPLOYMENT_RUNBOOK.md`.

## 8. Recommendations (not done, need a decision)

1. Make `main` protected and the `fast` job a required check; require a pull request and one review that is not the author (needs a second person, see CODEOWNERS note).
2. In Vercel, deploy production only from `main`; use the "wait for checks" / deployment-protection options; keep Production-only variables out of Preview.
3. Run history secret scanning in CI only after rotation (it would fail today by design).
4. Build Docker images from the lockfile (`npm ci`), pin the base image by digest, align on one Node version, add an image scan.
5. Generate the root SBOM in CI; fix the web lockfile before doing the same there.
6. Add `--ignore-scripts` for installs of tools that do not need native builds only if tested; not recommended globally.

## 9. Provider checks that must be done by a person (nothing below is verified)

GitHub: branch protection or ruleset on `main` (required status check `fast`, required pull request and review, no force push or deletion, include administrators); "Require review from Code Owners"; Actions → General (workflow permissions read-only by default, approval required for fork pull requests, allowed actions policy); environments and secrets (none expected); secret scanning and push protection; Dependabot alerts and security updates; two-factor requirement and member list; deploy keys and installed apps/tokens (including the Vercel app's repository scope).
Vercel: production branch, which branches create previews, variables scoped per environment (Preview must not hold production values), deployment protection on previews, ignored build step or required checks, team members and tokens, the Node version, domain and log-drain settings.
API host and registry (when chosen): who can push images, image scanning, secret store, deploy access and audit log.

## 10. Remaining risks

R-042 CI is not a release gate and provider settings are unverified; R-043 container builds unpinned and unscanned; R-044 dependency install scripts run in CI and in builds; R-045 web development-toolchain highs; R-046 no SBOM or provenance, web SBOM fails; R-047 single maintainer identity, owners and Dependabot inert until enabled; R-048 workflow never executed. Release classification remains **BLOCKED**.
