import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import type { ChannelConfigs } from "./channelConfig"
import {
	CUSTOM_PATTERN_BASE,
	CUSTOM_PATTERN_SVG_MAX_CHARS,
	CustomPatternsContext,
	customPatternPath,
	insertCustomPattern,
	isCustomPattern,
	pixelsToInk,
	removeCustomPattern,
	resolveCustomPattern,
	type CustomPattern,
} from "./customPatterns"
import { PatternTile, patternTileSide } from "./patternDefs"

/** RGBA pixels from a predicate: `ink(x, y)` → black, else white. */
const pixels = (
	w: number,
	h: number,
	color: (x: number, y: number) => [number, number, number, number]
) => {
	const data = new Uint8ClampedArray(w * h * 4)
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++) data.set(color(x, y), (y * w + x) * 4)
	return data
}
const BLACK: [number, number, number, number] = [0, 0, 0, 255]
const WHITE: [number, number, number, number] = [255, 255, 255, 255]

describe("pixelsToInk", () => {
	it("maps black to full ink and white to none", () => {
		const ink = pixelsToInk(
			pixels(4, 1, (x) => (x < 2 ? BLACK : WHITE)),
			4,
			1
		)
		expect([...ink]).toEqual([255, 255, 0, 0])
	})

	it("keeps mid-gray edges as partial ink (antialiasing)", () => {
		const ink = pixelsToInk(
			pixels(3, 1, (x) => (x === 0 ? BLACK : x === 1 ? [128, 128, 128, 255] : WHITE)),
			3,
			1
		)
		expect(ink[1]).toBeGreaterThan(80)
		expect(ink[1]).toBeLessThan(175)
	})

	it("levels JPEG noise and off-white paper to clean ink / background", () => {
		const ink = pixelsToInk(
			pixels(2, 1, (x) => (x === 0 ? [30, 34, 28, 255] : [240, 236, 244, 255])),
			2,
			1
		)
		expect([...ink]).toEqual([255, 0])
	})

	it("treats transparent pixels as background", () => {
		const ink = pixelsToInk(
			pixels(2, 1, (x) => (x === 0 ? BLACK : [0, 0, 0, 0])),
			2,
			1
		)
		expect([...ink]).toEqual([255, 0])
	})

	it("rejects color images", () => {
		expect(() =>
			pixelsToInk(pixels(4, 1, (x) => (x < 2 ? [220, 30, 30, 255] : WHITE)), 4, 1)
		).toThrow(/black-and-white/)
	})

	it("rejects a solid image", () => {
		expect(() => pixelsToInk(pixels(4, 1, () => WHITE), 4, 1)).toThrow(/solid/)
	})
})

describe("customPatternPath", () => {
	it("merges horizontal ink runs into one rect each", () => {
		const p: CustomPattern = { size: 3, bits: "110" + "000" + "011" }
		expect(customPatternPath(p)).toBe("M0,0h2v1h-2zM1,2h2v1h-2z")
	})
})

describe("isCustomPattern", () => {
	it("checks size and bit string", () => {
		expect(isCustomPattern({ size: 2, bits: "1001" })).toBe(true)
		expect(isCustomPattern({ size: 2, bits: "101" })).toBe(false)
		expect(isCustomPattern({ size: 2, bits: "10a1" })).toBe(false)
		expect(isCustomPattern({ mask: "data:image/png;base64,AAAA" })).toBe(true)
		expect(isCustomPattern({ mask: "https://example.com/x.png" })).toBe(false)
		expect(isCustomPattern({ svg: "data:image/svg+xml;base64,PHN2Zy8+" })).toBe(true)
		expect(isCustomPattern({ svg: "data:image/png;base64,AAAA" })).toBe(false)
		expect(isCustomPattern({ svg: "https://example.com/x.svg" })).toBe(false)
		expect(
			isCustomPattern({
				svg: "data:image/svg+xml;base64," + "A".repeat(CUSTOM_PATTERN_SVG_MAX_CHARS),
			})
		).toBe(false)
		expect(isCustomPattern(null)).toBe(false)
	})
})

