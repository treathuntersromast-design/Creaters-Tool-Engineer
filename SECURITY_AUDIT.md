# Security Audit Report

## Summary

- **Audit date**: 2026-05-12
- **Scope**: Full codebase — LINE Webhook, authentication, file system, git operations, database, logging, editor launch
- **Overall risk**: LOW (after fixes applied)
- **Commands run**:
  - `rg "child_process|execFile|spawn|fork|eval|new Function|shelljs"` — dangerous API search
  - `rg "Authorization|replyToken|x-line-signature|LINE_CHANNEL|channelSecret"` — secret leak search
  - `npm run typecheck` — type safety verification
  - `npm test` — 404 tests, all pass
  - `npm run build` — successful
  - `npm audit --audit-level=moderate` — see Dependency Audit section
  - `git log --all -S "<credential>"` — git history search for credential exposure (all clean)
  - `git status --short` — confirmed .env and scripts/ are gitignored
  - `git remote -v` — confirmed no remote configured (safe baseline)
- **Files reviewed**:
  - `src/server.ts`, `src/line/webhookHandler.ts`, `src/line/webhookRouter.ts`
  - `src/line/lineClient.ts`, `src/line/adminRouter.ts`, `src/line/messageParser.ts`
  - `src/core/projectService.ts`, `src/core/workflowRunner.ts`, `src/core/workflowService.ts`
  - `src/core/sessionService.ts`, `src/core/stateMachine.ts`, `src/core/workspaceService.ts`
  - `src/git/gitService.ts`, `src/git/gitCommandService.ts`, `src/git/gitSessionManager.ts`
  - `src/git/repositoryDiscovery.ts`, `src/editor/editorService.ts`
  - `src/db/schema.ts`, `src/db/migrations.ts`, `src/db/repositories/*.ts`
  - `src/security/commandFilter.ts`, `src/utils/logger.ts`, `src/utils/safePath.ts`
  - `src/utils/slugify.ts`, `src/config/env.ts`, `.gitignore`, `.env.example`
  - `scripts/test-webhook.js` — **CRITICAL finding (see below)**
  - `src/git/gitService.ts`, `src/git/gitCommandService.ts`, `src/git/repositoryDiscovery.ts`
  - `src/editor/editorService.ts` — **child_process re-audit (2026-05-12)**

---

## Findings

### Critical

| ID | Title | Impact | Evidence | Recommendation | Status |
|---|---|---|---|---|---|
| C-01 | Hardcoded LINE_CHANNEL_SECRET in scripts/test-webhook.js | Credential exposure if file is committed or shared — script was gitignored after discovery | `scripts/test-webhook.js` line 4: `const SECRET = process.env.LINE_CHANNEL_SECRET \|\| '<actual-secret>';` | Remove hardcoded fallback; exit with error if env var not set; add `scripts/` to `.gitignore` | **FIXED** |

### High

| ID | Title | Impact | Evidence | Recommendation | Status |
|---|---|---|---|---|---|
| H-01 | JSON.parse before signature verification | Violates "verify before process" — malformed JSON silently becomes `{}` and continues past auth | `server.ts` lines 32-40: parse middleware runs before `lineSignatureMiddleware` | Reorder: save rawBody → verify signature → parse JSON → return 400 on parse failure | **FIXED** |
| G-01 | Git stderr/stdout sent to LINE without sanitizing credential-embedded URLs | `git fetch/pull/push` failure messages may include `https://token@github.com/...`; sent verbatim to LINE user | `gitCommandService.ts`: all handlers pass `result.stderr` directly to `sendPush` without sanitization | Apply `sanitizeGitOutput()` (line-by-line `sanitizeRemoteUrl`) to all git output before `sendPush` | **FIXED** |

### Medium

