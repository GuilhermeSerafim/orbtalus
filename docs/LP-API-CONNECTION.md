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

The follow-up dependency pass on 18 November 2026 reproduced 12 production findings
(1 critical, 8 high, 3 moderate), upgraded Next from 16.0.10 to 16.4.6, removed
unused direct Zod/resolver dependencies after checking source imports, and updated
affected transitive packages within their declared ranges without `--force`.
Both production-only and full dependency audits then reported zero known
vulnerabilities. This is a point-in-time advisory check, not a security guarantee.
TypeScript and all 296 guarded regression checks passed after the runtime update.

ESLint was missing despite the existing lint script. The follow-up installs
ESLint 10.15.0 and matching Next flat presets without rule overrides. Eight
reported errors were resolved through selection/event typing, helper declaration
order, an equivalent input type alias, a constant angle, and imperative canvas
visibility in the unused legacy 3D background. The final lint run reports zero
errors and eleven warnings. TypeScript and all 296 guarded checks pass on this
delta. ESLint requires Node `^20.19.0 || ^22.13.0 || >=24`; local verification
uses Node 22.18.0. React 18 remains supported by Next's peer contract but deprecated
for a future Next 17 upgrade. No runtime/provider analysis is implied by these checks.

The final production webpack build (`node node_modules/next/dist/bin/next build
--webpack`, scoped `NODE_OPTIONS=--max-old-space-size=2048`) exited successfully,
including `/`, `/analise`, and `/icon.svg`. This local build does not establish
cloud API access. A read-only Vercel configuration check found that the existing
shared public API variable still selects the historical Google Cloud Run backend,
not Render. Its value was not changed. Switch only after the new API origin and
exact frontend CORS are verified; changing it may affect production as well as
preview/development because the existing variable targets all three environments.
