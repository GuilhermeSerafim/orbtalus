# Landing page and analysis API connection

The homepage and `/analise` are routes in the same Next application. The landing CTA opens `/analise`; it does not submit an analysis. Mapbox rendering and the risk endpoint require separate browser configuration.

## Local development

Keep the existing API on `http://127.0.0.1:8000`. Configure the ignored `.env.local` with the existing public Mapbox token and:

```dotenv
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:18085/api
NEXT_PUBLIC_API_RISK_ENDPOINT=/geo/risk
ORBTALUS_LOCAL_API_PROXY=1
```

Run `npm ci`, then `npm run dev -- --webpack --hostname 127.0.0.1 --port 18085` from this worktree. Use an unoccupied port; do not start a second API. Configuration changes require restarting only the relevant preview.

The opt-in development rewrite forwards exactly `/api/geo/risk` to the fixed loopback API. Its 120-second timeout avoids the default proxy budget expiring before the existing 45-second upstream socket timeout. This does not add retries or change analytical guards. No arbitrary destination or other API route is proxied. Both the rewrite and timeout are disabled outside development.

## Production configuration

Set `NEXT_PUBLIC_API_BASE_URL` to the actual public HTTPS API origin, and `NEXT_PUBLIC_API_RISK_ENDPOINT=/geo/risk`. Set the public Mapbox token for the deployed domain. Backend CORS must allow the exact frontend origin. Browser variables are embedded at build time; rebuild after changing them. The existing metadata base still names `https://geo-risk-front.vercel.app`; change it together with canonical/domain configuration once the final domain is selected.

Never put database, GEE or OpenAI credentials in frontend variables or Git. A local Docker database is not a cloud database. Render deployment, PostGIS connectivity, runtime credentials and Vercel/domain activation are separate steps; this PR does not perform them.

## Scope and evidence

The integration reuses the reviewed analysis component and contract validation: independent AI panel opened by button, keyboard/focus handling, mobile access, retained completed results, and removal of the redundant final-score card. It preserves the calculated-risk/AI-consistency guards.

One authorized live analysis in the local source worktree returned HTTP 200 on 17 November 2026, with a 662-character explanation visible in the panel. This verifies that local request/response path only. It does not validate every input, scientific accuracy, costs or cloud readiness. No additional provider analysis is needed to prepare this PR.

The public Mapbox browser SDK may load styles, tiles, fonts and telemetry. Local UI verification must not be described as zero external traffic. Grammarly attributes injected into `body` explained the reported hydration warning; no blanket suppression is added to `body`.

## Media provenance

`public/media/river-context.mp4` is a self-hosted 14-second, silent derivative of Mixkit free commercial clip 51451, with a local poster. It is visual context, not satellite evidence or an output of the risk API. Preserve the source/license record when changing this asset.

## Release gates

Review the draft changes, validate the exact locked frontend dependencies and production build, resolve dependency-security findings, and validate the backend image/cloud configuration before merging for production. Local success is not a deployment approval.

Integration checks on 18 November 2026: clean dependency installation, `npm run typecheck`, and all 296 `npm run test:analysis` checks passed in this PR worktree. The latter used simulated SDK/HTTP boundaries with zero unmocked egress; it is not a browser/provider certification. The Mapbox geocoder receives the SDK module namespace to satisfy its typed contract, rather than an unchecked type assertion. Production build and lint were not run in this integration pass.

`npm audit --omit=dev` reported 12 production-dependency findings: 1 critical, 8 high, and 3 moderate. The retained Next 16.0.10 is among the affected direct dependencies. This draft deliberately does not fold a dependency upgrade into the LP integration. Resolve and verify these findings before production; do not run an automatic force upgrade or interpret passing UI tests as security clearance.
