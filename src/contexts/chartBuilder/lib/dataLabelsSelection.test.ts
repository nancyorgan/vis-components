import { describe, expect, it } from "vitest"

import {
	defaultSharedTemplate,
	fieldLabelPointsMode,
	populationOverrides,
	populationTemplate,
	populationTemplateFallback,
	populationsAtTag,
	presentPopulations,
	resolveLabelSelection,
} from "./dataLabelsSelection"

const multi = (fields: string[]) => ({ multiField: true, fields })
const single = { multiField: false, fields: [] as string[] }

describe("resolveLabelSelection — single-field", () => {
	it("reads the populations off labelPoints", () => {
		expect(resolveLabelSelection({}, single).present).toEqual({
			all: true,
			first: false,
			last: false,
		})
		expect(resolveLabelSelection({ labelPoints: "last" }, single).present).toEqual(
			{ all: false, first: false, last: true }
		)
		const both = resolveLabelSelection({ labelPoints: "first-last" }, single)
		expect(both.present).toEqual({ all: false, first: true, last: true })
		expect(both.split).toBe(true)
	})
	it("legacy onlyLastLabel reads as last, unsplit", () => {
		const sel = resolveLabelSelection({ onlyLastLabel: true }, single)
		expect(sel.present).toEqual({ all: false, first: false, last: true })
		expect(sel.split).toBe(false)
	})
})

describe("resolveLabelSelection — multi-field", () => {
	it("defaults every field to the layer-wide mode", () => {
		const sel = resolveLabelSelection(
			{ labelPoints: "first-last" },
			multi(["value", "series"])
		)
		expect(sel.fields).toEqual({
			all: [],
			first: ["value", "series"],
			last: ["value", "series"],
		})
		expect(sel.split).toBe(true)
		expect(fieldLabelPointsMode({ labelPoints: "first-last" }, "value")).toBe(
			"first-last"
		)
	})
	it("per-field modes split the fields into populations", () => {
		const sel = resolveLabelSelection(
			{ fieldLabelPoints: { series: "last" } },
			multi(["value", "series"])
		)
		expect(sel.fields).toEqual({ all: ["value"], first: [], last: ["series"] })
		expect(sel.present).toEqual({ all: true, first: false, last: true })
		expect(sel.split).toBe(true)
		expect(presentPopulations(sel)).toEqual(["all", "last"])
	})
	it("a lone population is not split", () => {
		const sel = resolveLabelSelection(
			{ fieldLabelPoints: { value: "last", series: "last" } },
			multi(["value", "series"])
		)
		expect(sel.present).toEqual({ all: false, first: false, last: true })
		expect(sel.split).toBe(false)
	})
	it("seriesless reads every field as all", () => {
		const sel = resolveLabelSelection(
			{ fieldLabelPoints: { series: "last" }, labelPoints: "first" },
			multi(["value", "series"]),
			{ seriesless: true }
		)
		expect(sel.fields.all).toEqual(["value", "series"])
		expect(sel.split).toBe(false)
	})
})

describe("populationsAtTag", () => {
	const sel = resolveLabelSelection(
		{ fieldLabelPoints: { series: "last" } },
		multi(["value", "series"])
	)
	it("interior anchors carry only the all-labels population", () => {
		expect(populationsAtTag(sel, undefined)).toEqual(["all"])
		expect(populationsAtTag(sel, "first")).toEqual(["all"])
	})
	it("a last anchor carries both all and last labels", () => {
		expect(populationsAtTag(sel, "last")).toEqual(["all", "last"])
	})
	it("a single-anchor series ('both') takes the last label, and the first only when it adds a field", () => {
		expect(populationsAtTag(sel, "both")).toEqual(["all", "last"])
		const firstLast = resolveLabelSelection({ labelPoints: "first-last" }, single)
		expect(populationsAtTag(firstLast, "both")).toEqual(["last"])
		const split = resolveLabelSelection(
			{ fieldLabelPoints: { value: "first", series: "last" } },
			multi(["value", "series"])
		)
		expect(populationsAtTag(split, "both")).toEqual(["last", "first"])
		const firstOnly = resolveLabelSelection({ labelPoints: "first" }, single)
		expect(populationsAtTag(firstOnly, "both")).toEqual(["first"])
	})
})

describe("populationTemplate / fallback", () => {
	it("all-labels uses the shared template, else its fields joined", () => {
		const sel = resolveLabelSelection(
			{ fieldLabelPoints: { series: "last" } },
			multi(["value", "series"])
		)
		expect(populationTemplate({ labelTemplate: "" }, sel, "all")).toBe("{value}")
		expect(populationTemplate({ labelTemplate: "{value}!" }, sel, "all")).toBe(
			"{value}!"
		)
	})
	it("a series-end population prefills its own fields when all-labels also render", () => {
		const sel = resolveLabelSelection(
			{ fieldLabelPoints: { series: "last" } },
			multi(["value", "series"])
		)
		// Must NOT borrow the value-only shared text for the series name.
		expect(
			populationTemplateFallback({ labelTemplate: "{value}" }, sel, "last")
		).toBe("{series}")
		expect(
			populationTemplate(
				{ labelTemplate: "{value}", lastLabel: { labelTemplate: "— {series}" } },
				sel,
				"last"
			)
		).toBe("— {series}")
	})
	it("legacy first-and-last inherits the shared template on both ends", () => {
		const sel = resolveLabelSelection(
			{ labelPoints: "first-last" },
			multi(["sales", "region"])
		)
		const cfg = {
			labelTemplate: "{sales}",
			lastLabel: { labelTemplate: "{sales} {region}" },
		}
		expect(populationTemplate(cfg, sel, "first")).toBe("{sales}")
		expect(populationTemplate(cfg, sel, "last")).toBe("{sales} {region}")
	})
	it("a lone population ignores its override block and uses the shared template", () => {
		const sel = resolveLabelSelection({ labelPoints: "last" }, multi(["sales", "region"]))
		const cfg = {
			labelTemplate: "{sales}",
			lastLabel: { labelTemplate: "{sales} {region}", xOffset: 8 },
		}
		expect(populationTemplate(cfg, sel, "last")).toBe("{sales}")
		expect(populationOverrides(cfg, sel, "last")).toEqual({})
	})
	it("split selections consult the override blocks for series ends only", () => {
		const sel = resolveLabelSelection(
			{ fieldLabelPoints: { series: "last" } },
			multi(["value", "series"])
		)
		const cfg = { lastLabel: { xOffset: 8, alignment: "left" as const } }
		expect(populationOverrides(cfg, sel, "last")).toEqual(cfg.lastLabel)
		expect(populationOverrides(cfg, sel, "all")).toEqual({})
	})
})

describe("defaultSharedTemplate", () => {
	it("joins every field when unsplit, only the all-labels fields when split", () => {
		const unsplit = resolveLabelSelection({}, multi(["a", "b"]))
		expect(defaultSharedTemplate(unsplit, ["a", "b"])).toBe("{a}, {b}")
		const split = resolveLabelSelection(
			{ fieldLabelPoints: { b: "last" } },
			multi(["a", "b"])
		)
		expect(defaultSharedTemplate(split, ["a", "b"])).toBe("{a}")
	})
})
