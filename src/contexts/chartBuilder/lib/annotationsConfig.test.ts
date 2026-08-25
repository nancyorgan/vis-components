import { describe, expect, it } from "vitest"

import {
	DEFAULT_ANNOTATIONS_CONFIG,
	DEFAULT_BOX_ANNOTATION_STYLE,
	DEFAULT_LINE_ANNOTATION_STYLE,
	DEFAULT_RECTANGLE_TEXT,
	DEFAULT_TEXT_ANNOTATION_STYLE,
	newCircle,
	newLineSegment,
	newRectangle,
	newTextAnnotation,
} from "./annotationsConfig"

/** themeConfig.test.ts already pins the theme→style builders and how
 *  `newRectangle` / `newCircle` / `newLineSegment` absorb them. What's left
 *  untested is the TEXT annotation factory (the one added last), plus the
 *  invariants the four factories share: absent-means-all-facets, percent
 *  geometry that actually lands inside the plot rect, and independence from
 *  the module-level seed constants. */

const ALL_FACTORIES = [
	["rectangle", () => newRectangle("r1")],
	["circle", () => newCircle("c1")],
	["line segment", () => newLineSegment("l1")],
	["text", () => newTextAnnotation("t1")],
] as const

describe("newTextAnnotation", () => {
	it("seeds an invisible box so the annotation reads as plain text first", () => {
		const t = newTextAnnotation("t1")
		// A text annotation is text FIRST: it must arrive with a transparent
		// background and border, which the user (or the theme) dials in.
		expect(t.backgroundOpacity).toBe(0)
		expect(t.borderOpacity).toBe(0)
		// Its own seed, NOT the shared box seed — those two overlap on every
		// fill/border key and disagree on the values.
		expect(t.backgroundColor).toBe(DEFAULT_TEXT_ANNOTATION_STYLE.backgroundColor)
		expect(t.backgroundColor).not.toBe(
			DEFAULT_BOX_ANNOTATION_STYLE.backgroundColor
		)
		expect(t.cornerRadius).toBe(DEFAULT_TEXT_ANNOTATION_STYLE.cornerRadius)
	})

	it("draws in FRONT of the marks, unlike the shaded box annotations", () => {
		expect(newTextAnnotation("t1").zOrder).toBe("front")
		// The contrast is deliberate: a rectangle/circle seeds as a background
		// band, a text label as a callout over the data.
		expect(newRectangle("r1").zOrder).toBe("behind")
		expect(newCircle("c1").zOrder).toBe("behind")
	})

	it("starts with empty text and an empty name (both are placeholder prompts)", () => {
		const t = newTextAnnotation("t1")
		expect(t.text).toBe("")
		expect(t.name).toBe("")
		// The text styling comes from the SHARED rectangle-text seed, so the box
		// editor and the text editor can't drift apart.
		expect(t.textFontFamily).toBe(DEFAULT_RECTANGLE_TEXT.textFontFamily)
		expect(t.textFontSize).toBe(DEFAULT_RECTANGLE_TEXT.textFontSize)
		expect(t.textAlign).toBe(DEFAULT_RECTANGLE_TEXT.textAlign)
		expect(t.textPadding).toBe(DEFAULT_RECTANGLE_TEXT.textPadding)
	})

	it("lets a theme style override the box AND the font, keeping the anchor", () => {
		const t = newTextAnnotation("t1", {
			...DEFAULT_TEXT_ANNOTATION_STYLE,
			backgroundColor: "#111827",
			backgroundOpacity: 0.8,
			borderOpacity: 1,
			cornerRadius: 0,
			textFontFamily: "Inter, sans-serif",
			textFontSize: 22,
			textColor: "#f9fafb",
			textFontWeight: 700,
			textAlign: "right",
			textPadding: 14,
		})
		expect(t.backgroundOpacity).toBe(0.8)
		expect(t.cornerRadius).toBe(0)
		expect(t.textFontWeight).toBe(700)
		expect(t.textAlign).toBe("right")
		// Non-style fields are the factory's, not the style's.
		expect(t.id).toBe("t1")
		expect(t.x).toBe(0.5)
		expect(t.y).toBe(0.5)
		expect(t.zOrder).toBe("front")
		expect(t.coordSystem).toBe("percent")
		// `text` is content, not style — a style object never carries it, so it
		// stays empty for the user to fill in.
		expect(t.text).toBe("")
	})
})

