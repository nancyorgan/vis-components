import { describe, expect, it } from "vitest"

import type { GoogleFontFace } from "../../../lib/googleFonts"
import { collectFontUsage, embedFontsInSvg, selectFaces } from "./fontEmbed"

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50">
	<text font-family="'Roboto Slab', Georgia, serif" font-weight="600">Hello</text>
	<text style="font-family: &quot;DM Sans&quot;, ui-sans-serif, sans-serif; font-style: italic">Ciao</text>
	<text font-family="system-ui, sans-serif">Plain</text>
</svg>`

describe("collectFontUsage", () => {
	it("collects first-family names (deduped, case-keyed), weights, style, chars", () => {
		const usage = collectFontUsage(SVG)
		expect([...usage.families.entries()]).toEqual([
			["roboto slab", "Roboto Slab"],
			["dm sans", "DM Sans"],
			["system-ui", "system-ui"],
		])
		// 400 is always present (the default weight of unattributed text).
		expect([...usage.weights].sort((a, b) => a - b)).toEqual([400, 600])
		expect(usage.italic).toBe(true)
		expect(usage.codepoints.has("H".codePointAt(0)!)).toBe(true)
		expect(usage.codepoints.has("<".codePointAt(0)!)).toBe(false)
	})

	it("reads bold/normal keywords as 700/400", () => {
		const usage = collectFontUsage(
			`<svg><text font-family="'Lora', serif" font-weight="bold">x</text></svg>`
		)
		expect(usage.weights.has(700)).toBe(true)
	})
})

const face = (
	style: "normal" | "italic",
	weight: string,
	unicodeRange: string,
	url: string
): GoogleFontFace => ({ style, weight, unicodeRange, url })

const LATIN = "U+0000-00FF"
const CYRILLIC = "U+0400-045F"
const latinChars = new Set(["H".codePointAt(0)!])

describe("selectFaces", () => {
	const faces = [
		face("normal", "400", LATIN, "n400-lat"),
		face("normal", "700", LATIN, "n700-lat"),
		face("normal", "400", CYRILLIC, "n400-cyr"),
		face("italic", "400", LATIN, "i400-lat"),
	]

	it("filters to used style, weight, and subsets", () => {
		const out = selectFaces(faces, {
			weights: new Set([400]),
			italic: false,
			codepoints: latinChars,
		})
		expect(out.map((f) => f.url)).toEqual(["n400-lat"])
	})

	it("includes italic faces only when italic is used", () => {
		const out = selectFaces(faces, {
			weights: new Set([400]),
			italic: true,
			codepoints: latinChars,
		})
		expect(out.map((f) => f.url)).toEqual(["n400-lat", "i400-lat"])
	})

	it("keeps every weight of a style when no face matches the used weights", () => {
		// Text at 500 over a 400/700-only family: browser nearest-weight
		// matching needs real faces, so weight filtering must not drop them all.
		const out = selectFaces(faces, {
			weights: new Set([500]),
			italic: false,
			codepoints: latinChars,
		})
		expect(out.map((f) => f.url)).toEqual(["n400-lat", "n700-lat"])
	})

	it("matches variable weight ranges against used weights", () => {
		const variable = [face("normal", "100 900", LATIN, "var-lat")]
		const out = selectFaces(variable, {
			weights: new Set([550]),
			italic: false,
			codepoints: latinChars,
		})
		expect(out.map((f) => f.url)).toEqual(["var-lat"])
	})
})

describe("embedFontsInSvg", () => {
	it("returns the markup unchanged when nothing embeddable is used", async () => {
		const svg = `<svg xmlns="http://www.w3.org/2000/svg"><text font-family="system-ui, sans-serif">x</text></svg>`
		expect(await embedFontsInSvg(svg, { allowNetwork: false })).toBe(svg)
	})

	it("returns the markup unchanged when faces aren't cached and network is off", async () => {
		expect(await embedFontsInSvg(SVG, { allowNetwork: false })).toBe(SVG)
	})
})
