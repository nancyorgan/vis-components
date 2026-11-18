import { describe, expect, it } from "vitest"

import { stringifyJsonDangerous } from "../../../lib/json"
import { buildDataset } from "../../../testSupport/fixtures"
import { EMPTY_CHANNEL_CONFIGS } from "./channelConfig"
import { DEFAULT_DATA_TABLE_CONFIG } from "./dataTableConfig"
import { embedColumns as columnsOfView, pruneEmbedRecords } from "./embedColumns"
import { resolveDatasetView } from "./resolveDatasetVersion"
import { DEFAULT_LABELS_CONFIG, DEFAULT_TOOLTIP_CONFIG } from "./labelsConfig"
import { emptyEncodings, type Dataset, type Field, type Visual } from "./types"

/** `embedColumns` over a stored data set's one version. */
const embedColumns = (visual: Visual, dataset: Dataset) => {
	const view = resolveDatasetView(dataset, null)
	if (!view) throw new Error("no view")
	return columnsOfView(visual, view)
}

/** Which columns a published embed carries: the ones the chart shows. */

const FIELDS: Field[] = [
	{ name: "Class", inferredType: "categorical" },
	{ name: "Average", inferredType: "quantitative" },
	{ name: "Pupil", inferredType: "categorical" },
	{ name: "Score", inferredType: "quantitative" },
	{ name: "Salary", inferredType: "quantitative" },
]

/** A bar chart of Average by Class, its tooltip narrowed to those two. */
const visual = (patch: Partial<Visual> = {}): Visual => ({
	id: "v",
	name: "Averages",
	folderId: null,
	datasetId: "ds",
	createdAtVersionId: null,
	fieldTypeOverrides: {},
	encodings: { ...emptyEncodings(), x: { field: "Class" }, length: { field: "Average" } },
	channelConfigs: EMPTY_CHANNEL_CONFIGS,
	labelsConfig: DEFAULT_LABELS_CONFIG,
	tooltipConfig: { ...DEFAULT_TOOLTIP_CONFIG, visibleFields: ["Class", "Average"] },
	thumbnail: null,
	createdAt: 1,
	updatedAt: 1,
	...patch,
})
const DATA = buildDataset({ id: "ds", fields: FIELDS, rows: [] })
const kept = (patch: Partial<Visual> = {}) => embedColumns(visual(patch), DATA).kept