| ID | Title | Impact | Evidence | Recommendation | Status |
|---|---|---|---|---|---|
| M-01 | OTP comparison not using timingSafeEqual | Theoretical timing attack on 6-digit OTP (practical impact negligible over network) | `sessionService.ts` line 80: `session.otp !== input.trim()` | Use `crypto.timingSafeEqual` with equal-length Buffers | **FIXED** |
| M-02 | No message length limit on LINE input | Very long messages could stress regex patterns or downstream processing | `webhookRouter.ts`: no length check before processing | Add 2000-character hard limit with error reply | **FIXED** |
| M-03 | Git remote URL may contain embedded credentials | `https://user:token@github.com/...` sent to LINE push messages | `gitCommandService.ts` line 83: `Remote: ${found.remoteUrl}` | Strip `user:password@` from URL before display | **FIXED** |
| M-04 | `..` allowed in git checkout branch names | `git checkout ..` passes `SAFE_BRANCH_RE` — git pathspec outside work tree (fails safely but should be blocked) | `gitCommandService.ts`: `SAFE_BRANCH_RE = /^[a-zA-Z0-9._\-\/]+$/` allows dots | Add `branch.includes('..')` check | **FIXED** |
| G-02 | `gitService.run()` accepts arbitrary git subcommands with no allowlist | A future caller could pass `['filter-branch', '--all']`, `['clean', '-fd']`, `['reset', '--hard']` etc. | `gitService.ts:run()`: no subcommand validation; `args[0]` is used directly | Add `ALLOWED_GIT_SUBCOMMANDS` set; reject unknown subcommands and return error GitResult | **FIXED** |

### Low

