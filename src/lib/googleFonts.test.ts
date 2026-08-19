import { describe, expect, it } from "vitest"

import {
	downloadUrl,
	parseFontFaceBlocks,
	parseUnicodeRange,
	rangeDownloadUrl,
	unicodeRangeIntersects,
} from "./googleFonts"

// A trimmed real-shape css2 response: two subsets of a variable normal face
// plus one italic face.
const CSS2_FIXTURE = `
/* latin-ext */
@font-face {
  font-family: 'Roboto Slab';
  font-style: normal;
  font-weight: 100 900;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/robotoslab/v34/ext.woff2) format('woff2');
  unicode-range: U+0100-02BA, U+1E00-1EFF;
}
/* latin */
@font-face {
  font-family: 'Roboto Slab';
  font-style: normal;
  font-weight: 100 900;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/robotoslab/v34/lat.woff2) format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+2000-206F;
}
/* latin */
@font-face {
  font-family: 'Lora';
  font-style: italic;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/lora/v32/it.woff2) format('woff2');
  unicode-range: U+0000-00FF;
}
`

describe("parseFontFaceBlocks", () => {
	it("extracts style, weight, unicode-range, and url per block", () => {
		const faces = parseFontFaceBlocks(CSS2_FIXTURE)
		expect(faces).toHaveLength(3)
		expect(faces[0]).toEqual({
			style: "normal",
			weight: "100 900",
			unicodeRange: "U+0100-02BA, U+1E00-1EFF",
			url: "https://fonts.gstatic.com/s/robotoslab/v34/ext.woff2",
		})
		expect(faces[2].style).toBe("italic")
		expect(faces[2].weight).toBe("400")
	})

	it("returns empty for css without @font-face blocks", () => {
		expect(parseFontFaceBlocks("body { color: red; }")).toEqual([])
	})
})

describe("downloadUrl", () => {
	it("builds a wght-axis url when the family has no italic", () => {
		expect(downloadUrl("Roboto Slab", [400, 300], [])).toBe(
			"https://fonts.googleapis.com/css2?family=Roboto+Slab:wght@300;400"
		)
	})

	it("builds sorted ital,wght tuples when italics exist", () => {
		expect(downloadUrl("Lora", [700, 400], [400])).toBe(
			"https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,700;1,400"
		)
	})
})

describe("rangeDownloadUrl", () => {
	it("spans min..max, with paired italic ranges when italics exist", () => {
		expect(rangeDownloadUrl("Roboto Slab", [100, 400, 900], false)).toBe(
			"https://fonts.googleapis.com/css2?family=Roboto+Slab:wght@100..900"
		)
		expect(rangeDownloadUrl("Lora", [400, 700], true)).toBe(
			"https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400..700;1,400..700"
		)
	})

	it("returns null for a single weight (no range to request)", () => {
		expect(rangeDownloadUrl("Foo", [400], false)).toBeNull()
	})
})

describe("parseUnicodeRange", () => {
	it("parses singles, ranges, and wildcards", () => {
		expect(parseUnicodeRange("U+0000-00FF, U+0131, U+4??")).toEqual([
			{ start: 0, end: 0xff },
			{ start: 0x1_31, end: 0x1_31 },
			{ start: 0x4_00, end: 0x4_ff },
		])
	})
})

describe("unicodeRangeIntersects", () => {
	it("treats an empty descriptor as covering everything", () => {
		expect(unicodeRangeIntersects("", new Set([0x48]))).toBe(true)
	})

	it("matches codepoints inside a range and rejects ones outside", () => {
		const latin = "U+0000-00FF"
		expect(unicodeRangeIntersects(latin, new Set(["H".codePointAt(0)!]))).toBe(
			true
		)
		const cyrillic = "U+0400-045F"
		expect(
			unicodeRangeIntersects(cyrillic, new Set(["H".codePointAt(0)!]))
		).toBe(false)
	})
})
