# Counterstep release and submission QA

Evidence snapshot: August 31, 2026. This ledger separates repository checks, emulator behavior, managed services, live model behavior, rendered UI checks, and remaining submission actions.

## Release identity

| Item | Exact value | Status |
|---|---|---|
| Deployed source commit | `5890e2b09049564130428f3d6cc4a768b221b180` | Pushed to `main` before the docs/media follow-up |
| Hosted CI | [Run `33368011137`](https://github.com/mihirduvedi/counterstep/actions/runs/33368011137) | Passed on the deployed source commit |
| Cloud Build | `e734fe09-5e29-41cc-a6fd-310ab8f186c3` | `SUCCESS` |
| Live-evidence Cloud Run revision | `counterstep-00005-nft` | Historical exact-source Vertex/Firestore health proof |
| Current public Cloud Run revision | `counterstep-00006-6nd` | Ready, 100% traffic; fixture/memory, Gemini unconfigured |
| Image digest | `sha256:766f1d07da7cb4f853638c93659a995926a7a8eadc6eec56ceb67d19efaa42c4` | Bound to the exact-source build |
| Public synthetic demo | <https://counterstep-27573808078.us-central1.run.app> | HTTP 200; fixture/memory; no Gemini or managed Firestore access |

## Repository gate

Command:

```bash
npm run verify
```

Fresh result:

- ESLint passed with zero warnings.
- Strict TypeScript passed.
- 38 Vitest files and 445 tests passed.
- Next.js 16.3.3 standalone production build passed.
- The generated Turbopack secret scrub removed one exact server-secret cache match after the successful build.
- Release/privacy audit passed.

Additional current checks:

| Check | Result | Boundary |
|---|---|---|
| `npm run eval` | 1 file / 5 cases passed | Deterministic scenario and trust-contract evaluation |
| `npm run test:firestore` | 1 file / 8 cases passed | Production Firestore repository against the official local emulator; not managed-cloud evidence |
| `npm audit --omit=dev --audit-level=high` | 0 vulnerabilities | Production dependency audit at the time of the snapshot |
| strict UI static scan | 60 tracked application source files, 0 errors, 0 warnings | Scoped to `src/`; heuristic source check, not rendered or assistive proof |

## Current rendered product check

Local fixture configuration:

```bash
cp .env.example .env.local
npm run dev -- --hostname 127.0.0.1 --port 3100
```

For this check, `.env.local` set `COUNTERSTEP_AGENT_MODE` to `fixture` and
`COUNTERSTEP_REPOSITORY` to `memory`, with credential fields left blank.

The current E1 judge journey reached `Contract matched` and rendered:

- `repaired` outcome;
- 2 successful writes;
- 0 replans;
- 6 tool calls;
- 1 approved plan;
- spreadsheet version `v3 → v4`, state `external → revoked`;
- message version `v1 → v2`, state `queued → cancelled`;
- 12/12 accounted events;
- both closure goals satisfied;
- an in-authority action verdict and closure digest;
- no relevant browser console warning or error.

Fixture mode proves the visible deterministic journey and shared gate/tool/closure contracts. It does not prove live Gemini, Vertex AI, managed Firestore, or Cloud Run.

## Managed and deployed evidence

- Managed Firestore build `0a89c790-f5f7-4e16-95c4-b0362b60b7df` passed six retained production-adapter cases.
- Two strict smoke journeys and one continuous browser journey passed with Gemini 3.5 Flash Lite through Google ADK on Vertex AI and managed Firestore on the immediately preceding equivalent runtime revision.
- Exact-source live-evidence revision `counterstep-00005-nft` passed the Vertex/Firestore health contract without spending another model request.
- Current public revision `counterstep-00006-6nd` reuses the exact image and returns HTTP 200 with `memory`, `fixture`, `geminiConfigured: false`, and `modelBackend: unconfigured`.
- A signed-out public E1 fixture run reached `repaired` with two synthetic writes, 12 events, one approved plan, six tool calls, and an exact scenario match; `modelId` was absent.
- The runtime service account has no Vertex AI or Firestore data role. The service remains min zero / max one with request-based CPU, concurrency one, a 30-second request timeout, and a 10-run UTC daily application cap.

Run IDs, digests, source archives, service controls, and screenshot hashes are in [GOOGLE_CLOUD_DEPLOYMENT_EVIDENCE_2026-08-31.md](GOOGLE_CLOUD_DEPLOYMENT_EVIDENCE_2026-08-31.md).

## Judge-facing repository audit

Completed:

- [x] README opens with the problem, live demo, one-minute judge path, and exact evidence links.
- [x] README includes the required architecture diagram and reproducible local setup.
- [x] Devpost copy is Counterstep-specific and covers features, technology, data, challenges, accomplishments, learnings, reuse, testing, and final form checks.
- [x] Judge guide is Counterstep-specific and maps evidence to the three official criteria.
- [x] Demo script targets a four-minute maximum and preserves one continuous live-action segment with Google Cloud proof.
- [x] A publish-ready build article contains the required hackathon-purpose disclosure, and LinkedIn/X copy includes `#AllThingsAgenticHackathon`.
- [x] Reuse disclosure distinguishes the Agent Receipt foundation from new Counterstep work.
- [x] Current evidence names the exact-source build, revision, image digest, release SHA, and CI run.
- [x] No credentials, `.env` files, real personal data, or private logs are tracked.

## Signed-out link audit

| Target | Result | Action |
|---|---|---|
| Public Cloud Run demo | HTTP 200; fixture/memory runtime | Ready without model/database quota |
| Public health endpoint | HTTP 200 with Gemini unconfigured and in-memory repository | Ready |
| GitHub repository | HTTP 200 while signed out; repository is public | Ready |
| Hosted CI link | Public with repository visibility | Ready |
| Demo video | Public YouTube watch page is playable and embeddable signed out; 177-second duration and English captions confirmed; repository fallback and English SRT retained | Ready |

## Accessibility and responsive evidence

Previously recorded checks cover semantic landmarks and headings, the named scenario group, pressed state, disabled execution state, 44-pixel-or-larger important targets, visible focus, reduced motion, forced colors, 360px, 768px, 1440px, and a 720px 200%-zoom equivalent. The current rack and E1 terminal state have been re-rendered on the local submission candidate derived from the exact-source release.

The current mobile accessibility-tree pass found that the hero's visual line break exposed the heading as `overstepto`. The H1 now has the exact accessible name `From agent overstep to verified counterstep.`, a focused regression test passes, and the repaired name was re-read from the rendered browser accessibility tree. This is a fixed P1 content/assistive defect, not evidence of a full screen-reader certification.

Do not describe the product as accessibility-certified. Record the exact browser, viewport, input method, and assistive technology for any new manual pass.

## Remaining submission gates

- [x] Add the final public YouTube URL to `docs/SUBMISSION.md` after a signed-out playback, embedding, duration, and English-caption check.
- [ ] Confirm the prepared solo team line (`Mihir Duvedi`) matches the actual Devpost team and eligibility.
- [x] Make the repository public and verify the repository and raw README signed out.
- [x] Verify the repository, CI, public fixture, YouTube video, architecture diagram, and submission links signed out after the final release.
- [ ] Capture the final Devpost preview and confirm the **Taskmaster** category.
- [ ] If claiming optional bonus points, publish the build article and social post publicly, verify both signed out, and add their URLs to Devpost.
- [ ] Submit before August 31, 2026 at 5:00 PM Pacific Time.
- [ ] Freeze the submitted repository, video, and app through the judging period. Continue future work in a separate fork.

## Release boundary

Counterstep restores known-safe state within a disclosed two-resource synthetic sandbox after a completed run. It does not watch or intercept live agents, operate real customer systems, provide universal rollback, certify compliance, prove trace completeness, or capture private chain-of-thought. Every closure is qualified by the supplied original trace, remediation authority, recorded tool results, and final sandbox snapshots.
