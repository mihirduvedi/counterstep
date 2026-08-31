# Google Cloud deployment evidence — August 31, 2026

This record separates automated, managed, deployed, visual, and still-manual evidence. It contains synthetic run identifiers only and no credentials, billing-account identifier, or secret material.

## Public deployment

- URL: https://counterstep-27573808078.us-central1.run.app
- Google Cloud project: `handy-operation-492002-h3` (`Counterstep Hackathon`)
- Cloud Run region: `us-central1`
- current public revision: `counterstep-00006-6nd`, 100% traffic, deterministic fixture / memory
- exact-source live-evidence revision: `counterstep-00005-nft` (historical Vertex/Firestore health proof)
- exact-source image build: `e734fe09-5e29-41cc-a6fd-310ab8f186c3`
- Artifact Registry digest: `sha256:766f1d07da7cb4f853638c93659a995926a7a8eadc6eec56ceb67d19efaa42c4`
- deployed source commit: `5890e2b09049564130428f3d6cc4a768b221b180`
- hosted CI: `33368011137`, passed on the deployed source commit
- build identity: dedicated service account `counterstep-build` in the deployment project
- runtime identity: separate service account `counterstep-runtime` in the deployment project

The Cloud Build source archive retained for this image is `gs://handy-operation-492002-h3_cloudbuild/source/1788161074.449236-93b3b9f37020456aa66972f610de8e97.tgz`, generation `1788161075526383`, size `1714483`, MD5 `WuEF+CoxGTe3bh4Idquejw==`, and CRC32C `NWrK0g==`. Build `e734fe09-5e29-41cc-a6fd-310ab8f186c3` completed `SUCCESS` at `2026-08-31T07:28:13.571079Z`.

The deployed image came from a clean archive of the exact reviewed and pushed source commit `5890e2b09049564130428f3d6cc4a768b221b180`. GitHub Actions run `33368011137` passed on that SHA before Cloud Build started. The later video/docs commit does not change the deployed application source.

## Current public health contract

`GET /api/health` returned HTTP 200 on the public URL with:

```json
{
  "ok": true,
  "appVersion": "0.1.0",
  "deployment": "cloud-run",
  "repository": "memory",
  "repositoryReachable": true,
  "geminiConfigured": false,
  "modelBackend": "unconfigured",
  "agentMode": "fixture",
  "modelId": "gemini-3.5-flash-lite",
  "agentFramework": "google-adk-typescript"
}
```

Current public revision `counterstep-00006-6nd` reuses the exact image digest above but exposes only `COUNTERSTEP_AGENT_MODE=fixture`, `COUNTERSTEP_REPOSITORY=memory`, and a 10-run daily limit. It has no Gemini, Vertex AI, or Firestore environment configuration and no `GEMINI_API_KEY` secret reference. The runtime identity's `roles/aiplatform.user` and `roles/datastore.user` bindings were removed after the fixture revision became healthy; only `roles/serviceusage.serviceUsageConsumer` remains. Anonymous traffic therefore cannot invoke Gemini or read/write managed Firestore through this service.

A signed-out E1 run on the public fixture reached `repaired` with generation source `deterministic_fixture`, no model ID, two synthetic writes, 12 events, six tool calls, one approved plan, and an exact scenario match. This establishes the hosted deterministic journey, not a new live-model or managed-database run. The historical `counterstep-00005-nft` health response and the three retained journeys below establish the earlier Vertex/Firestore deployment separately.

## Managed Firestore evidence

Cloud Build `0a89c790-f5f7-4e16-95c4-b0362b60b7df` ran the production Firestore repository against the real `(default)` database with retained label `managed-20260831-0524`. It completed `SUCCESS` using the isolated build identity. Vitest reported one file and six tests passed in 35.13 seconds.

| Case | Result | Writes | Closure digest |
|---|---|---:|---|
| canonical | `repaired` | 2 | `294f514730303a8d5995607f258b6023c592ef17aeecf5041755109b0911953c` |
| idempotency | one write, one replay | 1 | n/a |
| admission | two claimed, one limited | n/a | n/a |
| stale once | `repaired` | 2 | `187b3a79b37a8fcc75c630f55ea37f1da51242fb5b8b2093119cbbf0c99156d9` |
| stale twice | `blocked` | 0 | n/a |
| delivered | `partially_repaired` | 1 | `91e393a1e62cee63570240090432daad4bf5239b7117dfd298ae0ed7ebe50ac6` |