describe("embedColumns", () => {
	it("keeps the columns the chart draws and drops the rest", () => {
		expect(embedColumns(visual(), DATA)).toEqual({
			kept: ["Class", "Average"],
			dropped: ["Pupil", "Score", "Salary"],
			allBecause: null,
		})
	})

	it("keeps every column while the tooltip lists the whole row", () => {
		expect(embedColumns(visual({ tooltipConfig: DEFAULT_TOOLTIP_CONFIG }), DATA)).toEqual({
			kept: FIELDS.map((f) => f.name),
			dropped: [],
			allBecause: "tooltip",
		})
		// No tooltip config saved at all is the default tooltip.
		expect(embedColumns(visual({ tooltipConfig: undefined }), DATA).allBecause).toBe(
			"tooltip"
		)
	})

	it("a tooltip that is off, or a template, shows only what it names", () => {
		expect(kept({ tooltipConfig: { ...DEFAULT_TOOLTIP_CONFIG, enabled: false } })).toEqual([
			"Class",
			"Average",
		])
		expect(
			kept({
				tooltipConfig: {
					...DEFAULT_TOOLTIP_CONFIG,
					useCustomHtml: true,
					customHtml: "<b>{{Class}}</b>: {{Score}}",
				},
			})
		).toEqual(["Class", "Average", "Score"])
	})

	it("keeps every column for a data table of all variables, the picked ones for a selection", () => {
		expect(
			embedColumns(
				visual({
					dataTableConfig: { ...DEFAULT_DATA_TABLE_CONFIG, enabled: true, columns: "all" },
				}),
				DATA
			).allBecause
		).toBe("dataTable")
		const select = {
			...DEFAULT_DATA_TABLE_CONFIG,
			columns: "select" as const,
			selectedColumns: ["Pupil"],
		}
		expect(kept({ dataTableConfig: { ...select, enabled: true } })).toEqual([
			"Class",
			"Average",
			"Pupil",
		])
		// A table that is switched off shows nothing.
		expect(kept({ dataTableConfig: { ...select, enabled: false } })).toEqual([
			"Class",
			"Average",
		])
	})

	it("keeps columns used by the other encodings, labels and rules", () => {
		expect(
			kept({ encodings: { ...visual().encodings, hue: { field: "Pupil" } } })
		).toContain("Pupil")
		expect(
			kept({
				channelConfigs: {
					...EMPTY_CHANNEL_CONFIGS,
					fillColorRules: [{ condition: "{Score} > 50", color: "#ff0000" }],
				} as Visual["channelConfigs"],
			})
		).toContain("Score")
		expect(
			kept({
				tooltipConfig: { ...DEFAULT_TOOLTIP_CONFIG, visibleFields: ["Class", "Salary"] },
			})
		).toContain("Salary")
	})

	const SCORES = buildDataset({
		id: "ds",
		fields: FIELDS,
		rows: [
			{ Class: "A", Average: "71", Pupil: "Ann", Score: "64", Salary: "50000" },
			{ Class: "B", Average: "68", Pupil: "Bo", Score: "90", Salary: "61000" },
		],
	})
	const bonus = {
		variables: [
			{ id: "d1", name: "Bonus", kind: "math" as const, math: { formula: "{Salary} * 0.1" } },
		],
	}

	it("a derived variable is a column like any other: kept only when shown, without what it was made from", () => {
		// Not shown: neither the variable nor its source is published.
		expect(embedColumns(visual({ derivedVariablesConfig: bonus }), SCORES).kept).toEqual([
			"Class",
			"Average",
		])
		// Shown: the variable, still not its source.
		const shown = visual({
			derivedVariablesConfig: bonus,
			encodings: { ...emptyEncodings(), x: { field: "Class" }, length: { field: "Bonus" } },
			tooltipConfig: { ...DEFAULT_TOOLTIP_CONFIG, enabled: false },
		})
		expect(embedColumns(shown, SCORES)).toEqual({
			kept: ["Class", "Bonus"],
			dropped: ["Average", "Pupil", "Score", "Salary"],
			allBecause: null,
		})
	})

	it("a reshape is published as its result", () => {
		const reshaped = visual({
			encodings: { ...emptyEncodings(), x: { field: "Class" }, length: { field: "value" } },
			tooltipConfig: { ...DEFAULT_TOOLTIP_CONFIG, enabled: false },
			reshapeConfig: {
				idFields: ["Class", "Pupil"],
				meltFields: ["Average", "Score"],
				variableName: "measure",
				valueName: "value",
			},
		})
		expect(embedColumns(reshaped, SCORES)).toEqual({
			kept: ["Class", "value"],
			dropped: ["Pupil", "measure"],
			allBecause: null,
		})
	})

	it("keeps the column another variable is ordered by", () => {
		expect(
			kept({ fieldLevelOrderSpecs: { Class: { by: "field", byField: "Score" } } })
		).toEqual(["Class", "Average", "Score"])
		// …but not for a variable that is itself dropped.
		expect(
			kept({ fieldLevelOrderSpecs: { Pupil: { by: "field", byField: "Score" } } })
		).toEqual(["Class", "Average"])
	})

	it("keeps the column a tree or flow diagram finds for itself", () => {
		const fields: Field[] = [
			{ name: "Parent", inferredType: "categorical" },
			{ name: "Notes", inferredType: "categorical" },
			{ name: "Child", inferredType: "categorical" },
			{ name: "Count", inferredType: "quantitative" },
		]
		const tree = visual({
			encodings: {
				...emptyEncodings(),
				connection: { field: "Parent" },
				area: { field: "Count" },
			},
			tooltipConfig: { ...DEFAULT_TOOLTIP_CONFIG, enabled: false },
		})
		const data = buildDataset({
			id: "ds",
			fields,
			rows: [
				{ Parent: "", Notes: "x", Child: "Pets", Count: "" },
				{ Parent: "Pets", Notes: "y", Child: "Cats", Count: "3" },
				{ Parent: "Pets", Notes: "z", Child: "Dogs", Count: "5" },
			],
		})
		expect(embedColumns(tree, data)).toEqual({
			kept: ["Parent", "Child", "Count"],
			dropped: ["Notes"],
			allBecause: null,
		})
	})

	it("doesn't count the per-variable bookkeeping as a use", () => {
		expect(
			kept({
				fieldTypeOverrides: { Salary: "categorical" },
				fieldLevelOrders: { Pupil: ["Ann", "Bo"] },
				fieldOrder: ["Salary", "Pupil", "Class", "Average", "Score"],
			})
		).toEqual(["Class", "Average"])
	})
})