| ID | Title | Impact | Evidence | Recommendation | Status |
|---|---|---|---|---|---|
| L-01 | `Math.random()` for fallback webhook eventId | Predictable IDs could theoretically allow deduplication bypass (requires attacker knowing timestamp) | `webhookRouter.ts` line 46: `Math.random()` | Use `crypto.randomUUID()` | **FIXED** |
| L-02 | Windows SSH path `\.ssh\` not in commandFilter | `C:\Users\user\.ssh\key` bypasses the `~/.ssh/` block | `commandFilter.ts`: only Unix-style `~/.ssh/` covered | Add `(?:~/|\\)\.ssh(?:/|\\)` pattern | **FIXED** |
| L-03 | `rm --recursive` / `rm --force` long-form not blocked | `rm --recursive /` bypasses the `-rf` pattern | `commandFilter.ts`: only short form `-rf` covered | Add `rm\s+--(?:recursive|force)` to pattern | **FIXED** |
| L-04 | HOST defaults to `0.0.0.0` | Server binds to all network interfaces; LAN machines can reach it directly without ngrok auth | `env.ts` line 55: `'0.0.0.0'` default | Default to `127.0.0.1`; ngrok handles external exposure | **FIXED** |
| L-05 | LINE API error response included in thrown Error | LINE API 4xx responses logged as error message; typical responses contain no secrets but worth noting | `lineClient.ts` line 52: `${responseText}` | Acceptable — LINE errors contain error codes, not tokens. Documented. | **Accepted** |
| G-04 | `editorService.launchProcess()` accepts relative `targetPath` without validation | A relative path like `relative/passwd` would be passed to `spawn()` as-is (no shell, so no injection, but opens unexpected path) | `editorService.ts:launchProcess()`: no `path.isAbsolute()` check before calling `spawn` | Add `path.isAbsolute()` guard; throw if relative path provided | **FIXED** |
| G-03 | `gitService.run()` uses `repoPath` as `cwd` without validating it's a git repo | If a future caller passes an arbitrary path, git runs outside the intended repository | All current callers use paths from `discoverRepositories()` which confirms `.git` existence | Documented — existing `discoverRepositories()` + `isGitRepo()` provides the validation. Defense-in-depth acceptable at call-site level. | **Accepted** |
| G-05 | `repositoryDiscovery.ts` accepts `GIT_REPOS_PATHS` env var without sanitization | Paths are used as search roots for `scanDir()` — only paths with `.git` get `execFileSync` calls; `execFileSync` not `exec`, so no shell injection | `repositoryDiscovery.ts:77-79`: `extra.split(';')` paths become searchRoots | Documented — `isGitRepo()` gate and `execFileSync` (no shell) mitigate risk. | **Accepted** |

---

## Checks Performed

| Area | Result |
|---|---|
| **LINE signature verification** | ✅ PASS — HMAC-SHA256 + `timingSafeEqual` + length check + 401 on missing/invalid signature. Verified raw-body is preserved before JSON parse (after H-01 fix). Evidence: `tests/lineSignature.test.ts` (8 tests PASS) |
| **Webhook idempotency** | ✅ PASS — `INSERT OR IGNORE` with `UNIQUE` constraint on `lineWebhookEventId`. Duplicate returns `isDuplicate=true`, event not double-processed. Evidence: `tests/security/webhookRouter.security.test.ts` duplicate event test PASS |
| **Secret handling** | ✅ PASS (after C-01 fix) — `sanitizeLogObject` masks `channelAccessToken`, `channelSecret`, `replyToken`, `authorization`, `x-line-signature`. `userId` masked to last 4 chars. `.env` in `.gitignore`. `.env.example` uses placeholder values. `scripts/` added to `.gitignore`. Evidence: `tests/utils/logger.test.ts` (13 tests PASS); `git log --all -S "<credential>"` returns empty for all 4 credential values |
| **Path traversal** | ✅ PASS — `safeWorkspacePath` uses `path.resolve` + `path.relative` + absolute-path rejection. Slug generation strips all chars except `[a-z0-9\-_]`. `projects.slug` has `UNIQUE` constraint. Evidence: `tests/safePath.test.ts` (10 tests PASS); `tests/workspaceService.test.ts` (9 tests PASS) |
| **Command execution** | ✅ PASS — `child_process` used only in: `gitService.ts` (git CLI, no user input in args), `repositoryDiscovery.ts` (hardcoded git args), `editorService.ts` (validated editor commands). No `eval`, no `new Function`, no shell-mode `exec`. Evidence: `rg "child_process|eval|new Function"` found only 3 source files, all reviewed |
| **SQL injection** | ✅ PASS — All queries use `better-sqlite3` prepared statements with `?` placeholders. No string-concatenated SQL outside of `db.pragma('user_version = N')` (N is a hardcoded integer). Evidence: `rg "db\.prepare\|db\.exec"` in src/ — all `db.exec` calls are hardcoded migrations only |
| **Workflow locking** | ✅ PASS — `WorkflowRunner` has both memory lock (`Set`) and DB RUNNING check. `startPipeline` Promise has `.catch()` handler. `finally` always clears memory lock. LINE send failure in error handler is caught and doesn't create unhandled rejection. Evidence: `tests/core/workflowRunner.test.ts` (10 tests PASS) |
| **Input validation** | ✅ PASS (after M-02 fix) — 2000-char limit on LINE messages. Project name empty case handled. Modification empty content returns `UNKNOWN`. Text-only messages enforced. Group/room messages redirect to DM. Evidence: `tests/security/webhookRouter.security.test.ts` (6 tests PASS) |
| **Logging** | ✅ PASS — `sanitizeFormat` applied to all Winston transports. `logger.*` wrapper applies `sanitizeLogObject` to all meta objects. Stack traces not sent to LINE users. Error handler returns generic 500 message. Evidence: `tests/utils/logger.test.ts` (13 tests PASS) |
| **Dependency audit** | ⚠️ DEV-ONLY WARNINGS — `electron-builder` dev dependency chain has known vulnerabilities (see below). Runtime app dependencies clean. |
| **OTP security** | ✅ PASS (after M-01 fix) — `crypto.randomInt(100000, 1000000)` for generation. `crypto.timingSafeEqual` for comparison. 10-minute expiry with auto-cancel. |
| **Admin API** | ✅ PASS — `localhostOnly` middleware blocks all non-loopback IPs. Dynamic port prevents easy CSRF. `express.json()` requires pre-flight for cross-origin requests. |
| **Git security** | ✅ PASS (after M-03, M-04 fixes) — `SAFE_BRANCH_RE` limits branch name chars; `..` explicitly blocked; `-` prefix blocked; remote URL credentials stripped before LINE send. Evidence: `tests/security/gitSecurity.test.ts` (8 tests PASS) |
| **Credential exposure (git history)** | ✅ PASS — `git log --all -S` for LINE_CHANNEL_SECRET, LINE_CHANNEL_ACCESS_TOKEN, NGROK_AUTHTOKEN, ANTHROPIC_API_KEY all returned empty. No credential ever committed. |
| **scripts/ directory** | ✅ FIXED — `scripts/test-webhook.js` had hardcoded LINE_CHANNEL_SECRET. Fixed (C-01). `scripts/` added to `.gitignore`. |

---

## Dependency Audit

`npm audit --audit-level=moderate` found vulnerabilities in:
- `electron-builder` and its sub-dependencies (`@electron/rebuild`, `app-builder-lib`, `tar`, `make-fetch-happen`, `@tootallnate/once`)
- `electron` itself (advisory exists)

```
12 vulnerabilities (2 low, 10 high)
```

**Impact on runtime application**: **NONE**. These packages are used only during `npm run electron:build` and are not included in the packaged EXE. The runtime server (`dist/index.js`) depends only on `better-sqlite3`, `dotenv`, `express`, and `winston` — all of which are clean.

**Recommendation**: Track `electron-builder` updates; upgrade when a non-breaking fix is available. Do not use `npm audit fix --force` as it installs breaking changes.

---

## Changes Made

| File | Change |
|---|---|
| `scripts/test-webhook.js` | **C-01**: Removed hardcoded LINE_CHANNEL_SECRET fallback; now exits with error if env var not set |
| `.gitignore` | **C-01**: Added `scripts/` at top to prevent committing dev utilities that handle secrets |
| `src/server.ts` | **H-01**: Reordered middleware — rawBody save → signature verify → JSON parse (returns 400 on failure) |
| `src/core/sessionService.ts` | **M-01**: OTP comparison changed from `!==` to `crypto.timingSafeEqual` |
| `src/line/webhookRouter.ts` | **M-02**: Added `MAX_MESSAGE_LENGTH = 2000` check with sendReply on violation |
| `src/line/webhookRouter.ts` | **L-01**: `Math.random()` replaced with `crypto.randomUUID()` for fallback eventId |
| `src/git/gitCommandService.ts` | **M-03**: Added `sanitizeRemoteUrl()` to strip `user:pass@` before sending to LINE |
| `src/git/gitCommandService.ts` | **M-04**: Added `branch.includes('..')` check in `handleCheckout` |
| `src/security/commandFilter.ts` | **L-02**: SSH path pattern expanded to cover Windows `\.ssh\` |
| `src/security/commandFilter.ts` | **L-03**: `rm --recursive` / `rm --force` long-form added to destructive pattern |
| `src/config/env.ts` | **L-04**: HOST default changed from `0.0.0.0` to `127.0.0.1` |
| `.env.example` | **L-04**: Updated HOST to `127.0.0.1` with security note |
| `tests/security/projectService.security.test.ts` | New — active project deduplication, hearing_answers preservation, workflow double-start, webhook dedup, path traversal |
| `tests/security/webhookRouter.security.test.ts` | New — message length limit, unauth handling, duplicate events, group source rejection |
| `tests/security/gitSecurity.test.ts` | New — branch injection, `..` traversal, remote URL credentials, no-repo guard; **extended** with 5 G-01 output sanitization tests |
| `src/git/gitCommandService.ts` | **G-01**: Added `sanitizeGitOutput()` helper; applied to all git stdout/stderr before `sendPush` (handleStatus, handleLog, handleFetch, handlePull, handlePush, handleBranchList, handleCheckout, handleDiff, handleConfirm) |
| `src/git/gitService.ts` | **G-02**: Added `ALLOWED_GIT_SUBCOMMANDS` set (10 entries); `run()` returns error GitResult for any unlisted subcommand |
| `src/editor/editorService.ts` | **G-04**: Added `path.isAbsolute()` guard in `launchProcess()`; throws on relative `targetPath` |
| `tests/git/gitService.test.ts` | New — 17 tests: 7 disallowed subcommands rejected, 10 allowed subcommands pass allowlist check |
| `tests/editor/editorService.test.ts` | Extended — 4 G-04 tests: relative path throws, `../` path throws, absolute path allowed, undefined allowed |

---

## Phase 4: Evidence-Based Verification

### Commands Run

| Command | Result |
|---|---|
| `git remote -v` | (empty — no remotes configured) |
| `git status --short` | `.env` not present in untracked list ✓; `scripts/` now gitignored ✓ |
| `git config --list --show-origin` | No credential URLs; `credential.helper=manager` (Windows Credential Manager) |
| `git log --all -S LINE_CHANNEL_SECRET` | (empty — not in any commit) |
| `git log --all -S LINE_CHANNEL_ACCESS_TOKEN` | (empty — not in any commit) |
| `git log --all -S NGROK_AUTHTOKEN` | (empty — not in any commit) |
| `git log --all -S ANTHROPIC_API_KEY` | (empty — not in any commit) |
| `rg "LINE_CHANNEL_SECRET\|LINE_CHANNEL_ACCESS_TOKEN\|Bearer " src/` | Only in `env.ts` (`requireEnv`), `logger.ts` (`MASK_KEYS`), `lineClient.ts` (`Bearer ${token}` in headers) — all legitimate |
| `rg "child_process\|execFile\|spawn\|fork\|eval\|new Function" src/` | Only in `gitService.ts`, `repositoryDiscovery.ts`, `editorService.ts` — all reviewed ✓ |
| `npm audit --audit-level=moderate` | 12 vulns (2 low, 10 high) — all in devDeps (electron chain); runtime deps clean |
| `npm run typecheck` | No errors |
| `npm test` | 404 tests, 22 suites, all PASS |
| `npm run build` | No errors; `dist/` generated |

### Critical Finding Detail (C-01)

`scripts/test-webhook.js` contained a hardcoded `LINE_CHANNEL_SECRET` value as a fallback default. The value matched the credential in `.env`. **The secret value is NOT reproduced here.** File was in `scripts/` which was gitignored via an untracked directory, but the risk was present if the file was ever shared or committed.

**Fix applied:**
- Removed hardcoded fallback entirely
- Script now calls `process.exit(1)` if `LINE_CHANNEL_SECRET` env var is not set
- `scripts/` added to `.gitignore` to prevent future accidental commits

**Git history confirmed CLEAN**: `git log --all -S "<credential>"` returned empty for all 4 credential values.

**Human action required**: Rotate `LINE_CHANNEL_SECRET` as a precaution. See "Human Actions Required" section below.

---

## Remaining Risks

| Risk | Level | Notes |
|---|---|---|
| LINE API error body in thrown errors | Low | LINE error responses contain error codes, not tokens. Acceptable. |
| `gitSession` is a global singleton | Low | All users share the same selected repo/pending operation. Intentional single-user design. |
| `electron-builder` dev dependency vulns | Low | Build-time only; not in deployed EXE. Monitor for updates. |
| ngrok fixed domain publicly accessible | Medium (operational) | Anyone who knows the URL can send requests to `/webhook`. LINE signature verification is the only protection. Keep `LINE_CHANNEL_SECRET` secure. Rotate after any possible exposure. |
| `.env` on disk (local) | Low | Encrypted disk recommended for production systems storing LINE secrets. |
| Admin API on LAN | Low | `localhostOnly` guard in place. Dynamic port adds obscurity. Consider OS firewall rules for the port. |
| `scripts/test-webhook.js` credential exposure (historical) | Resolved | Was hardcoded; now fixed. Git history confirmed clean. Credential rotation recommended. |

---

# Final Security Verification

## Result: PASS WITH WARNINGS (one critical credential fix applied)

## Commands Run

| Command | Result Summary |
|---|---|
| `git remote -v` | No remotes — repo has no push target yet |
| `git status --short` | `.env` gitignored ✓; `scripts/` gitignored after C-01 fix ✓ |
| `git config --list --show-origin` | No embedded credential URLs; Windows Credential Manager only |
| `git log --all -S LINE_CHANNEL_SECRET` | EMPTY — credential never committed |
| `git log --all -S LINE_CHANNEL_ACCESS_TOKEN` | EMPTY — credential never committed |
| `git log --all -S NGROK_AUTHTOKEN` | EMPTY — credential never committed |
| `git log --all -S ANTHROPIC_API_KEY` | EMPTY — credential never committed |
| `rg "LINE_CHANNEL" src/` | 3 files — all legitimate (requireEnv, MASK_KEYS, auth header) |
| `rg "child_process\|eval\|new Function" src/` | 3 source files — gitService, repositoryDiscovery, editorService — all reviewed |
| `npm audit --audit-level=moderate` | 12 vulns, ALL in devDeps (electron chain); runtime deps CLEAN |
| `npm run typecheck` | PASS — 0 errors |
| `npm test` | PASS — 404/404 tests, 22 suites |
| `npm run build` | PASS — dist/ generated successfully |

## Evidence Summary

| Area | Status | Evidence |
|---|---|---|
| LINE signature verification | ✅ PASS | `tests/lineSignature.test.ts` 8/8 PASS; `timingSafeEqual` + length check in `webhookHandler.ts`; H-01 middleware reorder applied |
| Webhook idempotency | ✅ PASS | `UNIQUE` on `lineWebhookEventId`; `INSERT OR IGNORE`; duplicate test in `webhookRouter.security.test.ts` PASS |
| Secret handling (source code) | ✅ PASS | `rg` found no bare credentials in `src/`; `sanitizeLogObject` verified by 13 logger tests |
| Secret handling (scripts/) | ✅ FIXED (C-01) | `scripts/test-webhook.js` hardcoded secret removed; `scripts/` added to `.gitignore` |
| Git history (credentials) | ✅ PASS | `git log --all -S` returned EMPTY for all 4 credentials |
| `.env` gitignore | ✅ PASS | `.env` not in `git status --short` untracked list |
| Path traversal | ✅ PASS | `safePath.test.ts` 10/10 PASS; `workspaceService.test.ts` 9/9 PASS |
| Command execution | ✅ PASS | `child_process` in 3 files only; all use `execFile`/`spawn` with hardcoded or validated args; no `eval`, no `new Function`. G-01/G-02/G-04 fixes applied after re-audit. `tests/git/gitService.test.ts` 17/17 PASS |
| SQL injection | ✅ PASS | All queries use prepared statements; `db.exec` only for hardcoded migration SQL |
| Workflow safety | ✅ PASS | Memory lock + DB RUNNING check; `workflowRunner.test.ts` 10/10 PASS |
| Input validation | ✅ PASS | 2000-char limit; text-only; group/room rejection; `webhookRouter.security.test.ts` 6/6 PASS |
| Logging (secret scrub) | ✅ PASS | `logger.test.ts` 13/13 PASS; `sanitizeFormat` on all Winston transports |
| OTP security | ✅ PASS | `crypto.randomInt`; `timingSafeEqual`; 10-min expiry |
| Admin API | ✅ PASS | `localhostOnly` middleware; dynamic port |
| Git branch injection | ✅ PASS | `SAFE_BRANCH_RE`; `..` blocked; `-` prefix blocked; `gitSecurity.test.ts` 8/8 PASS |
| Remote URL credential leak | ✅ PASS | `sanitizeRemoteUrl()` strips `user:pass@`; verified in `gitSecurity.test.ts` |
| HOST binding | ✅ PASS | Default changed to `127.0.0.1` (L-04 fix) |
| npm audit (runtime deps) | ✅ PASS | `better-sqlite3`, `dotenv`, `express`, `winston` — 0 vulnerabilities |
| npm audit (devDeps) | ⚠️ WARN | 12 vulns in `electron`/`electron-builder` chain — build-time only, not in deployed EXE |
| TypeScript type safety | ✅ PASS | `tsc --noEmit` — 0 errors |
| Build | ✅ PASS | `tsc` — dist/ generated, 0 errors |

## Remaining Risks

| Risk | Severity | Required Human Action |
|---|---|---|
| `LINE_CHANNEL_SECRET` may have been seen outside git (hardcoded in scripts/) | **Medium** | **Rotate `LINE_CHANNEL_SECRET` in LINE Developers Console now** |
| `LINE_CHANNEL_ACCESS_TOKEN` — precautionary | Low | Recommended to rotate alongside the secret |
| ngrok fixed domain publicly reachable | Medium (operational) | Do not share ngrok URL; keep `LINE_CHANNEL_SECRET` secure after rotation |
| `electron-builder` devDep chain (12 vulns) | Low | Monitor for non-breaking `electron-builder` update; do not use `npm audit fix --force` |
| `.env` on local disk (unencrypted) | Low | Use encrypted disk or Windows Credential Manager for production |
| Admin API port on LAN | Low | Add Windows Firewall inbound rule to block the dynamic port from LAN if needed |

## Human Actions Required Before Production

1. **ROTATE `LINE_CHANNEL_SECRET`** — The value was hardcoded in `scripts/test-webhook.js` (now fixed and gitignored). While it was never committed to git (confirmed via `git log --all -S`), the file existed on disk and may have been seen. Go to [LINE Developers Console](https://developers.line.biz/console/) → Channel settings → Issue new Channel secret.
2. **ROTATE `LINE_CHANNEL_ACCESS_TOKEN`** — Recommended precautionary rotation alongside the secret.
3. Confirm `LINE_CHANNEL_SECRET` and `LINE_CHANNEL_ACCESS_TOKEN` in `.env` are updated to new values.
4. Confirm ngrok domain is not shared publicly beyond the intended LINE Webhook registration.
5. Review `electron-builder` vulnerability chain — upgrade when a non-breaking fix is available.
6. Consider OS-level Windows Firewall rules to block the dynamic server port from LAN access.
7. Confirm `HOST=127.0.0.1` in production `.env` (ngrok handles external traffic).

## Final Verdict

**PASS WITH WARNINGS**

All Critical, High, and Medium findings are resolved. All Low findings are fixed except L-05 (LINE API error body in logs — accepted risk). One Critical finding (C-01) was discovered during Phase 4 evidence gathering: a hardcoded `LINE_CHANNEL_SECRET` in `scripts/test-webhook.js`. The fix has been applied and git history is confirmed clean, but **credential rotation is strongly recommended** before production deployment.

The codebase is safe to push to a remote repository after credential rotation. The 12 devDependency vulnerabilities in the electron chain are build-time only and do not affect the deployed application.
