import { describe, expect, it } from "vitest"

import { TRENDS } from "../../../../testSupport/chartSpecFixtures"
import { MAX_PROBLEMS, parseChartSpec } from "./chartSpec"

const valid = () => ({
	datasetId: "ds-cafe",
	folderId: null,
	encodings: { x: "month", length: "muffins", hue: "flavor" },
})

const errorsOf = (input: unknown) => {
	const result = parseChartSpec(input)
	if (result.ok) throw new Error("expected the spec to be rejected")
	return result.errors
}

const paths = (input: unknown) => errorsOf(input).map((e) => e.path)

describe("parseChartSpec", () => {
	it.each(TRENDS.map((t) => [t.key, t.spec] as const))(
		"accepts the %s spec unchanged",
		(_key, spec) => {
			const result = parseChartSpec(spec)
			expect(result).toEqual({ ok: true, spec })
		}
	)

	it("accepts the smallest spec: a dataset, a folder and one encoding", () => {
		expect(parseChartSpec(valid()).ok).toBe(true)
	})

	it.each([null, [], "bars", 3])("rejects a body that isn't an object (%j)", (input) => {
		expect(paths(input)).toEqual([""])
	})

	it("requires datasetId, folderId and encodings", () => {
		expect(paths({}).sort()).toEqual(["datasetId", "encodings", "folderId"])
	})

	it("rejects an unknown top-level key and points at the near match", () => {
		const errors = errorsOf({ ...valid(), color: "#123456" })
		expect(errors).toHaveLength(1)
		expect(errors[0].path).toBe("color")
		expect(errors[0].message).toMatch(/colors/)
	})

	it("rejects a visual-shaped body (the strings-for-encodings toy) key by key", () => {
		const errors = errorsOf({
			id: "vs-toy4",
			name: "Toy 4",
			folderId: null,
			datasetId: "ds-cafe",
			encodings: { x: "month", length: "muffins" },
			channelConfigs: {},
		})
		expect(errors.map((e) => e.path).sort()).toEqual(["channelConfigs", "id"])
	})

	it("rejects an encoding value that isn't a field name", () => {
		const errors = errorsOf({
			...valid(),
			encodings: { x: { field: "month" }, length: "muffins" },
		})
		expect(errors.map((e) => e.path)).toEqual(["encodings.x"])
	})

	it("rejects a `colour` channel and suggests hue (the color-channel toy)", () => {
		const errors = errorsOf({
			...valid(),
			encodings: { x: "month", length: "muffins", colour: "flavor" },
		})
		expect(errors).toHaveLength(1)
		expect(errors[0].path).toBe("encodings.colour")
		expect(errors[0].message).toMatch(/hue/)
	})

	it("rejects the legacy text channel and points at data labels", () => {
		const errors = errorsOf({
			...valid(),
			encodings: { x: "month", length: "muffins", text: "muffins" },
		})
		expect(errors[0].path).toBe("encodings.text")
		expect(errors[0].message).toMatch(/dataLabels/)
	})

	it("rejects a color that isn't #rgb or #rrggbb", () => {
		const errors = errorsOf({ ...valid(), colors: { Lemon: "#GGG" } })
		expect(errors.map((e) => e.path)).toEqual(["colors.Lemon"])
	})

	it("quotes a path segment that isn't a plain identifier", () => {
		const errors = errorsOf({ ...valid(), colors: { "U.S. (Black)": "red" } })
		expect(errors.map((e) => e.path)).toEqual(['colors["U.S. (Black)"]'])
	})

	it.each(["", "   "])("rejects an empty folderId (%j)", (folderId) => {
		expect(paths({ ...valid(), folderId })).toEqual(["folderId"])
	})

	it("rejects __proto__ as a level, order or field-type key", () => {
		const own = (key: string, value: unknown) => Object.fromEntries([[key, value]])
		expect(paths({ ...valid(), colors: own("__proto__", "#fff") })).toEqual([
			"colors.__proto__",
		])
		expect(paths({ ...valid(), order: own("__proto__", ["a"]) })).toEqual([
			"order.__proto__",
		])
		expect(paths({ ...valid(), fieldTypes: own("__proto__", "ordinal") })).toEqual([
			"fieldTypes.__proto__",
		])
	})

	it("rejects a numeric title", () => {
		expect(paths({ ...valid(), title: 42 })).toEqual(["title"])
	})

	it("rejects an unknown family", () => {
		const errors = errorsOf({ ...valid(), family: "bars" })
		expect(errors.map((e) => e.path)).toEqual(["family"])
		expect(errors[0].message).toMatch(/"bar"/)
	})

	it("answers a label on a line with a text annotation beside it", () => {
		const [error] = errorsOf({ ...valid(), annotations: [{ kind: "line", x: [0, 1], y: [2, 2], label: "Target" }] })
		expect(error).toEqual({
			path: "annotations[0].label",
			message: `unknown line annotation key "label"; a line has no label: add {kind: "text", x, y, text} beside it`,
		})
	})

	it("says how a line spans the axis it leaves out", () => {
		const [error] = errorsOf({ ...valid(), annotations: [{ kind: "line", x: [2020, 2020] }] })
		expect(error?.path).toBe("annotations[0].y")
		expect(error?.message).toMatch(/a line across the chart takes the y axis's lowest and highest values .*x: \[5, 5\], y: \[0, 100\]$/)
		expect(errorsOf({ ...valid(), annotations: [{ kind: "line", x: [1], y: [2, 2] }] })[0]?.message).not.toMatch(/across the chart/)
	})

	it("answers a variation name sent as a family with the corrected call", () => {
		const [error] = errorsOf({ ...valid(), family: "choropleth" })
		expect(error).toEqual({
			path: "family",
			message: `unknown family "choropleth"; "Choropleth" is a variation: send family "map", variation "Choropleth"`,
		})
		expect(errorsOf({ ...valid(), family: "lollipop" })[0]?.message).toMatch(/^unknown family "lollipop".*\(families: /)
	})

	it("rejects an unknown field type", () => {
		expect(paths({ ...valid(), fieldTypes: { month: "date" } })).toEqual([
			"fieldTypes.month",
		])
	})

	it("rejects an axis whose min isn't below its max", () => {
		expect(paths({ ...valid(), axes: { y: { min: 5, max: 5 } } })).toEqual([
			"axes.y",
		])
	})

	it("rejects a non-finite axis bound", () => {
		expect(paths({ ...valid(), axes: { y: { max: "40" } } })).toEqual([
			"axes.y.max",
		])
	})

	it("rejects a format d3-format can't parse", () => {
		expect(paths({ ...valid(), axes: { y: { format: ".f1" } } })).toEqual([
			"axes.y.format",
		])
		expect(paths({ ...valid(), dataLabels: { format: "%%%" } })).toEqual([
			"dataLabels.format",
		])
	})

	it("accepts the app's format grammar beyond bare d3 specs", () => {
		for (const format of ["", ",.0f kg", "${,.2f}", "literal", "year-ends", "%Y"]) {
			expect(parseChartSpec({ ...valid(), axes: { y: { format } } }).ok).toBe(true)
		}
	})

	it("rejects an unknown data-label position and stack mode", () => {
		expect(
			paths({ ...valid(), dataLabels: { position: "above" }, stack: "pile" }).sort()
		).toEqual(["dataLabels.position", "stack"])
	})

	it("rejects order levels that aren't a list of strings", () => {
		expect(paths({ ...valid(), order: { month: "2026-01" } })).toEqual([
			"order.month",
		])
		expect(paths({ ...valid(), order: { month: ["a", "a"] } })).toEqual([
			"order.month",
		])
	})

	it.each(["__proto__", "constructor"])(
		"names an unknown %s key without Object.prototype leaking into the message",
		(key) => {
			const own = (k: string, value: unknown) => Object.fromEntries([[k, value]])
			const top = errorsOf({ ...valid(), ...own(key, 1) })
			expect(top.map((e) => e.path)).toEqual([key])
			expect(top[0]?.message).toMatch(new RegExp(`^unknown key "${key}"(;|$)`))
			const channel = errorsOf({ ...valid(), encodings: own(key, "month") })
			expect(channel[0]?.message).toMatch(new RegExp(`^unknown channel "${key}"(;|$)`))
			for (const e of [...top, ...channel]) {
				expect(e.message).not.toMatch(/object Object|native code/)
			}
		}
	)

	it("truncates a long report and stays fast", () => {
		const keys = Object.fromEntries(
			Array.from({ length: 20_000 }, (_, i) => [`junk${i}`, i])
		)
		const started = Date.now()
		const errors = errorsOf({ ...valid(), ...keys })
		expect(Date.now() - started).toBeLessThan(1000)
		expect(errors).toHaveLength(MAX_PROBLEMS + 1)
		expect(errors.at(-1)).toEqual({
			path: "",
			message: `…and ${20_000 - MAX_PROBLEMS} more`,
		})
	})

	it("cuts a long unknown name short in the message", () => {
		const key = "x".repeat(500)
		const [error] = errorsOf({ ...valid(), [key]: 1 })
		expect(error?.path).toBe(key)
		expect(error?.message.length).toBeLessThan(100)
	})

	it("reports every fault in one pass", () => {
		const errors = errorsOf({
			datasetId: 7,
			folderId: null,
			encodings: { x: "month", colour: "flavor", length: 3 },
			title: ["Muffins"],
			colors: { Lemon: "#GGG" },
			family: "histogram",
			dataLabels: { position: "middle" },
			axes: { x: { min: 3, max: 1 }, z: {} },
			theme: "light",
		})
		expect(errors.map((e) => e.path).sort()).toEqual(
			[
				"axes.x",
				"axes.z",
				"colors.Lemon",
				"dataLabels.position",
				"datasetId",
				"encodings.colour",
				"encodings.length",
				"family",
				"theme",
				"title",
			].sort()
		)
		for (const e of errors) expect(e.message).not.toBe("")
	})
})
