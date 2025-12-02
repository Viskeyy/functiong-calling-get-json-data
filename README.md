# get-json-data

A minimal tool for "Function Calling" that fetches JSON from a URL and returns a selected value using a single dotted/bracket path (e.g. `user.name`, `items[0].id`).

This README collects important notes and usage guidance previously stored as comments in `src/app.ts`.

---

## Overview

- `description` — a short text used for function-calling metadata.
- `handler(args: Argument)` — the function entrypoint used by the model; it resolves the URL, fetches JSON, optionally extracts a single field using a path, and applies size/token checking before returning the data.

---

## Exports & Types

- `export const description: string` — human-readable function description.
- `export type Argument = { url?: string; info?: string }`
  - `url` — fetch JSON data from this URL (optional, fallback provided via env).
  - `info` — a single dot/bracket path to select a specific value from the fetched JSON (e.g. `user.name` or `items[0].id`).
- `export async function handler(args: Argument)` — function-calling entry point.

Note: `pickFields` only accepts one `info` path (string). This code does not support arrays of paths nor alias maps.

---

## Key Behavior & API

- The function accepts an optional `url` in `args`. If omitted, `process.env.FETCH_URL` is used as a fallback.
- The function will fetch JSON from the URL, parse it, and optionally extract a single `info` path.
- The returned structure: `{ ok: boolean, result: any }` where `ok: true` indicates success and `result` contains the selected JSON (or truncated version). If `ok: false`, `result` contains an error message.
- The function appends a `t` query parameter to the requested URL with the current timestamp to avoid caching side-effects.

---

## Environment Variables

- `FETCH_URL` — fallback URL if `args.url` is not provided. This is the only environment variable the runtime expects.

---

## Constants (defined in-file)

Change these constants in `src/app.ts` if you need different defaults:

- `MAX_RESPONSE_BYTES` — default `2_000_000` (maximum bytes allowed to download from remote server; the request aborts if exceeded).
- `MAX_RETURN_TOKENS` — default `32_000` (approximate token limit for the model response; heuristic is bytes/4).
- `MAX_ARRAY_ITEMS` — default `100` (max items retained per array when truncating arrays to shrink results).

---

## Security Notes

- The function enforces HTTPS (non-HTTPS URLs are rejected).
- Since `ALLOWED_HOSTS`/similar environment variables are not present here, there is no runtime-host restriction by default — please be mindful of SSRF/security implications when calling arbitrary URLs. The safest approach is to only supply a constrained `url` (or otherwise edit/extend the function to reintroduce host restrictions).
- `MAX_RESPONSE_BYTES` prevents large downloads from exhausting memory.

---

## Implementation Notes

- `fetchJson(url, opts)`:
  - Uses Node `http` / `https`.
  - Timeout: `timeoutMs` default 5000 ms (configurable per call).
  - `maxResponseSize` defaults to `MAX_RESPONSE_BYTES` constant (2MB).
  - Accept header set to `application/json`.
  - Adds query param `t` with current timestamp to avoid caching.
  - Throws errors on non-2xx status codes or JSON parse errors.

- `callAndPick({ url, path, ... })`:
  - Fetches JSON and picks the `path` using `pickFields`.
  - Throws on invalid url, parsing errors, or response size exceeding `maxResponseSize`.

- `pickFields` behavior:
  - Accepts a single dot/bracket notation `path` string (e.g. `items[0].id`).
  - If path is omitted, returns the entire JSON body.

- `getByPath`:
  - Extracts a nested value from the JSON using dot/bracket path syntax.

- `truncateArrays`:
  - Recursively truncates arrays at `MAX_ARRAY_ITEMS` to help shrink result size for the model while preserving shape.

- Token estimation:
  - `estimateTokens(value)` returns `max(1, ceil(bytes(value) / 4))` where bytes are computed using `JSON.stringify(value)` (UTF-8).

---

## Example Usage (programmatic)

```ts
import { handler } from "./src/app";

(async () => {
  // Provide `url` explicitly or rely on FETCH_URL env var
  const args = { url: "https://api.example.com/data.json", info: "user.name" };
  const res = await handler(args);
  if (res.ok) {
    console.log("Result:", res.result);
  } else {
    console.error("Error:", res.result);
  }
})();
```

---

## Example SDK Integration (OpenAI function-calling style)

```ts
// Exported function metadata (e.g. functionSchema) is used to register this function
// with function-calling SDKs. The model can then call this function with `args` containing
// `url` and optionally `info` (a single path).

const functions = [
  {
    name: "get-json-data",
    description: "Fetch JSON from a URL.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string" },
        info: { type: "string", description: "Dot/bracket path to select value" },
      },
      required: ["url"],
    },
  },
];

// Example: model calls our function, we parse arguments and call handler(args)
```

---

## Practical Recommendations

1. Prefer to provide `info` when invoking this function to avoid returning the entire JSON payload.
2. Because `MAX_*` values are constants in the source rather than environment variables, edit `src/app.ts` to change them if needed (and re-deploy).
3. Be very careful when providing arbitrary `url` values — if you rely on user-provided URLs, consider adding host restrictions or other controls; the minimal version here does not include runtime host allowlists.
4. For very large datasets:
   - Implement server-side extraction (only fetch what's necessary).
   - Store large results in a secure object store and return a signed URL + lightweight summary instead of returning raw JSON.

---

## Why comments were moved to README

- Inline comments were consolidated into this `README.md` to keep `src/app.ts` minimal and deployment-ready.
- This README contains the same guidance and notes previously embedded as comments.

---