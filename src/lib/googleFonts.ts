/**
 * Google Fonts client — discovery, CSS parsing, and binary fetching for the
 * user font library. Talks only to the CORS-open endpoints:
 *
 *   - https://fonts.googleapis.com/css2  (stylesheets; `access-control-allow-origin: *`)
 *   - https://fonts.gstatic.com          (woff2 binaries; CORS-open)
 *
 * The fonts.google.com metadata API is NOT browser-fetchable (no CORS
 * headers), so available weights are discovered by probing css2 with one
 * request per canonical weight — css2 rejects a request for a weight the
 * family doesn't support, and for variable fonts every weight inside the
 * axis range succeeds, so probing works uniformly for both.
 */

const CSS2_BASE = "https://fonts.googleapis.com/css2"

export const CANONICAL_WEIGHTS = [
	100, 200, 300, 400, 500, 600, 700, 800, 900,
] as const

/** One @font-face the css2 stylesheet declared: a single subset (latin,
 * cyrillic, …) of one style at one weight (or a variable-weight range). */
export type GoogleFontFace = {
	style: "normal" | "italic"
	/** css2 `font-weight` descriptor — "400" or a variable range "300 700". */
	weight: string
	/** css2 `unicode-range` descriptor for this subset. */
	unicodeRange: string
	/** woff2 URL on fonts.gstatic.com. */
	url: string
}

/** Everything discovered about one added Google Font. Faces are metadata
 * only — binaries cache separately (IndexedDB) keyed by face URL. */
export type GoogleFontDescriptor = {
	/** Canonical family name as css2 accepted it, e.g. "Roboto Slab". */
	family: string
	/** Discrete weights the family supports (what Weight pickers offer). */
	weights: number[]
	hasItalic: boolean
	faces: GoogleFontFace[]
}

const familyParam = (family: string): string =>
	family.trim().replaceAll(/\s+/g, "+")

/** css2 URL requesting one specific (style, weight) tuple — the probe shape. */
const probeUrl = (family: string, weight: number, italic: boolean): string =>
	italic
		? `${CSS2_BASE}?family=${familyParam(family)}:ital,wght@1,${weight}`
		: `${CSS2_BASE}?family=${familyParam(family)}:wght@${weight}`

/** css2 URL requesting the weight span as a variable range. Only valid for
 * variable fonts (css2 rejects ranges on static families) — callers try
 * this first and fall back to `downloadUrl`. Worth it because a range
 * request returns ONE variable file per subset where discrete tuples return
 * a static instance file per weight. */
export const rangeDownloadUrl = (
	family: string,
	weights: number[],
	hasItalic: boolean
): string | null => {
	const min = Math.min(...weights)
	const max = Math.max(...weights)
	if (!Number.isFinite(min) || min === max) return null
	const range = `${min}..${max}`
	return hasItalic
		? `${CSS2_BASE}?family=${familyParam(family)}:ital,wght@0,${range};1,${range}`
		: `${CSS2_BASE}?family=${familyParam(family)}:wght@${range}`
}

/** css2 URL requesting every supported tuple at once — the download shape.
 * Tuple lists must be sorted (italic axis first, then weight) or css2 400s. */
export const downloadUrl = (
	family: string,
	weights: number[],
	italicWeights: number[]
): string => {
	const sorted = [...weights].sort((a, b) => a - b)
	if (italicWeights.length === 0) {
		return `${CSS2_BASE}?family=${familyParam(family)}:wght@${sorted.join(";")}`
	}
	const italSorted = [...italicWeights].sort((a, b) => a - b)
	const tuples = [
		...sorted.map((w) => `0,${w}`),
		...italSorted.map((w) => `1,${w}`),
	]
	return `${CSS2_BASE}?family=${familyParam(family)}:ital,wght@${tuples.join(";")}`
}

const fetchOk = async (url: string): Promise<boolean> => {
	try {
		const res = await fetch(url)
		return res.ok
	} catch {
		return false
	}
}

/** Parse a css2 stylesheet into its @font-face declarations. Exported for
 * tests. Tolerates the per-subset comments css2 emits ("latin",
 * "cyrillic-ext", …) but doesn't rely on them — everything comes from the
 * declaration bodies. */
export const parseFontFaceBlocks = (cssText: string): GoogleFontFace[] => {
	const faces: GoogleFontFace[] = []
	const blockRe = /@font-face\s*{([^}]*)}/g
	let m: RegExpExecArray | null
	while ((m = blockRe.exec(cssText)) !== null) {
		const body = m[1]
		const prop = (name: string): string | null => {
			const pm = new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(body)
			return pm ? pm[1].trim() : null
		}
		const src = prop("src")
		const urlMatch = src ? /url\(([^)]+)\)/.exec(src) : null
		if (!urlMatch) continue
		const style = prop("font-style") === "italic" ? "italic" : "normal"
		const weight = prop("font-weight") ?? "400"
		// A missing unicode-range means "everything" — leave it empty and let
		// consumers treat that as always-included.
		const unicodeRange = prop("unicode-range") ?? ""
		faces.push({
			style,
			weight,
			unicodeRange,
			url: urlMatch[1].replaceAll(/["']/g, ""),
		})
	}
	return faces
}

/** Title-case a typed family name the way most Google families are cased
 * ("roboto slab" → "Roboto Slab"). Used as a retry candidate only; exact
 * input is always tried first so names like "IBM Plex Sans" pass through. */
