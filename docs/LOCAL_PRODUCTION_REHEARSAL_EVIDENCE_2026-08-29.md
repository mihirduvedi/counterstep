# Local production rehearsal evidence — August 29, 2026

## Result

`npm run rehearse:local` passed at `2026-08-30T06:53:07.732Z` (`2026-08-29 11:53 PM` America/Los_Angeles).

The run used:

- the exact `counterstep:local-production-rehearsal` production image;
- image ID `sha256:68bce73ea8ebf237e9d33926d00dcdb12f04d70bca33337437bd2a64a6f8e080`;
- the production `FirestoreCounterstepRepository` connected only to the pinned official Firestore emulator;
- isolated emulator project `demo-counterstep` at host-side `127.0.0.1:8087`;
- live `gemini-3.5-flash-lite` execution through Google ADK for TypeScript;
- two separate application containers around one preserved emulator process.

## Restart persistence proof

Container generation 1 completed a strict live recovery, then was destroyed. Container generation 2 started from the same immutable image with no application-local persistence. From the still-running Firestore emulator it re-read:

- run `run-74760f4a-b81e-4e12-9f44-8fdb0668e740`;
- the complete final run view; and
- its downloaded closure receipt.

The fresh process's run view and closure were deeply equal to the values returned before restart. The closure was revalidated for Gemini provenance, eligible model, bounded tool and write counts, contiguous event accounting, exact version/digest evidence, cited satisfied goals, action-receipt authority, closure qualifier, and canonical receipt digest.

## Live journey evidence

| Phase | Run ID | Tool calls | Writes | Events | Closure digest |
|---|---|---:|---:|---:|---|
| Before restart | `run-74760f4a-b81e-4e12-9f44-8fdb0668e740` | 6 | 2 | 12 | `15df671c65997897b7aa94ff5fdb66929c50e0a85ecc866c8a3c882171669480` |
| After restart | `run-df03f10a-4a5d-4ebb-b4b1-2b1fbd8103de` | 6 | 2 | 12 | `78cf3531ef660cb3c264cbd788f1387836465fdbd24ad31d055a4173e2f857e0` |

Both runs ended `repaired` with action-receipt verdict `within_remediation_authority`.

## Container and credential controls

Both container generations were inspected through narrow Docker fields and required:

- user `node`;
- read-only root filesystem;
- all Linux capabilities dropped;
- `no-new-privileges:true`;
- `/tmp:rw,noexec,nosuid,size=64m`;
- host publication only at `127.0.0.1:8080`.

`.env.local` was mode `600` and excluded from the Docker build context by the exact `.env*` ignore rule. The Gemini key was supplied through a temporary mode-`600` env file, never a Docker command argument. The temporary directory and both containers were removed on exit. Firebase shut down the emulator. A post-run exact-value scan found no Gemini-key copy outside `.env.local`.

A later local `next build` independently revealed that Turbopack can copy a server-only value into its ignored generated cache. Counterstep's build workflow now scans that cache for the exact configured Gemini key and, if found, removes the complete Turbopack cache after the standalone build succeeds. Removing the complete cache avoids leaving both the duplicate secret and invalid partial-cache metadata. Focused tests cover exact-match removal and clean-cache preservation.

## Retained machine-readable artifact

The ignored local manifest is:

`output/local-production-rehearsal/rehearsal-2026-08-30T06-53-07-732Z.json`

- mode: `600`
- bytes: `112313`
- file SHA-256: `e179eb6c51c734c306a3c4c57ae772180bbe24133b9a1ead16f85831f1849b16`
- schema: `counterstep.local-production-rehearsal.v1`

The manifest retains both final views and closures and validates fixed evidence claims before it can be written.

After the generated-cache secret scrub was added, the final source tree was rebuilt as production image `sha256:db68a3679dab5f46bb746ff0b08d37ecc0c5f31fe05cc695e9bb3705a261601f` without another Gemini call. That later build passed and contains no `.env.local` build context. The two-journey restart evidence above remains tied to the earlier explicitly recorded image ID; it is not silently reassigned to the later build.

## Evidence boundary

