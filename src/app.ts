import * as http from "http";
import * as https from "https";

export const description = "Fetch JSON from a URL.";

const MAX_RESPONSE_BYTES = 2_000_000;
const MAX_RETURN_TOKENS = 32_000;
const MAX_ARRAY_ITEMS = 100;

/**
 * Accepted arguments for the handler function.
 *
 * url: Optional. The URL to fetch JSON from. If omitted, the handler falls back
 *      to the FETCH_URL environment variable.
 *
 * info: Optional. A single dot/bracket path (e.g. "user.name" or "items[0].id")
 *       used to extract a specific value from the fetched JSON.
 */
export type Argument = {
	url?: string;
	info?: string;
};

function getByPath(obj: any, path: string): any {
	if (path == null || path === "") return obj;
	const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".");
	let cur: any = obj;
	for (const key of parts) {
		if (cur == null) return undefined;
		if (Array.isArray(cur)) {
			const idx = Number(key);
			if (Number.isNaN(idx)) return undefined;
			cur = cur[idx];
		} else {
			cur = (cur as any)[key];
		}
	}
	return cur;
}

function pickFields(data: any, path?: string): any {
	if (!path) return data;
	return getByPath(data, path);
}

function estimateBytes(value: any): number {
	if (typeof value === "string") return Buffer.byteLength(value, "utf8");
	try {
		return Buffer.byteLength(JSON.stringify(value), "utf8");
	} catch {
		return 0;
	}
}
function estimateTokens(value: any): number {
	const bytes = estimateBytes(value);
	return Math.max(1, Math.ceil(bytes / 4));
}

function truncateArrays(value: any, maxItems: number): any {
	if (Array.isArray(value)) {
		if (value.length <= maxItems) return value.map((v) => truncateArrays(v, maxItems));
		return value.slice(0, maxItems).map((v) => truncateArrays(v, maxItems));
	}
	if (value && typeof value === "object") {
		const out: any = {};
		for (const k of Object.keys(value)) out[k] = truncateArrays(value[k], maxItems);
		return out;
	}
	return value;
}

async function fetchJson(
	url: string,
	opts: { timeoutMs?: number; maxResponseSize?: number; headers?: Record<string, string> } = {},
): Promise<any> {
	const { timeoutMs = 5000, maxResponseSize = MAX_RESPONSE_BYTES, headers = {} } = opts;
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new Error(`Invalid URL: ${url}`);
	}
	const httpMod = parsed.protocol === "https:" ? https : http;

	return new Promise<any>((resolve, reject) => {
		const req = httpMod.request(
			parsed,
			{ method: "GET", headers: { Accept: "application/json", "User-Agent": "function-calling", ...headers } },
			(res) => {
				if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
					let errBody = "";
					res.on("data", (c) => {
						errBody += c.toString("utf8");
						if (errBody.length > 1000) errBody = errBody.slice(0, 1000) + "...";
					});
					res.on("end", () => reject(new Error(`HTTP ${res.statusCode}: ${errBody}`)));
					return;
				}
				let raw = "";
				let size = 0;
				res.setEncoding("utf8");
				res.on("data", (chunk: string) => {
					size += Buffer.byteLength(chunk, "utf8");
					if (size > maxResponseSize) {
						req.destroy(new Error(`Response larger than ${maxResponseSize} bytes`));
						return;
					}
					raw += chunk;
				});
				res.on("end", () => {
					if (!raw) return resolve(null);
					try {
						return resolve(JSON.parse(raw));
					} catch (e) {
						return reject(new Error("Failed to parse JSON: " + (e as Error).message));
					}
				});
			},
		);
		req.on("error", (e) => reject(new Error("Request error: " + String(e))));
		req.setTimeout(timeoutMs, () => req.destroy(new Error(`Request timed out after ${timeoutMs}ms`)));
		req.end();
	});
}

async function callAndPick(options: {
	url: string;
	path?: string;
	timeoutMs?: number;
	maxResponseSize?: number;
	headers?: Record<string, string>;
}): Promise<any> {
	if (!options?.url || typeof options.url !== "string") throw new Error("options.url required");
	const json = await fetchJson(options.url, {
		timeoutMs: options.timeoutMs,
		maxResponseSize: options.maxResponseSize,
		headers: options.headers,
	});
	return pickFields(json, options.path);
}

export async function handler(args: Argument) {
	console.log(args, "args");

	try {
		const url = args?.url ?? process.env.FETCH_URL;
		console.log(`> trigger: [${url ?? "no-url-provided"}]`);

		if (!url || typeof url !== "string") {
			throw new Error("url must be provided as argument or via FETCH_URL env var");
		}

		const parsedUrl = (() => {
			try {
				return new URL(url);
			} catch {
				throw new Error(`Invalid URL: ${url}`);
			}
		})();

		if (parsedUrl.protocol !== "https:") {
			throw new Error("Insecure protocol disallowed: HTTPS is required.");
		}

		parsedUrl.searchParams.set("t", String(Date.now()));
		const urlWithTs = parsedUrl.toString();

		console.log(`  [url=${url}] Fetching JSON...`);
		const data = await callAndPick({
			url: urlWithTs,
			path: args?.info,
			timeoutMs: 8000,
			maxResponseSize: MAX_RESPONSE_BYTES,
		});
		console.log(`  [url=${url}] Fetched data; evaluating size and info.`);

		const tokens = estimateTokens(data);
		if (tokens > MAX_RETURN_TOKENS) {
			console.warn(`  [url=${url}] Data too large (~${tokens} tokens).`);
			if (!args?.info) {
				return {
					ok: false,
					result: `Result too large (~${tokens} tokens). Provide 'info' to reduce size or increase MAX_RETURN_TOKENS.`,
				};
			}
			const truncated = truncateArrays(data, MAX_ARRAY_ITEMS);
			const truncatedTokens = estimateTokens(truncated);
			if (truncatedTokens > MAX_RETURN_TOKENS) {
				return {
					ok: false,
					result: `Result still too large after truncation (~${truncatedTokens} tokens). Narrow 'info' or increase MAX_RETURN_TOKENS.`,
				};
			}
			return {
				ok: true,
				result: truncated,
			};
		}

		console.log(`  [url=${url}] Returning result (${tokens} tokens approx).`);
		return {
			ok: true,
			result: data,
		};
	} catch (error) {
		console.error("> handler failed:", error);
		const message = error instanceof Error ? error.message : String(error);
		return {
			ok: false,
			result: message,
		};
	}
}
