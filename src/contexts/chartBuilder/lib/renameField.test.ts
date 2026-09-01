import { describe, expect, it } from "vitest"
import {
	DEFAULT_CONNECTION_CONFIG,
	DEFAULT_DATA_LABELS_CONFIG,
	DEFAULT_FACET_CONFIG,
	DEFAULT_REGRESSION_CONFIG,
	DEFAULT_AXIS_CONFIG,
} from "./channelConfig"
import { DEFAULT_ANNOTATIONS_CONFIG } from "./annotationsConfig"
import { DEFAULT_LABELS_CONFIG, DEFAULT_TOOLTIP_CONFIG } from "./labelsConfig"
import {
	fieldRenameError,
	originalFieldName,
	renameDatasetField,
	renameFieldInConfigs,
	type FieldNameConfigs,
} from "./renameField"
import { DEFAULT_RESHAPE_CONFIG } from "./reshape"
import { emptyDataLabelsEncodings, emptyEncodings, type Field } from "./types"

const q = (name: string, sourceNames?: string[]): Field => ({
	name,
	inferredType: "quantitative",
	...(sourceNames ? { sourceNames } : {}),
})
const c = (name: string, sourceNames?: string[]): Field => ({
	name,
	inferredType: "categorical",
	...(sourceNames ? { sourceNames } : {}),
})

const baseState = (): Required<FieldNameConfigs> => ({
	encodings: emptyEncodings(),
	dataLabelsEncodings: emptyDataLabelsEncodings(),
	fieldTypeOverrides: {},
	fieldLevelOrders: {},
	channelConfigs: {},
	labelsConfig: DEFAULT_LABELS_CONFIG,
	dataLabelsConfig: DEFAULT_DATA_LABELS_CONFIG,
	tooltipConfig: DEFAULT_TOOLTIP_CONFIG,
	reshapeConfig: DEFAULT_RESHAPE_CONFIG,
	annotationsConfig: DEFAULT_ANNOTATIONS_CONFIG,
})

describe("fieldRenameError", () => {
	const fields = [q("x"), c("group", ["grp"])]

	it("accepts a fresh name", () => {
		expect(fieldRenameError(fields, "x", "value")).toBeNull()
	})

	it("rejects an empty name", () => {
		expect(fieldRenameError(fields, "x", "")).toBe("Enter a name.")
	})

	it("rejects another field's current name", () => {
		expect(fieldRenameError(fields, "x", "group")).toMatch(
			/already named "group"/
		)
	})

	it("rejects another field's former name", () => {
		expect(fieldRenameError(fields, "x", "grp")).toMatch(
			/former name of "group"/
		)
	})

	it("allows renaming back to the field's OWN former name", () => {
		expect(fieldRenameError(fields, "group", "grp")).toBeNull()
	})
})

describe("renameDatasetField", () => {
	it("renames the field and remembers the old name", () => {
		expect(renameDatasetField([q("x"), c("g")], "x", "value")).toEqual([
			q("value", ["x"]),
			c("g"),
		])
	})

	it("accumulates former names across repeated renames (newest last)", () => {
		const once = renameDatasetField([q("A")], "A", "B")
		const twice = renameDatasetField(once, "B", "C")
		expect(twice).toEqual([q("C", ["A", "B"])])
	})

	it("keeps the full chronological list when renaming back to a former name", () => {
		// The self-entry ("A" while named A) is inert — every consumer checks
		// `name` first — and preserving it keeps sourceNames[0] = the upload
		// original forever, which the empty-box revert relies on.
		const once = renameDatasetField([q("A")], "A", "B")
		expect(renameDatasetField(once, "B", "A")).toEqual([q("A", ["A", "B"])])
	})

	it("leaves other fields' references intact", () => {
		const g = c("g")
		expect(renameDatasetField([q("x"), g], "x", "y")[1]).toBe(g)
	})
})

describe("originalFieldName", () => {
	it("is the field's own name when never renamed", () => {
		expect(originalFieldName(q("x"))).toBe("x")
	})

	it("is the upload name after any number of renames", () => {
		const once = renameDatasetField([q("A")], "A", "B")
		const twice = renameDatasetField(once, "B", "C")
		expect(originalFieldName(twice[0]!)).toBe("A")
	})

	it("survives a revert-then-rename round trip", () => {
		const once = renameDatasetField([q("A")], "A", "B")
		const reverted = renameDatasetField(once, "B", "A")
		const again = renameDatasetField(reverted, "A", "X")
		expect(originalFieldName(again[0]!)).toBe("A")
	})
})

