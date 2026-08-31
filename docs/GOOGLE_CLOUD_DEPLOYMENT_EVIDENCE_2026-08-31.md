# Google Cloud deployment evidence — August 31, 2026

This record separates automated, managed, deployed, visual, and still-manual evidence. It contains synthetic run identifiers only and no credentials, billing-account identifier, or secret material.

## Public deployment

- URL: https://counterstep-27573808078.us-central1.run.app
- Google Cloud project: `handy-operation-492002-h3` (`Counterstep Hackathon`)
- Cloud Run region: `us-central1`
- live revision: `counterstep-00003-q7m`, 100% traffic
- successful image build: `58f8b7f8-c204-4006-a46e-ee86f8d00370`
- Artifact Registry digest: `sha256:2c9ce8e1343f79fd0867cffdbf4761006b2a0e9571ee161a23ad07f7525ceb98`
- build identity: dedicated service account `counterstep-build` in the deployment project
- runtime identity: separate service account `counterstep-runtime` in the deployment project

The Cloud Build source archive retained for this image is `gs://handy-operation-492002-h3_cloudbuild/source/1788154481.382153-91bcf805850b475889636e7ba736d5c6.tgz`, generation `1788154482313031`, size `1437142`, MD5 `ofGDPX3JRGtyDfMPFCOUyg==`, and CRC32C `FKppQQ==`. The build completed `SUCCESS` at `2026-08-31T05:38:14.838884Z`.

The deployed image came from the verified working tree based on commit `88c7c6a963c257e79936bba89db78d952e2ddec1`, not yet from a new pushed source commit. The cost, Vertex, evidence-contract, and deployment changes in this record remain uncommitted at the time of writing. A later source release must commit and push the exact reviewed changes, then preferably redeploy that commit before final submission freeze.

## Live health contract

`GET /api/health` returned HTTP 200 on the public URL with:

```json
{
  "ok": true,
  "appVersion": "0.1.0",
  "deployment": "cloud-run",
  "repository": "firestore",
  "repositoryReachable": true,
  "geminiConfigured": true,
  "modelBackend": "vertex-ai",
  "agentMode": "gemini",
  "modelId": "gemini-3.5-flash-lite",
  "agentFramework": "google-adk-typescript"
}
```

The revision uses Cloud Run workload identity for Vertex AI and Firestore. It has no `GEMINI_API_KEY` secret reference. Both runtime and build access to the retained Developer API secret were revoked after the Vertex revision became healthy.

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

The strict public smoke command passed twice against the keyless Vertex revision:

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
- concurrency 1; no session affinity; 1 vCPU; 512 MiB
- application admission: 10 runs per UTC day
- Firestore free-tier database in `us-central1`, PITR disabled
- one current Artifact Registry image retained; obsolete image removed
- only the final deployment and managed-test source archives retained (2.74 MiB total)
- old GKE-generated DNS zone, response policy/rules, and internal range deleted after confirming zero clusters, VMs, disks, addresses, forwarding rules, or VPC dependency
- unused default Compute service account no longer has `roles/editor`

Spend caps are a Preview control and are not an absolute zero-dollar guarantee: Google documents reporting/enforcement latency and possible overage. The service-level bounds, application daily admission, free-tier Firestore settings, storage cleanup, and alerts are therefore independent defense layers. See [Google Cloud spend caps](https://docs.cloud.google.com/billing/docs/how-to/budgets-spend-caps).

## Saved visual evidence

- [Cost controls](./evidence/counterstep-cost-controls-2026-08-31.jpg)
- [Cloud Run console](./evidence/counterstep-cloud-run-console-2026-08-31.jpg)
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

These screenshots support repository review and video planning. They do not substitute for the hackathon's required unedited video segment showing the live action. For the recording, open the public URL, show the Cloud Run URL/revision or health response, reset the canonical scenario, click **Run Counterstep**, wait continuously, then show `Contract matched`, the 12-event ledger, deterministic closure, and Firestore run document.

## Verification boundary

- Automated local: passed after the Vertex/backend change; 38 files, 444 tests, strict TypeScript, lint, Next.js production build, release/privacy audit.
- Managed Firestore: passed, six retained-write cases in Google Cloud.
- Deployed health: passed on Cloud Run revision `counterstep-00003-q7m`.
- Deployed smoke: passed twice with live Gemini 3.5 / Google ADK / Vertex AI and managed Firestore.
- Deployed visual: ready and repaired states captured at 1280 x 720; Cloud Run, Firestore, and budget console screenshots captured separately.
- Accessibility: prior local checks remain valid for the tested build; no new real screen-reader pass was performed in this cloud-evidence slice.
- Video: shot assets and an exact continuous path are ready; the final unedited recording remains manual.
