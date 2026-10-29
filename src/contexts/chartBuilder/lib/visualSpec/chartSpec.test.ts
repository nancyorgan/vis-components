import { describe, expect, it } from "vitest"

import { MAX_PROBLEMS, readChartSpec } from "./chartSpec"

const valid = () => ({
	datasetId: "ds-cafe",
	folderId: null,
	encodings: { x: "month", length: "muffins", hue: "flavor" },
})

const errorsOf = (input: unknown) => readChartSpec(input).errors

const paths = (input: unknown) => errorsOf(input).map((e) => e.path).sort()

const own = (key: string, value: unknown) => Object.fromEntries([[key, value]])

describe("readChartSpec", () => {
	it("keeps a well-formed spec whole", () => {
		const spec = {
			...valid(),
			name: "Muffins",
			family: "bar",
			variation: "Vertical grouped bars",
			fieldTypes: { month: "ordinal" },
			title: "Muffins by month",
			subtitle: "Q1",
			axes: { x: { title: "Month" }, y: { min: 0, max: 30, format: ",.0f" } },
			stack: "group",
			themeId: "Light",
		}
		expect(readChartSpec(spec)).toEqual({ draft: spec, errors: [] })
	})

	it.each([null, [], "bars", 3])("rejects a body that isn't an object (%j)", (input) => {
		expect(readChartSpec(input)).toEqual({
			draft: null,
			errors: [{ path: "", message: "a chart spec must be a JSON object" }],
		})
	})

	it("requires datasetId, folderId and encodings", () => {
		expect(paths({})).toEqual(["datasetId", "encodings", "folderId"])
	})

	it("rejects a visual-shaped body key by key", () => {
		expect(paths({ ...valid(), id: "vs-1", channelConfigs: {} })).toEqual(["channelConfigs", "id"])
	})

	it("names the close key for a misspelled one", () => {
		expect(errorsOf({ ...valid(), subtitel: "x" })[0]?.message).toBe(
			`unknown key "subtitel"; did you mean "subtitle"?`
		)
	})

	it("takes a channel by its shelf label and rejects one named twice", () => {
		const { draft } = readChartSpec({ ...valid(), encodings: { "X position": "month", Color: "flavor" } })
		expect(draft?.encodings).toEqual({ x: "month", hue: "flavor" })
		expect(paths({ ...valid(), encodings: { x: "month", "X position": "flavor" } })).toEqual([
			'encodings["X position"]',
		])
	})

	it("rejects an encoding value that isn't a field name, and colour for hue", () => {
		const errors = errorsOf({ ...valid(), encodings: { x: { field: "month" }, colour: "flavor" } })
		expect(errors.map((e) => e.path)).toEqual(["encodings.x", "encodings.colour"])
		expect(errors[1]?.message).toMatch(/"hue"/)
	})

	it.each(["__proto__", "constructor"])(
		"names an unknown %s key without Object.prototype leaking into the message",
		(key) => {
			const errors = [...errorsOf({ ...valid(), ...own(key, 1) }), ...errorsOf({ ...valid(), encodings: own(key, "month") })]
			expect(errors).toHaveLength(2)
			for (const e of errors) expect(e.message).not.toMatch(/object Object|native code/)
		}
	)

	it("rejects __proto__ as a field-type key, and an unknown field type", () => {
		expect(paths({ ...valid(), fieldTypes: own("__proto__", "ordinal") })).toEqual(["fieldTypes.__proto__"])
		expect(paths({ ...valid(), fieldTypes: { month: "date" } })).toEqual(["fieldTypes.month"])
	})

	it("answers a variation name sent as a family with the corrected call", () => {
		expect(errorsOf({ ...valid(), family: "Bubble" })[0]?.message).toBe(
			`unknown family "Bubble"; "Bubble" is a variation: send family "scatter", variation "Bubble"`
		)
		expect(errorsOf({ ...valid(), family: "bars" })[0]?.message).toMatch(/did you mean "bar"/)
	})

	it.each(["map", "sankey", "chord"])("says a %s chart is made in the editor", (family) => {
		expect(errorsOf({ ...valid(), family })).toEqual([
			{ path: "family", message: `a "${family}" chart can't be made from a spec yet; build it in the editor` },
		])
	})

	it("rejects a variation without a family", () => {
		expect(paths({ ...valid(), variation: "Bubble" })).toEqual(["variation"])
	})

	it("checks axis bounds and formats", () => {
		expect(paths({ ...valid(), axes: { y: { min: 5, max: 5 } } })).toEqual(["axes.y"])
		expect(paths({ ...valid(), axes: { y: { max: "40" } } })).toEqual(["axes.y.max"])
		expect(paths({ ...valid(), axes: { y: { format: ".f1" }, z: {} } })).toEqual(["axes.y.format", "axes.z"])
		for (const format of ["", ",.0f kg", "${,.2f}", "literal", "year-ends", "%Y", ",.1~fK", ",.1~fM", ",.1~fB", "$,.1~fM", "${$,.1~fB} spent"]) {
			expect(errorsOf({ ...valid(), axes: { y: { format } } })).toEqual([])
		}
		expect(errorsOf({ ...valid(), axes: { x: { min: "2020", max: "2021-06" } } })).toEqual([])
	})

	it("rejects an unknown stack mode", () => {
		expect(paths({ ...valid(), stack: "pile" })).toEqual(["stack"])
	})

	it("stays fast on thousands of unknown keys and cuts long names short", () => {
		const keys = Object.fromEntries(Array.from({ length: 20_000 }, (_, i) => [`junk${i}`, i]))
		const started = Date.now()
		const errors = errorsOf({ ...valid(), ...keys })
		expect(Date.now() - started).toBeLessThan(1000)
		expect(errors).toHaveLength(20_000)
		expect(errors.slice(MAX_PROBLEMS).every((e) => !e.message.includes("did you mean"))).toBe(true)
		const long = "x".repeat(500)
		expect(errorsOf({ ...valid(), [long]: 1 })[0]?.message.length).toBeLessThan(100)
	})
})
