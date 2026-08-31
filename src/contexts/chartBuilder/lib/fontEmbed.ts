/** Font embedding for serialized chart SVG.
 *
 * The export pipeline rasterizes charts by loading serialized SVG through an
 * `<img>` — an isolated document that cannot fetch ANY external resource, so
 * the Google Fonts stylesheet the live page uses never applies and webfont
 * text silently draws in a fallback face (right metrics, wrong glyphs).
 * Downloaded SVGs have the same problem on machines without the font
 * installed. The fix: inline the needed faces as `@font-face` rules with
 * `data:` URI woff2 sources in a `<style>` inside the SVG itself.
 *
 * To keep the inlined payload small, faces are filtered three ways before
 * embedding: family (only Google-hosted families the SVG actually names —
 * built-in presets + user library fonts), weight/style (only faces the SVG's
 * font-weight/font-style values can select), and subset (only faces whose
 * unicode-range covers characters the SVG contains).
 *
 * Everything is best-effort: any failure returns the SVG unchanged — a
 * fallback-face export beats a failed one. */

import {
	parseFontFaceBlocks,
	unicodeRangeIntersects,
	type GoogleFontFace,
} from "../../../lib/googleFonts"
import { ensureFontBinary, getCachedFontBinary } from "./fontBinaries"
import { userFontFaces } from "./fontRegistration"
import { idbGet, idbSet } from "./storage/idb"

const SVG_NS = "http://www.w3.org/2000/svg"

/** Google-hosted families the app ships with (index.html's <link> — DM Sans,
 * DM Mono, Inter for chart text, Quicksand for UI chrome that leaks into
 * captures via computed styles). css2 URLs mirror index.html so the
 * stylesheet fetch hits the browser's HTTP cache. Keyed lowercase. */
const BUILTIN_WEBFONT_CSS: Record<string, string> = {
	"dm sans":
		"https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300..700;1,9..40,300..700&display=swap",
	"dm mono":
		"https://fonts.googleapis.com/css2?family=DM+Mono:ital,wght@0,300;0,400;0,500;1,300;1,400;1,500&display=swap",
	inter:
		"https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap",
	quicksand:
		"https://fonts.googleapis.com/css2?family=Quicksand:wght@300..700&display=swap",
}

// ---------------------------------------------------------------------------
// Usage collection (pure — exported for tests)
// ---------------------------------------------------------------------------

export type FontUsage = {
	/** Lowercased first-family → as-written casing (for the @font-face rule). */
	families: Map<string, string>
	/** Numeric font-weight values in use (400 always included — it's the
	 * default for text with no font-weight). */
	weights: Set<number>
	italic: boolean
	/** Codepoints of all text content. */
	codepoints: Set<number>
}