describe("renameFieldInConfigs — standard (view-field) rewrite", () => {
	const fields = [q("sales"), c("region")]

	it("swaps encoding field references and nothing else", () => {
		const state = baseState()
		state.encodings = {
			...state.encodings,
			x: { field: "region" },
			y: { field: "sales" },
		}
		const next = renameFieldInConfigs(state, fields, "sales", "revenue")
		expect(next.encodings.y.field).toBe("revenue")
		expect(next.encodings.x.field).toBe("region")
		// untouched slices keep their identity
		expect(next.channelConfigs).toBe(state.channelConfigs)
		expect(next.tooltipConfig).toBe(state.tooltipConfig)
		expect(next.labelsConfig).toBe(state.labelsConfig)
	})

	it("returns the same state reference when nothing mentions the old name", () => {
		const state = baseState()
		expect(renameFieldInConfigs(state, fields, "sales", "revenue")).toBe(
			state
		)
	})

	it("swaps data-labels encodings including the multi-field selection", () => {
		const state = baseState()
		state.dataLabelsEncodings = {
			...state.dataLabelsEncodings,
			hue: { field: "sales" },
			value: { field: null, multiField: true, fields: ["region", "sales"] },
		}
		const next = renameFieldInConfigs(state, fields, "sales", "revenue")
		expect(next.dataLabelsEncodings.hue.field).toBe("revenue")
		expect(next.dataLabelsEncodings.value.fields).toEqual([
			"region",
			"revenue",
		])
	})

	it("re-keys the per-field maps (type overrides, level orders)", () => {
		const state = baseState()
		state.fieldTypeOverrides = { sales: "ordinal" }
		state.fieldLevelOrders = { sales: ["1", "2"], region: ["b", "a"] }
		const next = renameFieldInConfigs(state, fields, "sales", "revenue")
		expect(next.fieldTypeOverrides).toEqual({ revenue: "ordinal" })
		expect(next.fieldLevelOrders).toEqual({
			revenue: ["1", "2"],
			region: ["b", "a"],
		})
	})

	it("swaps the deep channel-config references", () => {
		const state = baseState()
		state.channelConfigs = {
			x: {
				...DEFAULT_AXIS_CONFIG,
				regression: { ...DEFAULT_REGRESSION_CONFIG, groupField: "sales" },
			},
			connection: {
				...DEFAULT_CONNECTION_CONFIG,
				stemColorField: "sales",
				flowTargetField: "sales",
			},
			drawOrder: { field: "sales", dir: "asc" },
			colorSlots: {
				stem: { field: "sales", singleColor: "#000" },
				rug: { field: "region", singleColor: "#111" },
			},
			opacitySlots: { border: { field: "sales", level: 1 } },
		}
		const next = renameFieldInConfigs(state, fields, "sales", "revenue")
		expect(next.channelConfigs.x?.regression?.groupField).toBe("revenue")
		expect(next.channelConfigs.connection?.stemColorField).toBe("revenue")
		expect(next.channelConfigs.connection?.flowTargetField).toBe("revenue")
		expect(next.channelConfigs.drawOrder?.field).toBe("revenue")
		expect(next.channelConfigs.colorSlots?.stem?.field).toBe("revenue")
		expect(next.channelConfigs.opacitySlots?.border?.field).toBe("revenue")
		// the untouched slot keeps its identity
		expect(next.channelConfigs.colorSlots?.rug).toBe(
			state.channelConfigs.colorSlots?.rug
		)
	})

	it("rewrites label templates, per-field formats/colors, and endpoint templates", () => {
		const state = baseState()
		state.dataLabelsConfig = {
			...DEFAULT_DATA_LABELS_CONFIG,
			labelTemplate: "{region}: {sales} ({sales})",
			fieldFormats: { sales: ".1%" },
			fieldColors: { sales: { field: "sales", singleColor: "#000" } },
			firstLabel: { labelTemplate: "start {sales}" },
			lastLabel: { labelTemplate: "end {sales}" },
		}
		const next = renameFieldInConfigs(state, fields, "sales", "revenue")
		expect(next.dataLabelsConfig.labelTemplate).toBe(
			"{region}: {revenue} ({revenue})"
		)
		expect(next.dataLabelsConfig.fieldFormats).toEqual({ revenue: ".1%" })
		expect(next.dataLabelsConfig.fieldColors).toEqual({
			revenue: { field: "revenue", singleColor: "#000" },
		})
		expect(next.dataLabelsConfig.firstLabel?.labelTemplate).toBe(
			"start {revenue}"
		)
		expect(next.dataLabelsConfig.lastLabel?.labelTemplate).toBe(
			"end {revenue}"
		)
	})

	it("does not rewrite a template token that merely contains the name", () => {
		const state = baseState()
		state.dataLabelsConfig = {
			...DEFAULT_DATA_LABELS_CONFIG,
			labelTemplate: "{sales total} {sales}",
		}
		const next = renameFieldInConfigs(state, fields, "sales", "revenue")
		expect(next.dataLabelsConfig.labelTemplate).toBe(
			"{sales total} {revenue}"
		)
	})

	it("rewrites tooltip visible fields and {{tokens}} in the custom HTML", () => {
		const state = baseState()
		state.tooltipConfig = {
			...DEFAULT_TOOLTIP_CONFIG,
			visibleFields: ["region", "sales"],
			customHtml: "<b>{{sales}}</b> in {{region}}",
		}
		const next = renameFieldInConfigs(state, fields, "sales", "revenue")
		expect(next.tooltipConfig.visibleFields).toEqual(["region", "revenue"])
		expect(next.tooltipConfig.customHtml).toBe(
			"<b>{{revenue}}</b> in {{region}}"
		)
	})

	it("swaps reshape membership arrays (stale-name hygiene)", () => {
		const state = baseState()
		// Not an applying reshape (no melt fields present in the dataset) —
		// the arrays still get the swap so they never go stale.
		state.reshapeConfig = {
			...DEFAULT_RESHAPE_CONFIG,
			idFields: ["sales"],
			meltFields: ["gone-a", "gone-b"],
		}
		const next = renameFieldInConfigs(state, fields, "sales", "revenue")
		expect(next.reshapeConfig.idFields).toEqual(["revenue"])
		expect(next.reshapeConfig.meltFields).toBe(state.reshapeConfig.meltFields)
	})
})

