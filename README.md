# TVM Intelligent Inspector (TTI)

Production-style TON transaction analysis app built with Next.js, Tailwind CSS v4, shadcn/base UI, TonAPI, and Vercel AI SDK (`ai`, `@ai-sdk/google`, `@ai-sdk/react`).

The app accepts a TON transaction hash, fetches deterministic transaction/trace/event data from TonAPI, generates structured risk scoring, streams a full interpretation report, and lets users download the final report as Markdown.

## What This App Does

- Validates TON transaction hashes (64-char hex or base64url-like hash).
- Fetches deterministic blockchain data from TonAPI:
  - `/v2/traces/{hash}`
  - `/v2/events/{hash}`
  - `/v2/blockchain/transactions/{canonicalHash}`
- Normalizes and flattens trace trees into a UI-friendly table.
- Preserves large numeric values as strings to avoid precision drift.
- Produces structured AI assessment:
  - `confidence` (0-100)
  - `scamScore` (0-100)
  - `riskLevel` (`low` | `medium` | `high`)
  - `verdict`
  - `evidence[]`
- Streams a markdown interpretation report with fixed sections.
- Supports resilient fallback behavior when TonAPI or Gemini is unavailable.
- Exports a final markdown report directly in-browser (no server file writes).

## Tech Stack

- Next.js `16.1.7` (App Router)
- React `19.2.3`
- Tailwind CSS `v4`
- shadcn components (Base UI primitives, not Radix)
- Vercel AI SDK `6.x`
- Google provider `@ai-sdk/google`
- `zod` for schema validation
- `json-bigint` for safe parsing of large numeric blockchain fields

## Architecture Overview

### Request Flow

1. User submits `txHash` in UI (`app/page.tsx`).
2. `POST /api/tvm/report`:
   - Validates input
   - Fetches TonAPI deterministic data
   - Normalizes data
   - Builds compact `reportContext`
   - Generates structured assessment with Gemini (or fallback heuristic)
3. UI renders deterministic data + assessment immediately.
4. UI calls `POST /api/tvm/interpret` using `useCompletion`.
5. Backend streams markdown interpretation (or fallback interpretation text).
6. User can download a complete markdown report.

### Main Files

- `app/page.tsx`: Single-page enterprise-neutral dashboard UI.
- `app/api/tvm/report/route.ts`: Deterministic report + structured scoring route.
- `app/api/tvm/interpret/route.ts`: Streamed interpretation route.
- `lib/tvm/tonapi.ts`: TonAPI client, retries, timeout, error mapping.
- `lib/tvm/normalize.ts`: Deterministic normalization and trace flattening.
- `lib/tvm/assessment.ts`: AI scoring + fallback heuristic scoring.
- `lib/tvm/types.ts`: Shared Zod schemas and TypeScript types.
- `lib/tvm/export-markdown.ts`: Markdown export generator.
- `components/tvm/markdown-view.tsx`: Markdown rendering.

## Environment Variables

Copy `.env.example` to `.env` and set values:

```bash
cp .env.example .env
```

Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

### Required

- `GOOGLE_GENERATIVE_AI_API_KEY`
  - Used for Gemini `gemini-2.5-flash` in both scoring and interpretation.
  - If missing, app still works using fallback scoring and fallback interpretation.

### Optional

- `TONAPI_API_KEY`
  - Recommended to reduce rate-limit/auth issues on TonAPI.
- `TONAPI_BASE_URL`
  - Defaults to `https://tonapi.io`.

## Local Development

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000`.

## Scripts

- `pnpm dev` - run local dev server
- `pnpm build` - production build
- `pnpm start` - start built app
- `pnpm lint` - run ESLint

## API Reference

## `POST /api/tvm/report`

Builds deterministic TonAPI snapshot and structured scoring.

### Request

```json
{
  "txHash": "string"
}
```

### Validation

- `txHash` is normalized by removing optional `0x` prefix.
- Accepted formats:
  - 64-char hex
  - base64url-like hash (`43..120` chars)

### Response (`TraceReportPayload`)

```json
{
  "network": "mainnet",
  "canonicalTxHash": "string",
  "deterministic": {},
  "assessment": {
    "confidence": 0,
    "scamScore": 0,
    "riskLevel": "low",
    "verdict": "string",
    "evidence": ["string"]
  },
  "assessmentSource": "ai",
  "assessmentNote": "string",
  "reportContext": {}
}
```

### Error Behavior

- `400` invalid request body.
- `404` transaction/trace not found on TonAPI.
- `429/5xx` TonAPI recoverable failures:
  - returns deterministic "unavailable snapshot"
  - returns fallback assessment + note
- `500` unexpected internal failure.

### Caching

- Response is always `Cache-Control: no-store`.

## `POST /api/tvm/interpret`

Streams interpretation text.

### Request Body (from `useCompletion`)

```json
{
  "prompt": "tx hash string",
  "reportContext": {},
  "assessment": {}
}
```

### Response

- Plain text stream (`text/plain; charset=utf-8`).
- Expected markdown sections:
  - `## Summary`
  - `## Execution Path`
  - `## Action Breakdown`
  - `## Fees and Value Flow`
  - `## Risks and Anomalies`
  - `## Confidence and Scam Scoring`