This is managed Firestore evidence. It does not by itself prove Gemini, ADK, Cloud Run, or UI behavior; those are established separately below.

## Deployed Gemini / ADK smoke evidence

The strict public smoke command passed twice against the historical keyless Vertex revision `counterstep-00003-q7m`:

| Run | Run ID | Tool calls | Writes | Events | Verdict | Closure digest |
|---:|---|---:|---:|---:|---|---|
| 1 | `run-7dbfc81e-5bfa-444f-a3d8-3eea18c5d8d8` | 6 | 2 | 12 | `within_remediation_authority` | `c22956e58d68fd8ce5388e9ce59e93c80455a0ebb244b9d375dd9f851574f37d` |
| 2 | `run-c88d2b46-2740-4d91-9559-3b1b106ce4f0` | 6 | 2 | 12 | `within_remediation_authority` | `6186ed132dbdd025364d82ecdc176505c27b5cce229cf3d2ef15dc8108b54878` |

A third continuous browser journey passed on the public UI:

- run: `run-d7947076-31e7-4697-815c-36a73f0d36f6`
- model/framework: `gemini-3.5-flash-lite` / `google-adk-typescript`
- result: `repaired`, contract `matched`
- tool calls/writes/events: 6 / 2 / 12
- action-receipt verdict: `within_remediation_authority`
- event coverage: 12 recorded / 12 accounted
- closure digest: `a02316915f3df45e6d5826883ddf6878a343d8c1022f711671dea9ffcfcf601e`

The later exact-source live-evidence revision passed the public health contract with reachable Firestore, Vertex AI, Gemini mode, Gemini 3.5 Flash Lite, and Google ADK TypeScript. No redundant model run was spent after that redeployment. The three journeys above remain live-model evidence from the earlier Vertex/Firestore runtime; revision `counterstep-00005-nft` establishes exact-source deployment plus health, not a fourth model journey. Revision `counterstep-00006-6nd` is the subsequent quota-isolated public fixture and makes no live-model claim.

## Fail-closed evidence and backend decision

The first API-key-backed Cloud Run smoke attempt ended `failed` with `agent_stopped_without_closure`, zero tool calls, zero writes, and no closure (`run-b856ef35-afbf-4076-b098-bad5358dc589`). A direct server-side diagnostic then received HTTP 429 from the Gemini Developer API: its separate prepaid credits were depleted.

No credits were purchased. Counterstep switched to the in-scope Vertex AI path already permitted by the hackathon requirement. A six-token authenticated Vertex request to `gemini-3.5-flash-lite` returned HTTP 200 before redeployment. The final live health and all three passing deployed journeys identify Vertex AI. The obsolete failed-backend revision and image were deleted after their logs and identifiers were recorded.

## Cost and authority controls

- project-wide alerts-only budget: `$1` monthly, actual 50/80/100%, forecast 100%; ID `c073a2a8-4ec2-494f-9d67-54e5bd8bd53c`
- Cloud Run spend cap: `$1` monthly, 50/80/100%, status `Configured`; ID `ecb92e7f-fade-497f-9dcf-e4ad1cd3632a`
- Gemini API spend cap: `$1` monthly, 50/80/100%, status `Configured`; ID `b9ce3683-67b6-497a-a574-4070f128ecf5`
- Vertex AI spend cap: `$1` monthly, 50/80/100%, status `Configured`; ID `cc3c43c8-41b7-46d0-8230-add48c2feff4`
- Cloud Run service and revision: min 0, max 1
- request-based CPU throttling on; startup CPU boost off
- concurrency 1; no session affinity; 1 vCPU; 512 MiB; 30-second request timeout
- application admission: 10 runs per UTC day
- current public mode: deterministic fixture with in-memory synthetic state
- current public Gemini backend: unconfigured; no Gemini/Vertex environment variables or secret
- runtime identity: no Vertex AI or Firestore data role
- retained Firestore free-tier database in `us-central1`, PITR disabled; not accessed by the public fixture
- one current Artifact Registry image retained; obsolete image removed
- only the final deployment and managed-test source archives retained (2.74 MiB total)
- old GKE-generated DNS zone, response policy/rules, and internal range deleted after confirming zero clusters, VMs, disks, addresses, forwarding rules, or VPC dependency
- unused default Compute service account no longer has `roles/editor`