describe("renameFieldInConfigs — melted (value-key) rewrite", () => {
	// Wide table: region (ID) + jan/feb (melted). The melt mints
	// "category"/"value"; the wide melt-column NAMES become cell values of
	// "category", so per-value config maps are keyed by them.
	const fields = [c("region"), q("jan"), q("feb")]
	const meltedState = (): Required<FieldNameConfigs> => {
		const state = baseState()
		state.reshapeConfig = {
			...DEFAULT_RESHAPE_CONFIG,
			idFields: ["region"],
			meltFields: ["jan", "feb"],
		}
		return state
	}

	it("renames the value key in maps driven by the variable column", () => {
		const state = meltedState()
		state.encodings = {
			...state.encodings,
			hue: { field: "category" },
			facet: { field: "category" },
		}
		state.channelConfigs = {
			hue: {
				kind: "categorical",
				colors: { jan: "#111", feb: "#222" },
				stackMode: "stack",
			},
			facet: {
				...DEFAULT_FACET_CONFIG,
				panelOrder: { jan: 0, feb: 1 },
			},
		}
		state.fieldLevelOrders = { category: ["feb", "jan"] }
		state.labelsConfig = {
			...DEFAULT_LABELS_CONFIG,
			facetTitleColors: { jan: "#333" },
		}
		state.annotationsConfig = {
			...DEFAULT_ANNOTATIONS_CONFIG,
			rectangles: [
				{ facetKeys: ["jan"] } as never,
				{ facetKeys: ["feb"] } as never,
			],
		}
		const next = renameFieldInConfigs(state, fields, "jan", "January")
		expect(next.channelConfigs.hue).toEqual({
			kind: "categorical",
			colors: { January: "#111", feb: "#222" },
			stackMode: "stack",
		})
		expect(next.channelConfigs.facet?.panelOrder).toEqual({
			January: 0,
			feb: 1,
		})
		expect(next.fieldLevelOrders).toEqual({ category: ["feb", "January"] })
		expect(next.labelsConfig.facetTitleColors).toEqual({ January: "#333" })
		expect(next.annotationsConfig.rectangles[0]).toEqual({
			facetKeys: ["January"],
		})
		// membership array follows too
		expect(next.reshapeConfig.meltFields).toEqual(["January", "feb"])
	})

	it("leaves view-field surfaces alone for a melted rename", () => {
		const state = meltedState()
		// A stale (or minted-name-colliding) encoding reference must NOT be
		// rewritten: the melted column is not a view field.
		state.encodings = { ...state.encodings, y: { field: "jan" } }
		state.fieldTypeOverrides = { jan: "ordinal" }
		const next = renameFieldInConfigs(state, fields, "jan", "January")
		expect(next.encodings).toBe(state.encodings)
		expect(next.fieldTypeOverrides).toBe(state.fieldTypeOverrides)
	})

	it("does not touch value maps driven by a different column", () => {
		const state = meltedState()
		state.encodings = { ...state.encodings, hue: { field: "region" } }
		state.channelConfigs = {
			hue: {
				kind: "categorical",
				// "jan" here is a VALUE of region that happens to collide with
				// the melted column's name — it must survive the rename.
				colors: { jan: "#111" },
				stackMode: "stack",
			},
		}
		const next = renameFieldInConfigs(state, fields, "jan", "January")
		expect(next.channelConfigs).toBe(state.channelConfigs)
	})

	it("an ID-column rename uses the standard rewrite", () => {
		const state = meltedState()
		state.encodings = { ...state.encodings, x: { field: "region" } }
		const next = renameFieldInConfigs(state, fields, "region", "area")
		expect(next.encodings.x.field).toBe("area")
		expect(next.reshapeConfig.idFields).toEqual(["area"])
	})
})
