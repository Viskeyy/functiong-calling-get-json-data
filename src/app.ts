export const description = "Fetch JSON from a URL.";

const MAX_ARRAY_ITEMS = 50;

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

async function getLatestJsonUrl(url: string): Promise<string> {
	try {
		const response = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Referer: "https://aicon.infoq.cn",
				Accept: "application/json",
				"User-Agent": "function-calling",
			},
			body: JSON.stringify({
				location_en: "beijing",
				time: 202512,
				category: 1,
			}),
		});

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: Failed to fetch latest JSON URL`);
		}

		const res = await response.json();

		if (!res?.data?.json) {
			throw new Error("Invalid response structure: missing data.json");
		}

		return res.data.json;
	} catch (error) {
		throw error;
	}
}

async function fetchJson(url: string, opts: { timeoutMs?: number } = {}): Promise<any> {
	const { timeoutMs = 5000 } = opts;

	try {
		new URL(url);
	} catch {
		throw new Error(`Invalid URL: ${url}`);
	}

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const res = await fetch(url, {
			method: "GET",
			headers: { Accept: "application/json", "User-Agent": "function-calling" },
			signal: controller.signal,
		});

		if (!res.ok) {
			let errBody = "";
			try {
				errBody = await res.text();
			} catch {
				errBody = "";
			}
			if (errBody.length > 1000) errBody = errBody.slice(0, 1000) + "...";
			throw new Error(`HTTP ${res.status}: ${errBody}`);
		}

		const raw = await res.text();
		if (!raw) return null;

		try {
			return JSON.parse(raw);
		} catch (e) {
			throw new Error("Failed to parse JSON: " + (e as Error).message);
		}
	} catch (e: any) {
		if (e?.name === "AbortError") {
			throw new Error(`Request timed out after ${timeoutMs}ms`);
		}
		throw e;
	} finally {
		clearTimeout(timeoutId);
	}
}

export async function handler(args: Argument) {
	try {
		const url = args?.url ?? process.env.FETCH_URL;
		console.log(`> trigger: [${url ?? "no-url-provided"}]`);

		if (!url || typeof url !== "string") {
			throw new Error("url must be provided as argument or via FETCH_URL env var");
		}

		const latestJsonUrl = await getLatestJsonUrl(url);
		if (!latestJsonUrl) {
			throw new Error("Failed to get latest JSON URL");
		}

		console.log(`  [url=${latestJsonUrl}] Fetching JSON...`);

		const data = await fetchJson(latestJsonUrl, { timeoutMs: 8000 });

		let result = data;
		if (args?.info) {
			result = getByPath(data, args.info);
		}

		const truncated = truncateArrays(result, MAX_ARRAY_ITEMS);

		return {
			ok: true,
			result: truncated,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			ok: false,
			result: message,
		};
	}
}
