/** Server configuration, read entirely from environment variables.
 *
 *  All four variables are required and validated up front: a misconfigured
 *  deployment must die at startup with a clear reason, never limp along
 *  writing data to a default path nobody chose. */

export type ServerConfig = {
	/** Absolute origin the app is reached at (behind any proxies). Used for
	 *  outward-facing links (embeds/shares); never derived from requests. */
	baseUrl: string
	/** Directory holding the SQLite database and its WAL sidecars. */
	dbDir: string
	/** Directory holding one gzipped JSON file per dataset. */
	dataDir: string
	/** TCP port to listen on. Plain HTTP; TLS is the infrastructure's job. */
	port: number
}

const REQUIRED = [
	[
		"VIS_BASE_URL",
		"absolute origin the app is reached at, e.g. https://charts.example.com",
	],
	["VIS_DB_DIR", "directory for the SQLite database"],
	["VIS_DATA_DIR", "directory for dataset files"],
	["VIS_PORT", "TCP port to listen on"],
] as const

/** Read and validate the configuration. Throws one Error whose message has a
 *  one-line reason per problem (all problems reported at once, not just the
 *  first). */
export const loadConfig = (
	env: Record<string, string | undefined>
): ServerConfig => {
	const problems: string[] = []
	for (const [name, meaning] of REQUIRED) {
		if (!env[name]?.trim()) problems.push(`${name} is required — ${meaning}`)
	}

	let port = 0
	const rawPort = env.VIS_PORT?.trim()
	if (rawPort) {
		port = Number(rawPort)
		if (!Number.isInteger(port) || port < 1 || port > 65535) {
			problems.push(`VIS_PORT must be an integer in 1–65535, got "${rawPort}"`)
		}
	}

	let baseUrl = env.VIS_BASE_URL?.trim() ?? ""
	if (baseUrl) {
		let parsed: URL | null = null
		try {
			parsed = new URL(baseUrl)
		} catch {
			problems.push(`VIS_BASE_URL must be an absolute URL, got "${baseUrl}"`)
		}
		if (parsed && parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			problems.push(`VIS_BASE_URL must be http(s), got "${baseUrl}"`)
		}
		baseUrl = baseUrl.replace(/\/+$/, "")
	}

	if (problems.length > 0) throw new Error(problems.join("\n"))
	return {
		baseUrl,
		dbDir: (env.VIS_DB_DIR ?? "").trim(),
		dataDir: (env.VIS_DATA_DIR ?? "").trim(),
		port,
	}
}
