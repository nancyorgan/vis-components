/** Boot-time detection of server mode.
 *
 *  One build artifact runs both ways: served by the self-host server (which
 *  answers GET /api/config) or as plain static files / file:// (which don't).
 *  The probe is strict — a static host's SPA fallback answers every path with
 *  index.html and HTTP 200, so a 200 alone proves nothing. The response must
 *  be declared JSON *and* parse to the exact config shape. Anything else,
 *  including timeouts and network errors, means local mode. */

export type ServerModeConfig = {
	v: 1
	baseUrl: string
}

const PROBE_TIMEOUT_MS = 3000

/** Validate an /api/config payload. Exported for tests. */
export const parseServerModeConfig = (value: unknown): ServerModeConfig | null => {
	if (typeof value !== "object" || value === null) return null
	const record = value as Record<string, unknown>
	if (record.v !== 1) return null
	if (typeof record.baseUrl !== "string") return null
	return { v: 1, baseUrl: record.baseUrl }
}

/** Probe the origin the app was loaded from. Resolves to the server config
 *  in server mode, null in every other circumstance — this must never throw
 *  or hang, since first paint waits on it. */
export const probeServerMode = async (): Promise<ServerModeConfig | null> => {
	if (typeof window === "undefined") return null
	// file:// (the shareable single-file build) has no origin to probe.
	if (window.location.protocol === "file:") return null
	try {
		const response = await fetch("/api/config", {
			signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
		})
		if (!response.ok) return null
		const contentType = response.headers.get("content-type") ?? ""
		if (!contentType.includes("application/json")) return null
		return parseServerModeConfig(await response.json())
	} catch {
		return null
	}
}
