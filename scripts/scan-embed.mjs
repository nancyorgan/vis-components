// Scan published embed pages against the public boundary:
//   node scripts/scan-embed.mjs <url | file | publish dir> [...]
//
// A published page is on the public internet, so it may hold only the fields
// on the public lists in server/src/publicEmbed.ts. For each page this prints
// the fields its payload holds, checks them with the same validator the
// publish route runs, and looks for anything shaped like an email address or
// a library id. Exits 1 when any page fails. A directory is walked for the
// embed pages under it (index.html / chart.html / legend.html).
//
// Needs the server build (`pnpm exec tsc -p server`) for the validator.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const built = join(root, "server", "dist", "publicEmbed.js")
if (!existsSync(built)) {
	console.error("Build the server first: pnpm exec tsc -p server")
	process.exit(2)
}
const { validatePublicPayload } = await import(pathToFileURL(built).href)

const PAGE_NAMES = new Set(["index.html", "chart.html", "legend.html"])
const OPENER = '<script type="application/json" id="embed-payload">'
// Library ids look like "fl-mvih76ya-hq0m6t" (folder), "th-…", "dv-…", "ds-…".
const LIBRARY_ID = /"(?:fl|th|dv|ds|vis|ei)-[a-z0-9]{6,}-[a-z0-9]{4,}"/g
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g

const pagesUnder = (dir) =>
	readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name)
		if (entry.isDirectory()) return pagesUnder(path)
		return PAGE_NAMES.has(entry.name) ? [path] : []
	})

const read = async (target) => {
	if (/^https?:\/\//.test(target)) {
		const response = await fetch(target)
		if (!response.ok) throw new Error(`HTTP ${response.status}`)
		return response.text()
	}
	return readFileSync(target, "utf-8")
}

const keys = (value) =>
	value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value) : []

const scan = async (target) => {
	const html = await read(target)
	const start = html.indexOf(OPENER)
	const end = start === -1 ? -1 : html.indexOf("</script>", start)
	if (end === -1) return { problems: ["no payload in the page"] }
	const text = html.slice(start + OPENER.length, end)
	const { payload } = JSON.parse(text)
	const problems = []
	const invalid = validatePublicPayload(payload)
	if (invalid) problems.push(invalid)
	// Rows are the chart's own data and font binaries are base64: both can
	// hold an "@" that is no one's address, so they are left out of the search.
	const searched = JSON.stringify({
		...payload,
		fonts: undefined,
		zctaTopology: undefined,
		dataset: payload?.dataset && {
			...payload.dataset,
			versions: (payload.dataset.versions ?? []).map((v) => ({ ...v, rows: undefined })),
		},
	})
	for (const [label, pattern] of [
		["email address", EMAIL],
		["library id", LIBRARY_ID],
	]) {
		const found = [...new Set(searched.match(pattern) ?? [])]
		if (found.length > 0) problems.push(`${label}: ${found.slice(0, 5).join(", ")}`)
	}
	const version = payload?.dataset?.versions?.[0]
	return {
		problems,
		inlineApp: /<script type="module"[^>]*>[^<]/.test(html),
		bytes: Buffer.byteLength(html),
		fields: {
			payload: keys(payload),
			visual: keys(payload?.visual),
			ids: {
				visual: payload?.visual?.id,
				datasetId: payload?.visual?.datasetId,
				themeId: payload?.visual?.themeId,
				dataset: payload?.dataset?.id,
				version: version?.id,
				theme: payload?.theme?.id,
			},
			dataset: keys(payload?.dataset),
			version: keys(version),
			columns: (payload?.dataset?.fields ?? []).map((f) => keys(f).join("+")),
			themeFieldCount: keys(payload?.theme).length,
			fonts: (payload?.fonts ?? []).map((f) => keys(f).join("+")),
		},
	}
}

const targets = process.argv.slice(2).flatMap((target) =>
	!/^https?:\/\//.test(target) && statSync(target).isDirectory() ? pagesUnder(target) : [target]
)
if (targets.length === 0) {
	console.error("Usage: node scripts/scan-embed.mjs <url | file | publish dir> [...]")
	process.exit(2)
}
let failed = 0
for (const target of targets) {
	let result
	try {
		result = await scan(target)
	} catch (error) {
		result = { problems: [String(error)] }
	}
	const ok = result.problems.length === 0
	if (!ok) failed += 1
	console.log(`${ok ? "PUBLIC ONLY" : "NOT PUBLIC "}  ${target}`)
	for (const problem of result.problems) console.log(`    problem: ${problem}`)
	if (result.fields) {
		console.log(`    page: ${result.bytes} bytes, app ${result.inlineApp ? "INLINE" : "shared (runtime/)"}`)
		console.log(`    ${JSON.stringify(result.fields)}`)
	}
}
console.log(`${targets.length - failed} of ${targets.length} pages hold only public fields`)
process.exit(failed === 0 ? 0 : 1)
