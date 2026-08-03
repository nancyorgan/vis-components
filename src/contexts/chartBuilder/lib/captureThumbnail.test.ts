import { describe, expect, it } from "vitest"
import { parseLinearGradient } from "./captureThumbnail"

describe("parseLinearGradient", () => {
	it("parses a computed horizontal ramp (legend gradient bar)", () => {
		const parsed = parseLinearGradient(
			"linear-gradient(to right, rgb(255, 245, 240) 0%, rgb(252, 146, 114) 50%, rgb(103, 0, 13) 100%)"
		)
		expect(parsed).not.toBeNull()
		expect(parsed?.coords).toEqual({ x1: "0", y1: "0", x2: "1", y2: "0" })
		expect(parsed?.stops).toEqual([
			{ color: "rgb(255, 245, 240)", offset: 0 },
			{ color: "rgb(252, 146, 114)", offset: 0.5 },
			{ color: "rgb(103, 0, 13)", offset: 1 },
		])
	})

	it("parses a vertical ramp with hi-on-top (to top)", () => {
		const parsed = parseLinearGradient(
			"linear-gradient(to top, rgb(0, 0, 255) 0%, rgb(255, 0, 0) 100%)"
		)
		expect(parsed?.coords).toEqual({ x1: "0", y1: "1", x2: "0", y2: "0" })
	})

	it("defaults to 'to bottom' when no direction is given", () => {
		const parsed = parseLinearGradient(
			"linear-gradient(rgb(0, 0, 0) 0%, rgb(255, 255, 255) 100%)"
		)
		expect(parsed?.coords).toEqual({ x1: "0", y1: "0", x2: "0", y2: "1" })
	})

	it("distributes offsets evenly when stops omit percentages", () => {
		const parsed = parseLinearGradient(
			"linear-gradient(to right, rgb(1, 2, 3), rgb(4, 5, 6), rgb(7, 8, 9))"
		)
		expect(parsed?.stops.map((s) => s.offset)).toEqual([0, 0.5, 1])
	})

	it("keeps rgba colors (with their internal commas) intact", () => {
		const parsed = parseLinearGradient(
			"linear-gradient(to right, rgba(0, 0, 0, 0.5) 0%, rgb(9, 9, 9) 100%)"
		)
		expect(parsed?.stops[0]).toEqual({
			color: "rgba(0, 0, 0, 0.5)",
			offset: 0,
		})
	})

	it("rejects angle directions it can't map to SVG coords", () => {
		expect(
			parseLinearGradient(
				"linear-gradient(45deg, rgb(0, 0, 0) 0%, rgb(255, 255, 255) 100%)"
			)
		).toBeNull()
	})

	it("rejects non-gradient background images", () => {
		expect(parseLinearGradient('url("foo.png")')).toBeNull()
		expect(parseLinearGradient("none")).toBeNull()
	})
})
