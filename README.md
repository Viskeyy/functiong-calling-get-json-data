# get-json-data

A minimal tool for "Function Calling" that fetches JSON from a URL and optionally extracts a specific value using a dot/bracket path (e.g. `user.name`, `items[0].id`).

---

## Overview

- `description` — a short text used for function-calling metadata.
- `handler(args: Argument)` — the function entrypoint used by the model; it resolves the URL, fetches JSON, optionally extracts a field using an `info` path, truncates arrays, and returns the result.

---

## Exports & Types

- `export const description: string` — human-readable function description.
- `export type Argument = { url?: string; info?: string }`
  - `url` — fetch JSON data from this URL (optional, fallback provided via `FETCH_URL` env var).
  - `info` — optional dot/bracket path to extract a specific value from the fetched JSON (e.g. `user.name`, `items[0].id`). If omitted, returns the entire JSON payload.
- `export async function handler(args: Argument)` — function-calling entry point.

---

## Key Behavior & API

- The function accepts an optional `url` in `args`. If omitted, `process.env.FETCH_URL` is used as a fallback.
- The function fetches JSON from the URL using the `fetch` API with a 5-second default timeout (8 seconds in handler).
- If `args.info` is provided, the function extracts a single nested field from the JSON using dot/bracket notation.
- Arrays in the result are recursively truncated to a maximum of `MAX_ARRAY_ITEMS` (default: 50) to keep the result size manageable.
- The returned structure: `{ ok: boolean, result: any }` where:
  - `ok: true` indicates success and `result` contains the extracted JSON (or full JSON if no `info` path).
  - `ok: false` indicates an error and `result` contains an error message.
- The function appends a `t` query parameter to the requested URL with the current timestamp to avoid caching side-effects.

---

## Environment Variables

- `FETCH_URL` — fallback URL if `args.url` is not provided.

---

## Constants (defined in-file)

- `MAX_ARRAY_ITEMS` — default `50` (max items retained per array when truncating arrays to shrink results).

---

## Security Notes

- The function enforces HTTPS (non-HTTPS URLs are rejected).
- There is no runtime-host restriction by default — please be mindful of SSRF/security implications when calling arbitrary URLs. The safest approach is to only supply a constrained `url` or add host restrictions.

---

## Implementation Details

- `fetchJson(url, opts)`:
  - Uses the global `fetch` API (available in Node 18+).
  - Timeout: `timeoutMs` default 5000 ms (configurable per call).
  - Uses `AbortController` to enforce timeout.
  - Throws errors on non-2xx HTTP status codes or JSON parse errors.
  - Appends a query param `t` with the current timestamp to avoid caching.

- `getByPath(obj, path)`:
  - Extracts a nested value from an object using dot/bracket path syntax.
  - Supports both object keys and array indices (e.g., `items[0].name`).
  - Returns `undefined` if any part of the path doesn't exist.

- `pickFields(data, path)`:
  - If path is omitted, returns the entire `data` object.
  - Otherwise, calls `getByPath(data, path)` to extract the nested value.

- `truncateArrays(value, maxItems)`:
  - Recursively truncates arrays at `MAX_ARRAY_ITEMS` to help reduce result size while preserving the JSON structure.

---

## Example Usage (programmatic)

```ts
import { handler } from "./src/app";

(async () => {
  // Example 1: Fetch entire JSON
  const res1 = await handler({ url: "https://api.example.com/data.json" });
  if (res1.ok) {
    console.log("Full data:", res1.result);
  }

  // Example 2: Extract a specific field
  const res2 = await handler({
    url: "https://api.example.com/data.json",
    info: "user.name",
  });
  if (res2.ok) {
    console.log("User name:", res2.result);
  }

  // Example 3: Extract an array element
  const res3 = await handler({
    url: "https://api.example.com/data.json",
    info: "items[0].id",
  });
  if (res3.ok) {
    console.log("First item ID:", res3.result);
  }
})();
```

---

## Example SDK Integration (OpenAI function-calling style)

```ts
const functions = [
  {
    name: "get-json-data",
    description: "Fetch JSON from a URL and optionally extract a specific field.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to fetch JSON from" },
        info: {
          type: "string",
          description: "Optional dot/bracket path to extract a specific value (e.g. 'user.name' or 'items[0].id')",
        },
      },
      required: ["url"],
    },
  },
];

// Example: model calls our function, we parse arguments and call handler(args)
```

---

## Practical Recommendations

1. Use the `info` parameter to extract only the specific field you need, reducing payload size.
2. Arrays are automatically truncated to 50 items. If you need all items, consider:
   - Fetching a narrower endpoint on the remote server.
   - Making multiple requests with pagination.
   - Modifying `MAX_ARRAY_ITEMS` if needed.
3. Be very careful when providing arbitrary `url` values — consider adding host restrictions if accepting user-provided URLs.
4. For very large datasets:
   - Implement server-side extraction (only fetch what's necessary).
   - Use pagination or filtering on the remote endpoint.
   - Store large results in a secure object store and return a signed URL instead.

---

## Example Info Paths

- `"user"` — extracts `data.user`
- `"user.name"` — extracts `data.user.name`
- `"items[0]"` — extracts the first item from `data.items`
- `"items[0].id"` — extracts the `id` of the first item
- `"results[5].user.email"` — extracts nested data from an array element

---