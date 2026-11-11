import { describe, expect, it } from "vitest"

import { barLabelPositionNote, barValueAxis, withBarLabelPosition } from "./dataLabelsPosition"
import { emptyDataLabelsEncodings, emptyEncodings, type DataLabelsEncodings, type Encodings } from "./types"

const VERTICAL: Encodings = { ...emptyEncodings(), x: { field: "region" }, length: { field: "sales" } }
const HORIZONTAL: Encodings = { ...emptyEncodings(), y: { field: "region" }, length: { field: "sales" } }
const labels = (over: Partial<DataLabelsEncodings> = {}): DataLabelsEncodings => ({
	...emptyDataLabelsEncodings(),
	value: { field: "sales" },
	...over,
})

describe("barValueAxis", () => {
	it("y on vertical bars, x on horizontal", () => {
		expect(barValueAxis(VERTICAL)).toBe("y")
		expect(barValueAxis(HORIZONTAL)).toBe("x")
	})
	it("none without Length, with both axes, on a pie or an area chart", () => {
		expect(barValueAxis({ ...VERTICAL, length: { field: null } })).toBeNull()
		expect(barValueAxis({ ...VERTICAL, y: { field: "sales" }, length: { field: "profit" } })).toBeNull()
		expect(barValueAxis({ ...VERTICAL, angle: { field: "sales" } })).toBeNull()
		expect(barValueAxis({ ...VERTICAL, connection: { field: "segment" } })).toBeNull()
	})
})

describe("withBarLabelPosition", () => {
	it("vertical bars: the y position takes the Length variable", () => {
		expect(withBarLabelPosition(labels(), VERTICAL).y).toEqual({ field: "sales" })
	})
	it("horizontal bars: the x position takes it", () => {
		expect(withBarLabelPosition(labels(), HORIZONTAL).x).toEqual({ field: "sales" })
	})
	it("stacked / grouped bars with a Color variable too", () => {
		const stacked = { ...VERTICAL, hue: { field: "segment" } }
		expect(withBarLabelPosition(labels(), stacked).y).toEqual({ field: "sales" })
	})
	it("a multi-variable value with a variable checked counts as a value", () => {
		const multi = labels({ value: { field: null, multiField: true, fields: ["sales"] } })
		expect(withBarLabelPosition(multi, VERTICAL).y).toEqual({ field: "sales" })
	})

	describe("leaves the labels alone", () => {
		const same = (l: DataLabelsEncodings, chart: Encodings = VERTICAL) =>
			expect(withBarLabelPosition(l, chart)).toBe(l)
		it("with no value (or an empty checklist)", () => {
			same(labels({ value: { field: null } }))
			same(labels({ value: { field: null, multiField: true, fields: [] } }))
		})
		it("when the position is already set: another field, or none", () => {
			same(labels({ y: { field: "profit" } }))
			same(labels({ y: { field: null, none: true } }))
		})
		it("with nothing on Length", () => {
			same(labels(), { ...VERTICAL, length: { field: null } })
		})
		it("on a vector field: x year, y sales, Length + Angle profit", () => {
			const vector: Encodings = {
				...emptyEncodings(),
				x: { field: "year" },
				y: { field: "sales" },
				length: { field: "profit" },
				angle: { field: "profit" },
			}
			const l = labels({ y: { field: "sales" } })
			same(l, vector)
			same(labels(), vector)
		})
		it("on a combo (x + y + Length)", () => {
			same(labels(), { ...VERTICAL, y: { field: "profit" } })
		})
	})
})

describe("barLabelPositionNote", () => {
	it("says where labels draw and what moves them, without em dashes", () => {
		const note = barLabelPositionNote("y", "sales", "center")
		expect(note).toContain("dataLabelsConfig.barLabelPosition")
		expect(note).toContain('"sales"')
		expect(note).not.toContain("—")
	})
})