/** Decode the handful of entities XMLSerializer emits in text/attributes. */
const decodeEntities = (s: string): string =>
	s
		.replaceAll(/&#x([\dA-Fa-f]+);/g, (_, h) =>
			String.fromCodePoint(Number.parseInt(h, 16))
		)
		.replaceAll(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
		.replaceAll("&quot;", '"')
		.replaceAll("&apos;", "'")
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&amp;", "&")

const firstFamilyName = (stack: string): string =>
	stack.split(",")[0].trim().replaceAll(/^['"]|['"]$/g, "").trim()

const WEIGHT_KEYWORDS: Record<string, number> = { normal: 400, bold: 700 }

/** Scan serialized SVG markup for the font families, weights, styles, and
 * characters it uses. Regex over the decoded markup — our serializers write
 * font properties as attributes or inline styles, never via classes. */
export const collectFontUsage = (svgText: string): FontUsage => {
	const decoded = decodeEntities(svgText)
	const families = new Map<string, string>()
	const familyRe = /font-family\s*[:=]\s*("([^"]*)"|'([^']*)'|([^;"'>]+))/g
	let m: RegExpExecArray | null
	while ((m = familyRe.exec(decoded)) !== null) {
		const stack = (m[2] ?? m[3] ?? m[4] ?? "").trim()
		if (!stack) continue
		const first = firstFamilyName(stack)
		if (first && !families.has(first.toLowerCase())) {
			families.set(first.toLowerCase(), first)
		}
	}

	const weights = new Set<number>([400])
	const weightRe = /font-weight\s*[:=]\s*["']?([\w]+)/g
	while ((m = weightRe.exec(decoded)) !== null) {
		const w = WEIGHT_KEYWORDS[m[1]] ?? Number(m[1])
		if (Number.isFinite(w)) weights.add(w)
	}

	const italic = /font-style\s*[:=]\s*["']?italic/.test(decoded)

	const codepoints = new Set<number>()
	const textOnly = decodeEntities(svgText.replaceAll(/<[^>]*>/g, " "))
	for (const ch of textOnly) {
		const cp = ch.codePointAt(0)
		if (cp !== undefined && cp > 32) codepoints.add(cp)
	}

	return { families, weights, italic, codepoints }
}

// ---------------------------------------------------------------------------
// Face selection (pure — exported for tests)
// ---------------------------------------------------------------------------

const weightMatches = (faceWeight: string, used: ReadonlySet<number>): boolean => {
	const parts = faceWeight.trim().split(/\s+/).map(Number)
	if (parts.some((n) => !Number.isFinite(n))) return true
	if (parts.length === 2) {
		for (const w of used) if (w >= parts[0] && w <= parts[1]) return true
		return false
	}
	return used.has(parts[0])
}

/** Pick the faces worth inlining for one family. Weight/subset filtering is
 * a size optimization, never a correctness gate: when no face of a used
 * style matches the used weights exactly (e.g. text at 500 over a
 * 400/700-only family), every weight of that style is kept so the browser's
 * nearest-weight matching still has real faces to pick from. */
export const selectFaces = (
	faces: GoogleFontFace[],
	usage: Pick<FontUsage, "weights" | "italic" | "codepoints">
): GoogleFontFace[] => {
	const styles: Array<"normal" | "italic"> = usage.italic
		? ["normal", "italic"]
		: ["normal"]
	const out: GoogleFontFace[] = []
	for (const style of styles) {
		const ofStyle = faces.filter(
			(f) =>
				f.style === style &&
				unicodeRangeIntersects(f.unicodeRange, usage.codepoints)
		)
		const weightMatched = ofStyle.filter((f) =>
			weightMatches(f.weight, usage.weights)
		)
		out.push(...(weightMatched.length > 0 ? weightMatched : ofStyle))
	}
	return out
}

// ---------------------------------------------------------------------------
// Face metadata + binary IO
// ---------------------------------------------------------------------------

const KEY_FACES_PREFIX = "vis-components:fontFaces:"

/** Session cache of built-in families' parsed faces. */
const builtinFaces = new Map<string, Promise<GoogleFontFace[] | null>>()

const loadBuiltinFaces = (
	familyLower: string,
	allowNetwork: boolean
): Promise<GoogleFontFace[] | null> => {
	const cached = builtinFaces.get(familyLower)
	if (cached) return cached
	const task = (async (): Promise<GoogleFontFace[] | null> => {
		const stored = await idbGet<GoogleFontFace[]>(KEY_FACES_PREFIX + familyLower)
		if (stored && stored.length > 0) return stored
		if (!allowNetwork) return null
		const res = await fetch(BUILTIN_WEBFONT_CSS[familyLower])
		if (!res.ok) return null
		const faces = parseFontFaceBlocks(await res.text())
		if (faces.length === 0) return null
		await idbSet(KEY_FACES_PREFIX + familyLower, faces)
		return faces
	})()
	builtinFaces.set(familyLower, task)
	// Don't pin a null/failed lookup for the session — a later call with
	// network allowed should retry.
	void task.then(
		(faces) => {
			if (!faces) builtinFaces.delete(familyLower)
		},
		() => builtinFaces.delete(familyLower)
	)
	return task
}

const facesFor = async (
	familyLower: string,
	allowNetwork: boolean
): Promise<GoogleFontFace[] | null> => {
	const fromLibrary = userFontFaces(familyLower)
	if (fromLibrary) return fromLibrary
	if (familyLower in BUILTIN_WEBFONT_CSS) {
		try {
			return await loadBuiltinFaces(familyLower, allowNetwork)
		} catch {
			return null
		}
	}
	return null
}

const base64Cache = new Map<string, string>()

/** Base64-encode font bytes (exported for the embed-publish payload, which
 *  ships woff2 binaries the same way the SVG exporter inlines them). */
export const toBase64 = (bytes: ArrayBuffer): string => {
	const view = new Uint8Array(bytes)
	let binary = ""
	const CHUNK = 0x80_00
	for (let i = 0; i < view.length; i += CHUNK) {
		binary += String.fromCharCode(...view.subarray(i, i + CHUNK))
	}
	// btoa is the direct base64 encoder we need for building data URLs.
	// eslint-disable-next-line no-restricted-globals
	return btoa(binary)
}

const faceRule = async (
	familyName: string,
	face: GoogleFontFace,
	allowNetwork: boolean
): Promise<string | null> => {
	let b64 = base64Cache.get(face.url)
	if (!b64) {
		const bytes = allowNetwork
			? await ensureFontBinary(face.url).catch(() => null)
			: await getCachedFontBinary(face.url)
		if (!bytes) return null
		b64 = toBase64(bytes)
		base64Cache.set(face.url, b64)
	}
	const unicodeRange = face.unicodeRange
		? `unicode-range:${face.unicodeRange};`
		: ""
	return (
		`@font-face{font-family:'${familyName}';font-style:${face.style};` +
		`font-weight:${face.weight};${unicodeRange}` +
		`src:url(data:font/woff2;base64,${b64}) format('woff2');}`
	)
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** Inline the webfont faces a serialized chart SVG needs as data: URI
 * `@font-face` rules in a leading `<style>`. Families that aren't
 * Google-hosted (system stacks, Georgia, …) are untouched. With
 * `allowNetwork: false` (thumbnail captures) only already-cached faces
 * embed — never blocks an autosave on the network. Always resolves; on any
 * failure the original markup comes back. */
export const embedFontsInSvg = async (
	svgText: string,
	opts: { allowNetwork?: boolean } = {}
): Promise<string> => {
	const allowNetwork = opts.allowNetwork ?? true
	try {
		const usage = collectFontUsage(svgText)
		if (usage.families.size === 0) return svgText

		const rules: string[] = []
		for (const [lower, asWritten] of usage.families) {
			const faces = await facesFor(lower, allowNetwork)
			if (!faces) continue
			for (const face of selectFaces(faces, usage)) {
				const rule = await faceRule(asWritten, face, allowNetwork)
				if (rule) rules.push(rule)
			}
		}
		if (rules.length === 0) return svgText

		const doc = new DOMParser().parseFromString(svgText, "image/svg+xml")
		const root = doc.documentElement
		if (root.localName !== "svg") return svgText
		const style = doc.createElementNS(SVG_NS, "style")
		style.textContent = rules.join("\n")
		root.insertBefore(style, root.firstChild)
		return new XMLSerializer().serializeToString(root)
	} catch {
		return svgText
	}
}