describe("insert / remove", () => {
	const a: CustomPattern = { size: 2, bits: "1000" }
	const b: CustomPattern = { size: 2, bits: "0100" }

	it("reuses the first tombstoned slot, else appends", () => {
		expect(insertCustomPattern(undefined, a)).toEqual({
			list: [a],
			idx: CUSTOM_PATTERN_BASE,
		})
		expect(insertCustomPattern([a, null], b)).toEqual({
			list: [a, b],
			idx: CUSTOM_PATTERN_BASE + 1,
		})
	})

	it("tombstones the slot and drops every pick that pointed at it", () => {
		const idx = CUSTOM_PATTERN_BASE + 1
		const configs = {
			defaultPattern: idx,
			pattern: {
				overrides: { x: idx, y: 2 },
				polygonOverrides: { x: idx },
				defaultViolinPattern: idx,
				customPatterns: [a, b],
			},
		} as unknown as ChannelConfigs
		const next = removeCustomPattern(configs, 1)
		expect(next.defaultPattern).toBeNull()
		expect(next.pattern?.customPatterns).toEqual([a, null])
		expect(next.pattern?.overrides).toEqual({ y: 2 })
		expect(next.pattern?.polygonOverrides).toEqual({})
		expect(next.pattern?.defaultViolinPattern).toBeNull()
		expect(resolveCustomPattern(idx, next.pattern?.customPatterns)).toBeNull()
		expect(resolveCustomPattern(CUSTOM_PATTERN_BASE, next.pattern?.customPatterns)).toBe(a)
	})
})

describe("PatternTile with a custom pattern", () => {
	const p: CustomPattern = { size: 10, bits: "1".repeat(10) + "0".repeat(90) }

	it("draws the grid's ink cells in the ink color over the background", () => {
		const html = renderToStaticMarkup(
			<svg>
				<CustomPatternsContext.Provider value={[p]}>
					<PatternTile
						id="t"
						paletteIdx={CUSTOM_PATTERN_BASE}
						bgColor="#ffeecc"
						inkColor="#112233"
						scale={2}
					/>
				</CustomPatternsContext.Provider>
			</svg>
		)
		expect(html).toContain('width="64"')
		expect(html).toContain('fill="#ffeecc"')
		expect(html).toContain('d="M0,0h10v1h-10z"')
		expect(html).toContain('transform="scale(6.4)"')
		expect(html).toContain('fill="#112233"')
		expect(patternTileSide(CUSTOM_PATTERN_BASE, 2)).toBe(64)
	})

	it("paints a mask pattern's ink through its grayscale mask", () => {
		const mask = "data:image/png;base64,AAAA"
		const html = renderToStaticMarkup(
			<svg>
				<CustomPatternsContext.Provider value={[{ mask }]}>
					<PatternTile
						id="m"
						paletteIdx={CUSTOM_PATTERN_BASE}
						bgColor="#ffeecc"
						inkColor="#112233"
					/>
				</CustomPatternsContext.Provider>
			</svg>
		)
		expect(html).toContain('<mask id="m-mask"')
		expect(html).toContain(`href="${mask}"`)
		expect(html).toContain('fill="#112233" mask="url(#m-mask)"')
		expect(html).toContain('width="32"')
	})

	it("paints an SVG pattern through an inverted vector mask", () => {
		const svg = "data:image/svg+xml;base64,PHN2Zy8+"
		const html = renderToStaticMarkup(
			<svg>
				<CustomPatternsContext.Provider value={[{ svg }]}>
					<PatternTile
						id="v"
						paletteIdx={CUSTOM_PATTERN_BASE}
						bgColor="#ffeecc"
						inkColor="#112233"
						scale={2}
					/>
				</CustomPatternsContext.Provider>
			</svg>
		)
		// The upload itself is the mask image — no rasterized copy.
		expect(html).toContain(`href="${svg}"`)
		expect(html).toContain('filter="url(#v-invert)"')
		expect(html).toContain('<filter id="v-invert"')
		expect(html).toContain('color-interpolation-filters="sRGB"')
		expect(html).toContain("<feColorMatrix")
		expect(html).toContain('<mask id="v-mask"')
		expect(html).toContain('fill="#112233" mask="url(#v-mask)"')
		expect(html).toContain('width="64"')
	})

	it("does not emit the invert filter for a raster mask", () => {
		const html = renderToStaticMarkup(
			<svg>
				<CustomPatternsContext.Provider value={[{ mask: "data:image/png;base64,AAAA" }]}>
					<PatternTile id="m" paletteIdx={CUSTOM_PATTERN_BASE} bgColor="#fff" inkColor="#000" />
				</CustomPatternsContext.Provider>
			</svg>
		)
		expect(html).not.toContain("<filter")
		expect(html).not.toContain("filter=")
	})

	it("falls back to the first built-in pattern for a missing slot", () => {
		const html = renderToStaticMarkup(
			<svg>
				<PatternTile
					id="t"
					paletteIdx={CUSTOM_PATTERN_BASE + 3}
					bgColor="#fff"
					inkColor="#000"
				/>
			</svg>
		)
		expect(html).toContain("<circle")
	})
})