const titleCased = (name: string): string =>
	name
		.trim()
		.split(/\s+/)
		.map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
		.join(" ")

/** Probe css2 for the weights one family candidate actually supports.
 * Returns null when no weight resolves (family unknown under this name). */
const probeWeights = async (family: string): Promise<number[] | null> => {
	const results = await Promise.all(
		CANONICAL_WEIGHTS.map(async (w) => ({
			weight: w,
			ok: await fetchOk(probeUrl(family, w, false)),
		}))
	)
	const weights = results.filter((r) => r.ok).map((r) => r.weight)
	return weights.length > 0 ? weights : null
}

export class GoogleFontLookupError extends Error {}

/** Discover a Google Font by (user-typed) family name: confirm it exists,
 * probe its supported weights + italic availability, then fetch and parse
 * the full css2 stylesheet into face metadata. Throws GoogleFontLookupError
 * with a user-facing message when the family can't be resolved. */
export const lookupGoogleFont = async (
	typedName: string
): Promise<GoogleFontDescriptor> => {
	const trimmed = typedName.trim()
	if (!trimmed) throw new GoogleFontLookupError("Enter a font name.")

	// Try the name as typed, then a title-cased variant — css2 family names
	// are case-sensitive and most are title-cased.
	const candidates = [...new Set([trimmed, titleCased(trimmed)])]
	let family: string | null = null
	let weights: number[] | null = null
	for (const candidate of candidates) {
		weights = await probeWeights(candidate)
		if (weights) {
			family = candidate
			break
		}
	}
	if (!family || !weights) {
		throw new GoogleFontLookupError(
			`Couldn't find "${trimmed}" on Google Fonts. Check the exact name at fonts.google.com — or check your network connection.`
		)
	}

	// Italic availability can vary by weight (rarely) — probe each supported
	// weight's italic tuple so the download request never over-asks.
	const italicResults = await Promise.all(
		weights.map(async (w) => ({
			weight: w,
			ok: await fetchOk(probeUrl(family, w, true)),
		}))
	)
	const italicWeights = italicResults.filter((r) => r.ok).map((r) => r.weight)

	// Variable fonts: one range request → one variable file per subset.
	// Static fonts reject the range form; fall back to discrete tuples.
	// Italic range only when italics cover every weight (partial-italic
	// families would 400 the paired range).
	const sameItalics =
		italicWeights.length === weights.length && italicWeights.length > 0
	const rangeUrl = rangeDownloadUrl(family, weights, sameItalics)
	let cssRes =
		rangeUrl && (italicWeights.length === 0 || sameItalics)
			? await fetch(rangeUrl)
			: null
	if (!cssRes || !cssRes.ok) {
		cssRes = await fetch(downloadUrl(family, weights, italicWeights))
	}
	if (!cssRes.ok) {
		throw new GoogleFontLookupError(
			`Google Fonts rejected the stylesheet request for "${family}" (HTTP ${cssRes.status}).`
		)
	}
	const faces = parseFontFaceBlocks(await cssRes.text())
	if (faces.length === 0) {
		throw new GoogleFontLookupError(
			`Google Fonts returned no usable font files for "${family}".`
		)
	}
	return { family, weights, hasItalic: italicWeights.length > 0, faces }
}

/** Fetch one face's woff2 binary. */
export const fetchFontBinary = async (url: string): Promise<ArrayBuffer> => {
	const res = await fetch(url)
	if (!res.ok) {
		throw new Error(`Font file download failed (HTTP ${res.status}): ${url}`)
	}
	return res.arrayBuffer()
}

// ---------------------------------------------------------------------------
// unicode-range helpers — used to filter subset faces down to the characters
// a serialized chart actually contains before inlining font data.
// ---------------------------------------------------------------------------

type CodepointRange = { start: number; end: number }

/** Parse a css `unicode-range` descriptor ("U+0-FF, U+131, U+1E00-1EFF",
 * wildcards like "U+4??") into numeric ranges. Exported for tests. */
export const parseUnicodeRange = (descriptor: string): CodepointRange[] => {
	const ranges: CodepointRange[] = []
	for (const part of descriptor.split(",")) {
		const token = part.trim().toUpperCase()
		if (!token.startsWith("U+")) continue
		const body = token.slice(2)
		if (body.includes("?")) {
			const start = Number.parseInt(body.replaceAll("?", "0"), 16)
			const end = Number.parseInt(body.replaceAll("?", "F"), 16)
			if (!Number.isNaN(start) && !Number.isNaN(end)) {
				ranges.push({ start, end })
			}
		} else if (body.includes("-")) {
			const [s, e] = body.split("-")
			const start = Number.parseInt(s, 16)
			const end = Number.parseInt(e, 16)
			if (!Number.isNaN(start) && !Number.isNaN(end)) {
				ranges.push({ start, end })
			}
		} else {
			const cp = Number.parseInt(body, 16)
			if (!Number.isNaN(cp)) ranges.push({ start: cp, end: cp })
		}
	}
	return ranges
}

/** True when any of the given codepoints falls inside the face's
 * unicode-range (an empty/absent range means the face covers everything). */
export const unicodeRangeIntersects = (
	descriptor: string,
	codepoints: ReadonlySet<number>
): boolean => {
	if (!descriptor.trim()) return true
	const ranges = parseUnicodeRange(descriptor)
	if (ranges.length === 0) return true
	for (const cp of codepoints) {
		for (const r of ranges) {
			if (cp >= r.start && cp <= r.end) return true
		}
	}
	return false
}
