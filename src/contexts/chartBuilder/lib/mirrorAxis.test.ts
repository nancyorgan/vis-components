import { describe, expect, it } from "vitest"

import { DEFAULT_AXIS_CONFIG, type AxisConfig } from "./channelConfig"
import {
	applyMirrorSign,
	mirrorTickBreaks,
	pinnedAxisBounds,
	resolveMirrorDirection,
	twoLevelFieldNames,
	twoLevelsOf,
} from "./mirrorAxis"

const rows = [
	{ age: "0-9", sex: "M", pop: "10", region: "N" },
	{ age: "0-9", sex: "F", pop: "12", region: "S" },
	{ age: "10-19", sex: "M", pop: "8", region: "E" },
	{ age: "10-19", sex: "F", pop: "", region: "N" },
]
const fields = [
	{ name: "age" },
	{ name: "sex" },
	{ name: "pop" },
	{ name: "region" },
]
const getType = (name: string) =>
	name === "pop" ? ("quantitative" as const) : ("categorical" as const)

describe("mirrorAxis — direction fields", () => {
	it("lists only fields with exactly two distinct non-blank values", () => {
		// age: 2 levels; sex: 2; pop: 3 numeric (blank dropped); region: 3.
		expect(twoLevelFieldNames(rows, fields, getType)).toEqual(["age", "sex"])
	})

	it("orders the two levels first-seen, or by the pinned Fields order", () => {
		expect(twoLevelsOf(rows, "sex", "categorical", undefined)).toEqual(["M", "F"])
		expect(twoLevelsOf(rows, "sex", "categorical", ["F", "M"])).toEqual(["F", "M"])
		expect(twoLevelsOf(rows, "region", "categorical", undefined)).toBeNull()
	})

	it("resolves null when off, unchosen, or the field lost its two levels", () => {
		expect(resolveMirrorDirection(undefined, rows, getType, {})).toBeNull()
		expect(
			resolveMirrorDirection(
				{ enabled: false, directionField: "sex" },
				rows,
				getType,
				{}
			)
		).toBeNull()
		expect(
			resolveMirrorDirection(
				{ enabled: true, directionField: null },
				rows,
				getType,
				{}
			)
		).toBeNull()
		expect(
			resolveMirrorDirection(
				{ enabled: true, directionField: "region" },
				rows,
				getType,
				{}
			)
		).toBeNull()
		expect(
			resolveMirrorDirection(
				{ enabled: true, directionField: "sex" },
				rows,
				getType,
				{ sex: ["F", "M"] }
			)
		).toEqual({
			field: "sex",
			type: "categorical",
			negativeLevel: "F",
			positiveLevel: "M",
		})
	})
})

describe("mirrorAxis — applyMirrorSign", () => {
	const direction = {
		field: "sex",
		type: "categorical" as const,
		negativeLevel: "M",
		positiveLevel: "F",
	}

	it("negates the measure on the negative level only, leaving blanks alone", () => {
		const out = applyMirrorSign(rows, "pop", direction)
		expect(out.map((r) => r.pop)).toEqual([-10, "12", -8, ""])
	})

	it("never mutates the input rows and passes untouched rows by reference", () => {
		const out = applyMirrorSign(rows, "pop", direction)
		expect(rows[0].pop).toBe("10")
		expect(out[1]).toBe(rows[1])
	})

	it("matches a numeric / temporal direction by PARSED value, as discovered", () => {
		// Levels are discovered through parseValue, so "1.0" and "1" are one
		// level; the row compare must parse the same way or nothing matches.
		const numRows = [
			{ side: "1.0", pop: "10" },
			{ side: "1", pop: "5" },
			{ side: "2", pop: "7" },
		]
		const numDir = resolveMirrorDirection(
			{ enabled: true, directionField: "side" },
			numRows,
			() => "quantitative",
			{}
		)
		expect(numDir?.negativeLevel).toBe("1")
		expect(applyMirrorSign(numRows, "pop", numDir!).map((r) => r.pop)).toEqual([
			-10, -5, "7",
		])
		const dateRows = [
			{ when: "2019-01-01", pop: "3" },
			{ when: "2020-01-01", pop: "4" },
		]
		const dateDir = resolveMirrorDirection(
			{ enabled: true, directionField: "when" },
			dateRows,
			() => "temporal",
			{}
		)
		expect(applyMirrorSign(dateRows, "pop", dateDir!).map((r) => r.pop)).toEqual([
			-3, "4",
		])
	})

	it("keeps a zero measure a plain 0 (no negative zero)", () => {
		const out = applyMirrorSign([{ sex: "M", pop: "0" }], "pop", direction)
		expect(Object.is(out[0].pop, 0)).toBe(true)
	})
})

describe("mirrorAxis — ticks and bounds", () => {
	it("mirrors break magnitudes to both sides, 0 once, sorted and de-duped", () => {
		expect(mirrorTickBreaks([100, 50, -50, 0])).toEqual([-100, -50, 0, 50, 100])
		expect(mirrorTickBreaks(undefined)).toEqual([])
		expect(mirrorTickBreaks([])).toEqual([])
	})

	it("pinnedAxisBounds swaps to the mirror's side maxes only while active", () => {
		const cfg: AxisConfig = {
			...DEFAULT_AXIS_CONFIG,
			min: 5,
			max: 50,
			mirror: {
				enabled: true,
				directionField: "sex",
				negativeMax: 30,
				positiveMax: null,
			},
		}
		// Off (other renderer / mode): the plain Scale range applies.
		expect(pinnedAxisBounds(cfg, false)).toEqual({ min: 5, max: 50 })
		// On: the negative-side max becomes the domain min, negated; a blank
		// positive max stays auto.
		expect(pinnedAxisBounds(cfg, true)).toEqual({ min: -30, max: undefined })
		// Active flag but the config's mirror is off → plain range.
		expect(
			pinnedAxisBounds({ ...cfg, mirror: { enabled: false, directionField: null } }, true)
		).toEqual({ min: 5, max: 50 })
		expect(pinnedAxisBounds(undefined, true)).toEqual({
			min: undefined,
			max: undefined,
		})
	})
})