describe("annotation factory invariants", () => {
	it("leaves `facetKeys` ABSENT so a new annotation shows on every panel", () => {
		// undefined/null = all facets (the legacy behavior saved annotations
		// rely on). An empty array would hide it from every panel instead — the
		// exact opposite — so the key must not be seeded at all.
		for (const [label, make] of ALL_FACTORIES) {
			expect(make(), label).not.toHaveProperty("facetKeys")
		}
	})

	it("seeds the custom dasharray as an explicit null, not an absent key", () => {
		// Null means "fall back to the named dash pattern"; the picker's Custom
		// choice writes a string here and WINS. Both readers treat absent and
		// null alike, but the field must exist for the dash picker to bind to.
		expect(newRectangle("r1").borderDasharray).toBeNull()
		expect(newCircle("c1").borderDasharray).toBeNull()
		expect(newTextAnnotation("t1").borderDasharray).toBeNull()
		expect(newLineSegment("l1").lineDasharray).toBeNull()
	})

	it("defaults every factory to percent coordinates", () => {
		for (const [label, make] of ALL_FACTORIES) {
			expect(make().coordSystem, label).toBe("percent")
		}
	})

	it("places the seeded geometry inside the 0–1 plot rect", () => {
		// Percent coords are plot-area-NORMALIZED fractions, not 0–100
		// percentages: a factory that seeded 25 instead of 0.25 would drop the
		// annotation far off canvas with nothing on screen to drag back.
		const inRange = (v: number | string) =>
			typeof v === "number" && v >= 0 && v <= 1

		const rect = newRectangle("r1")
		for (const v of [rect.xMin, rect.xMax, rect.yMin, rect.yMax]) {
			expect(inRange(v)).toBe(true)
		}
		// A non-positive extent renders an invisible zero-area box.
		expect(Number(rect.xMax)).toBeGreaterThan(Number(rect.xMin))
		expect(Number(rect.yMax)).toBeGreaterThan(Number(rect.yMin))

		const line = newLineSegment("l1")
		for (const v of [line.xMin, line.xMax, line.yMin, line.yMax]) {
			expect(inRange(v)).toBe(true)
		}
		// A zero-length segment would draw nothing.
		expect([line.xMin, line.yMin]).not.toEqual([line.xMax, line.yMax])

		const text = newTextAnnotation("t1")
		expect(inRange(text.x)).toBe(true)
		expect(inRange(text.y)).toBe(true)

		// The circle must fit whole, radius included — it's measured against the
		// x-axis pixel extent by default.
		const circle = newCircle("c1")
		expect(circle.radiusAxis).toBe("x")
		expect(inRange(circle.centerX)).toBe(true)
		expect(inRange(circle.centerY)).toBe(true)
		expect(Number(circle.centerX) - circle.radius).toBeGreaterThanOrEqual(0)
		expect(Number(circle.centerX) + circle.radius).toBeLessThanOrEqual(1)
	})

	it("returns fresh objects that don't alias the shared seed constants", () => {
		// Every `loadCurrentAnnotations` fallback and every theme builder reads
		// these constants; a factory that handed one back by reference would let
		// the sidebar's first edit rewrite the defaults for the whole session.
		const boxSeedFill = DEFAULT_BOX_ANNOTATION_STYLE.backgroundColor
		const lineSeedColor = DEFAULT_LINE_ANNOTATION_STYLE.lineColor
		const textSeedSize = DEFAULT_RECTANGLE_TEXT.textFontSize

		const a = newRectangle("r1")
		const b = newRectangle("r2")
		a.backgroundColor = "#000000"
		a.textFontSize = 99
		expect(b.backgroundColor).toBe(boxSeedFill)
		expect(b.textFontSize).toBe(textSeedSize)
		expect(DEFAULT_BOX_ANNOTATION_STYLE.backgroundColor).toBe(boxSeedFill)
		expect(DEFAULT_RECTANGLE_TEXT.textFontSize).toBe(textSeedSize)

		const line = newLineSegment("l1")
		line.lineColor = "#000000"
		expect(DEFAULT_LINE_ANNOTATION_STYLE.lineColor).toBe(lineSeedColor)
		expect(newLineSegment("l2").lineColor).toBe(lineSeedColor)
	})
})

describe("DEFAULT_ANNOTATIONS_CONFIG", () => {
	it("carries an empty collection for every annotation kind", () => {
		// This is the `loadCurrentAnnotations` fallback: a kind missing from it
		// would surface as `undefined.map(...)` the first time the renderer runs
		// against a store that never held annotations.
		expect(Object.keys(DEFAULT_ANNOTATIONS_CONFIG).sort()).toEqual([
			"circles",
			"lineSegments",
			"rectangles",
			"texts",
		])
		for (const [kind, list] of Object.entries(DEFAULT_ANNOTATIONS_CONFIG)) {
			expect(Array.isArray(list), kind).toBe(true)
			expect(list, kind).toHaveLength(0)
		}
	})
})