This is local production-rehearsal evidence. It establishes live Gemini/ADK orchestration, the production container, the production Firestore adapter against the official emulator, and persistence across application restart.

It does **not** establish managed Firestore, Cloud Run, a public deployment, Google Cloud billing readiness, or hackathon eligibility. The manifest schema requires all three managed/deployed claims to remain `false`. No `gcloud` command, Google Cloud resource creation, API enablement, billing change, or managed Firestore write occurred.

## August 30 bounded-continuation repair

Two user-run rehearsals later failed closed after Gemini ended naturally before calling `verify_closure`:

- run `run-6f208a80-5d07-4a6e-a1f6-e54fa7af4fd6` stopped after one authorized emulator write;
- run `run-0af0e541-a29e-4bfb-b005-074f4c620373` stopped after both authorized emulator writes.

Both failures used reason `agent_stopped_without_closure`, emitted no passing manifest, shut down the official emulator, and removed the temporary container state. These were model-control failures, not Docker, billing, credential, or Firestore failures.

Counterstep now permits exactly one additional ADK invocation only when persisted deterministic state proves that the run is nonterminal, status `executing`, and bound to an approved active plan; no unhandled failed plan step exists; and the original tool-call budget can cover every remaining approved step plus closure. The continuation message contains a minimized deterministic envelope with completed step IDs, exact remaining approved tool arguments, counters, and the exact `verify_closure` plan ID. All domain tools remain server-bound and reapply authority, version, idempotency, transition, write, replan, and closure checks. A second early stop becomes terminal `agent_stopped_after_bounded_continuation`; there is no third invocation.

Focused injected-ADK tests reproduce continuation after one write, prove a stop after two writes can receive only one continuation, and reject continuation without an approved active plan. The complete gate passes with 421 tests.

A fresh live production rehearsal then passed at `2026-08-30T20:51:11.736Z`:

| Phase | Run ID | Tool calls | Writes | Events | Closure digest |
|---|---|---:|---:|---:|---|
| Before restart | `run-700deabd-06ad-4568-9177-6ef170fee814` | 6 | 2 | 12 | `543d97e9b5d60628fc3d4dd4325f7f350919a86fcbca28fd89f69b0b9746274c` |
| After restart | `run-02e2a2af-4e74-4070-b5b1-68b0f0fedf1d` | 6 | 2 | 12 | `40728bef272fa24e699de4997253b208a8b6f5fa16b522db35bf866904cbdb34` |

The fresh second container reproduced the first run view and closure exactly. The new mode-`600` manifest is `output/local-production-rehearsal/rehearsal-2026-08-30T20-51-11-736Z.json`, 112798 bytes, SHA-256 `fb55a00309dd5923295391b5e48cb8d8034213bcb2f25517360c266b5369209e`. The rehearsed production image ID is `sha256:d998e2aa3076bf0302aa52c2bebc1718fbd4aad77cc8e492f3725bd3a1216b55`.

## August 30 pre-release rerun

Two fresh strict rehearsals built the current production image successfully and
started the production Firestore adapter against the official emulator. In both
attempts, Gemini ended before producing an inspection, approved plan, write, or
closure:

| Run ID | Status | Terminal reason | Tool calls | Writes |
|---|---|---|---:|---:|
| `run-f14e3fba-764e-42dc-97c0-a77c6c81d7b7` | `failed` | `agent_stopped_without_closure` | 0 | 0 |
| `run-221148ee-5548-45b5-8c7e-8cd06cbbdd33` | `failed` | `agent_stopped_without_closure` | 0 | 0 |

Both attempts failed closed, removed their containers and temporary credential
material, and shut down the emulator. They establish current production-image
build/start behavior and zero-write failure safety, but they are not fresh
passing end-to-end rehearsal evidence. No passing manifest was emitted.

After stopping live retries, `npm run test:firestore` passed all seven
credential-free production-repository integration tests against the pinned
official Firestore emulator. That deterministic suite covers reset/repeat,
concurrent idempotency, atomic daily admission, stale recovery, repeated-stale
blocking, and irreversible delivered-message state. It is emulator evidence,
not managed Firestore or Cloud Run evidence.