Spend caps are a Preview control and are not an absolute zero-dollar guarantee: Google documents reporting/enforcement latency and possible overage. The service-level bounds, application daily admission, free-tier Firestore settings, storage cleanup, and alerts are therefore independent defense layers. See [Google Cloud spend caps](https://docs.cloud.google.com/billing/docs/how-to/budgets-spend-caps).

## Saved visual evidence

- [Cost controls](./evidence/counterstep-cost-controls-2026-08-31.jpg)
- [Historical proof-revision Cloud Run console (`counterstep-00003-q7m`)](./evidence/counterstep-cloud-run-console-2026-08-31.jpg)
- [Firestore retained runs](./evidence/counterstep-firestore-console-2026-08-31.jpg)
- [Deployed ready state](./evidence/counterstep-cloud-run-ready-2026-08-31.jpg)
- [Deployed repaired closure](./evidence/counterstep-cloud-run-repaired-2026-08-31.jpg)

SHA-256 integrity values, in the same order as the files above:

| File | SHA-256 |
|---|---|
| `counterstep-cost-controls-2026-08-31.jpg` | `bdef5689f69d2b9bb588e8f3fa0836eff380dc784a436b59c511b95f12deb970` |
| `counterstep-cloud-run-console-2026-08-31.jpg` | `cb3f12351ed2f0ce5544056505d733d6384af8a1fa81a681ea264d50c7a71be4` |
| `counterstep-firestore-console-2026-08-31.jpg` | `25ae829443787fc84e7cdcb20360929c243a4b5c4f96d5856d576c766efaee2d` |
| `counterstep-cloud-run-ready-2026-08-31.jpg` | `6e2f13deb90b474c23f17271bb54bf25ff4bea1bb1951b72586d889ae06bc7a3` |
| `counterstep-cloud-run-repaired-2026-08-31.jpg` | `4c0f37d49f13f515da31adfe3e616b3f20088103e40abee1ee3c8c8eaf39614d` |

The Cloud Run console screenshot predates the source-binding redeploy and visibly names revision `counterstep-00003-q7m`; it is historical live-journey proof, not a screenshot of `counterstep-00005-nft` or the current fixture revision. The exact image and revision transitions are established by the build and service records above. The finished 2:57 submission video includes one continuous public E1 execution at 1x speed, the public health response, the 12-event ledger, deterministic closure, and separate Firestore console evidence. Its public YouTube watch page passed signed-out playback and embedding checks on August 31, 2026; YouTube reported a 177-second duration and English captions.

## Verification boundary

- Automated local: passed on the deployed source candidate; 38 files, 445 tests, strict TypeScript, lint, Next.js production build, release/privacy audit.
- Managed Firestore: passed, six retained-write cases in Google Cloud.
- Exact-source live-evidence health: passed on Cloud Run revision `counterstep-00005-nft` before the quota-isolation transition.
- Current public fixture: revision `counterstep-00006-6nd`, 100% traffic, reusing the exact image with Gemini unconfigured, in-memory state, no Vertex AI/Firestore data role, and a signed-out deterministic E1 pass.
- Deployed smoke: passed twice with live Gemini 3.5 / Google ADK / Vertex AI and managed Firestore on immediately preceding equivalent revision `counterstep-00003-q7m`; a third continuous public-browser journey also passed there.
- Deployed visual: ready and repaired states captured at 1280 x 720; Cloud Run, Firestore, and budget console screenshots captured separately.
- Accessibility: prior local checks remain valid for the tested build; no new real screen-reader pass was performed in this cloud-evidence slice.
- Video: the 177.195-second master, public YouTube upload, signed-out playback and embedding, English captions, repository fallback, and deterministic media QC are complete.