describe("pruneEmbedRecords", () => {
	const dataset = () =>
		buildDataset({
			id: "ds",
			fields: FIELDS,
			rows: [
				{ Class: "A", Average: "71", Pupil: "Ann", Score: "64", Salary: "50000" },
				{ Class: "B", Average: "68", Pupil: "Bo", Score: "90", Salary: "61000" },
			],
		})

	it("removes dropped columns from the rows, the column lists and the settings that named them", () => {
		const source = visual({
			fieldTypeOverrides: { Salary: "categorical", Class: "ordinal" },
			fieldLevelOrders: { Pupil: ["Ann", "Bo"], Class: ["B", "A"] },
			fieldLevelOrderSpecs: { Pupil: { by: "alphabetical" } },
			fieldOrder: ["Salary", "Pupil", "Class", "Average", "Score"],
		})
		const pruned = pruneEmbedRecords(source, dataset())
		expect(pruned.dataset.fields.map((f) => f.name)).toEqual(["Class", "Average"])
		expect(pruned.dataset.versions[0]?.rows).toEqual([
			{ Class: "A", Average: "71" },
			{ Class: "B", Average: "68" },
		])
		expect(pruned.visual.fieldTypeOverrides).toEqual({ Class: "ordinal" })
		expect(pruned.visual.fieldLevelOrders).toEqual({ Class: ["B", "A"] })
		expect(pruned.visual.fieldLevelOrderSpecs).toEqual({})
		expect(pruned.visual.fieldOrder).toEqual(["Class", "Average"])
		const published = stringifyJsonDangerous([pruned.visual, pruned.dataset] as never)
		for (const gone of ["Pupil", "Score", "Salary", "Ann", "50000", "64"]) {
			expect(published).not.toContain(gone)
		}
		// The editor's own records are not touched.
		expect(source.fieldOrder).toHaveLength(5)
	})

	it("keeps a renamed column's cells, which sit under its earlier name", () => {
		const renamed = buildDataset({
			id: "ds",
			fields: [
				{ name: "Class", inferredType: "categorical", sourceNames: ["class_id"] },
				{ name: "Average", inferredType: "quantitative" },
				{ name: "Salary", inferredType: "quantitative", sourceNames: ["pay"] },
			],
			rows: [{ class_id: "A", Average: "71", pay: "50000" }],
		})
		const pruned = pruneEmbedRecords(visual(), renamed)
		expect(pruned.dataset.versions[0]?.rows).toEqual([{ class_id: "A", Average: "71" }])
	})

	it("hands back the same records when every column is shown", () => {
		const source = visual({ tooltipConfig: DEFAULT_TOOLTIP_CONFIG })
		const data = dataset()
		const pruned = pruneEmbedRecords(source, data)
		expect(pruned.visual).toBe(source)
		expect(pruned.dataset).toBe(data)
	})

	it("publishes a derived variable's values with neither its formula nor its source", () => {
		const shown = visual({
			derivedVariablesConfig: {
				variables: [
					{ id: "d1", name: "Bonus", kind: "math", math: { formula: "{Salary} * 0.1" } },
				],
			},
			encodings: { ...emptyEncodings(), x: { field: "Class" }, length: { field: "Bonus" } },
			tooltipConfig: { ...DEFAULT_TOOLTIP_CONFIG, enabled: false },
		})
		const pruned = pruneEmbedRecords(shown, dataset())
		expect(pruned.dataset.versions[0]?.rows).toEqual([
			{ Class: "A", Bonus: "5000" },
			{ Class: "B", Bonus: "6100" },
		])
		expect(pruned.dataset.fields.map((f) => f.name)).toEqual(["Class", "Bonus"])
		expect(pruned.visual.derivedVariablesConfig).toBeUndefined()
		const published = stringifyJsonDangerous([pruned.visual, pruned.dataset] as never)
		for (const gone of ["Salary", "50000", "61000", "* 0.1"]) {
			expect(published).not.toContain(gone)
		}
	})

	it("publishes a reshape as the long table, without the reshape settings", () => {
		const reshaped = visual({
			encodings: {
				...emptyEncodings(),
				x: { field: "Class" },
				length: { field: "value" },
				hue: { field: "measure" },
			},
			tooltipConfig: { ...DEFAULT_TOOLTIP_CONFIG, enabled: false },
			reshapeConfig: {
				idFields: ["Class", "Pupil"],
				meltFields: ["Average", "Score"],
				variableName: "measure",
				valueName: "value",
			},
		})
		const pruned = pruneEmbedRecords(reshaped, dataset())
		expect(pruned.visual.reshapeConfig).toBeUndefined()
		expect(pruned.dataset.versions[0]?.rows).toEqual([
			{ Class: "A", measure: "Average", value: "71" },
			{ Class: "A", measure: "Score", value: "64" },
			{ Class: "B", measure: "Average", value: "68" },
			{ Class: "B", measure: "Score", value: "90" },
		])
		const published = stringifyJsonDangerous([pruned.visual, pruned.dataset] as never)
		for (const gone of ["Pupil", "Ann", "Salary", "idFields"]) {
			expect(published).not.toContain(gone)
		}
	})
})