### Fallback Behavior

- If `GOOGLE_GENERATIVE_AI_API_KEY` is missing:
  - Returns non-stream fallback interpretation markdown immediately.
- If stream starts and fails mid-way:
  - Appends fallback interpretation with interruption note.
- If stream fails before first token:
  - Returns fallback interpretation.

## Scoring Model and Rules

- Model is fixed to `google("gemini-2.5-flash")`.
- Structured output is enforced with `Output.object(...)` and Zod schema.
- `confidence` and `scamScore` are clamped to `[0, 100]`.
- Final `riskLevel` is derived from `scamScore`:
  - `0..34` -> `low`
  - `35..69` -> `medium`
  - `70..100` -> `high`

If AI scoring fails, heuristic fallback scoring is used based on:

- `event.isScam`
- transaction success/failure
- failed trace nodes
- failed event actions
- in-progress event state
- trace depth/coverage confidence signal

## Deterministic Data Normalization Notes

- Large values are parsed with `json-bigint` and stored as strings.
- Trace recursion is flattened with depth and parent relation context.
- UI-friendly summaries include:
  - transaction status/fees/phases
  - trace nodes with direction and exit/gas hints
  - event actions and value flow

## UI and UX

- Enterprise-neutral one-page dashboard.
- Two-column desktop layout:
  - left rail: input/actions, assessment, quick facts
  - right rail: deterministic tabs + interpretation
- Single-column responsive layout on smaller screens.
- Uses shadcn/base primitives:
  - `Card`, `Input`, `Button`, `Alert`, `Badge`, `Progress`
  - `Tabs`, `Table`, `ScrollArea`, `Skeleton`, `Empty`
- Streaming interpretation rendered via `react-markdown` + `remark-gfm`.

## Report Export

- Download button generates `.md` report in browser.
- Export includes:
  - metadata and network/hash
  - structured assessment block
  - deterministic transaction/trace/action/value-flow tables
  - full streamed interpretation
- No server-side file persistence.

## Reliability and Timeouts

TonAPI client behavior (`lib/tvm/tonapi.ts`):

- per-attempt timeout: `12s`
- max attempts: `3`
- retries on:
  - HTTP `429`
  - HTTP `5xx`
  - retryable network errors (`fetch failed`, timeout, socket-related)

API routes set:

- `export const maxDuration = 60`

## Troubleshooting

## `Failed to build TVM trace report ... Connect Timeout Error` or `fetch failed`

Likely causes:

- outbound network restrictions from server/container
- temporary Google/TonAPI network instability
- blocked DNS or TLS egress

Checks:

- Confirm server can reach:
  - `https://tonapi.io`
  - Google endpoints used by Gemini provider
- Verify `GOOGLE_GENERATIVE_AI_API_KEY` is set and valid.
- Provide `TONAPI_API_KEY` to avoid stricter rate limits.
- Retry requests; recoverable TonAPI failures already fallback gracefully.

## Railpack: `pnpm install --frozen-lockfile --prefer-offline` -> `packages field missing or empty`

This repo requires `pnpm-workspace.yaml` to include:

```yaml
packages:
  - "."
```

Current project already includes this. If error reappears:

- ensure `pnpm-workspace.yaml` is copied into build context
- ensure file is not overwritten by CI step
- clear build cache and rebuild

## Missing Gemini key

If `GOOGLE_GENERATIVE_AI_API_KEY` is absent:

- `/api/tvm/report` returns fallback assessment with note
- `/api/tvm/interpret` returns fallback interpretation text

The app remains usable, but AI quality is reduced.

## Security and Scope

- Mainnet only (`network: "mainnet"`).
- No persistent storage or user history in v1.
- This tool is an analysis assistant, not financial advice.
- Scam/risk scores are heuristic/model-based and can be wrong.

## Suggested Validation Checklist

1. Submit a valid hash and verify deterministic panels populate.
2. Confirm interpretation stream starts and completes.
3. Verify Download exports a readable `.md` report.
4. Submit invalid hash and verify inline validation blocks request.
5. Temporarily remove Gemini key and verify fallback path works.
6. Run `pnpm lint` and `pnpm build` before deployment.
