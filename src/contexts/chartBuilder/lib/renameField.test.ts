import { describe, expect, it } from "vitest"
import {
	DEFAULT_CONNECTION_CONFIG,
	DEFAULT_DATA_LABELS_CONFIG,
	DEFAULT_FACET_CONFIG,
	DEFAULT_REGRESSION_CONFIG,
	DEFAULT_AXIS_CONFIG,
	DEFAULT_LENGTH_CONFIG,
	DEFAULT_SHAPE_CONFIG,
} from "./channelConfig"
import { DEFAULT_ANNOTATIONS_CONFIG } from "./annotationsConfig"
import { DEFAULT_LABELS_CONFIG, DEFAULT_TOOLTIP_CONFIG } from "./labelsConfig"
import {
	fieldRenameError,
	originalFieldName,
	renameDatasetField,
	remapFieldsInConfigs,
	renameFieldInConfigs,
	type FieldNameConfigs,
} from "./renameField"
import { DEFAULT_DERIVED_VARIABLES_CONFIG } from "./derivedVariables"
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
	fieldLevelOrderSpecs: {},
	fieldOrder: [],
	channelConfigs: {},
	labelsConfig: DEFAULT_LABELS_CONFIG,
	dataLabelsConfig: DEFAULT_DATA_LABELS_CONFIG,
	tooltipConfig: DEFAULT_TOOLTIP_CONFIG,
	reshapeConfig: DEFAULT_RESHAPE_CONFIG,
	annotationsConfig: DEFAULT_ANNOTATIONS_CONFIG,
	derivedVariablesConfig: DEFAULT_DERIVED_VARIABLES_CONFIG,
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

	it("renames the field in the visual's column order", () => {
		const state = baseState()
		state.fieldOrder = ["region", "sales"]
		const next = renameFieldInConfigs(state, fields, "sales", "revenue")
		expect(next.fieldOrder).toEqual(["region", "revenue"])
	})

	it("follows the field into the Order-by picker memories", () => {
		const state = baseState()
		state.fieldLevelOrderSpecs = {
			// Keyed by the ordered field, and referencing it as a scope.
			sales: { by: "alphabetical" },
			region: { by: "field", byField: "sales", scopeField: "year" },
			other: { by: "field", byField: "year", scopeLevel: "sales" },
		}
		const next = renameFieldInConfigs(state, fields, "sales", "revenue")
		expect(next.fieldLevelOrderSpecs).toEqual({
			revenue: { by: "alphabetical" },
			region: { by: "field", byField: "revenue", scopeField: "year" },
			// A scope LEVEL is a cell value, not a column — untouched by a
			// column rename even when the strings match.
			other: { by: "field", byField: "year", scopeLevel: "sales" },
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
				flowTargetField: "sales",
				thicknessField: "sales",
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
		expect(next.channelConfigs.connection?.flowTargetField).toBe("revenue")
		expect(next.channelConfigs.connection?.thicknessField).toBe("revenue")
		expect(next.channelConfigs.drawOrder?.field).toBe("revenue")
		expect(next.channelConfigs.colorSlots?.stem?.field).toBe("revenue")
		expect(next.channelConfigs.opacitySlots?.border?.field).toBe("revenue")
		// the untouched slot keeps its identity
		expect(next.channelConfigs.colorSlots?.rug).toBe(
			state.channelConfigs.colorSlots?.rug
		)
	})

	it("follows the field into a mirrored axis's direction field", () => {
		const state = baseState()
		state.channelConfigs = {
			x: {
				...DEFAULT_AXIS_CONFIG,
				mirror: { enabled: true, directionField: "region", positiveMax: 9 },
			},
			y: {
				...DEFAULT_AXIS_CONFIG,
				mirror: { enabled: true, directionField: "other" },
			},
		}
		const next = renameFieldInConfigs(state, fields, "region", "area")
		expect(next.channelConfigs.x?.mirror).toEqual({
			enabled: true,
			directionField: "area",
			positiveMax: 9,
		})
		// The axis whose mirror doesn't use the field keeps its identity.
		expect(next.channelConfigs.y).toBe(state.channelConfigs.y)
		// Nothing mentions the field → whole state unchanged.
		expect(renameFieldInConfigs(state, fields, "sales", "revenue")).toBe(
			state
		)
	})

	it("follows the field into the segment-thickness Vary-by, leaving its value keys", () => {
		const state = baseState()
		state.channelConfigs = {
			length: {
				...DEFAULT_LENGTH_CONFIG,
				segmentThicknessField: "region",
				// Keyed by the field's VALUES — a column rename leaves them be.
				segmentThicknessByValue: { region: 2, east: 4 },
			},
		}
		const next = renameFieldInConfigs(state, fields, "region", "area")
		expect(next.channelConfigs.length?.segmentThicknessField).toBe("area")
		expect(next.channelConfigs.length?.segmentThicknessByValue).toBe(
			state.channelConfigs.length?.segmentThicknessByValue
		)
		expect(renameFieldInConfigs(state, fields, "sales", "revenue")).toBe(
			state
		)
	})

	it("keeps composed labels' identity when none mentions the field", () => {
		const state = baseState()
		state.dataLabelsConfig = {
			...DEFAULT_DATA_LABELS_CONFIG,
			composedLabels: [{ id: "lbl-1", template: "{region}" }],
		}
		expect(renameFieldInConfigs(state, fields, "sales", "revenue")).toBe(
			state
		)
	})

	it("rewrites label templates, per-field formats/colors, and endpoint templates", () => {
		const state = baseState()
		state.dataLabelsConfig = {
			...DEFAULT_DATA_LABELS_CONFIG,
			labelTemplate: "{region}: {sales} ({sales})",
			fieldFormats: { sales: ".1%" },
			fieldColors: { sales: { field: "sales", singleColor: "#000" } },
			fieldColorRules: { sales: [{ condition: "> 0", color: "#fff" }] },
			fieldSizes: { sales: 14 },
			fieldFonts: { sales: { fontWeight: 700 } },
			fieldBackgrounds: { sales: { textBackground: true } },
			fieldAlignments: { sales: "left" },
			fieldOffsets: { sales: { xOffset: 4 } },
			fieldLayers: { sales: "marks" },
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
		expect(next.dataLabelsConfig.fieldColorRules).toEqual({
			revenue: [{ condition: "> 0", color: "#fff" }],
		})
		expect(next.dataLabelsConfig.fieldSizes).toEqual({ revenue: 14 })
		expect(next.dataLabelsConfig.fieldFonts).toEqual({
			revenue: { fontWeight: 700 },
		})
		expect(next.dataLabelsConfig.fieldBackgrounds).toEqual({
			revenue: { textBackground: true },
		})
		expect(next.dataLabelsConfig.fieldAlignments).toEqual({ revenue: "left" })
		expect(next.dataLabelsConfig.fieldLayers).toEqual({ revenue: "marks" })
		expect(next.dataLabelsConfig.fieldOffsets).toEqual({
			revenue: { xOffset: 4 },
		})
		expect(next.dataLabelsConfig.firstLabel?.labelTemplate).toBe(
			"start {revenue}"
		)
		expect(next.dataLabelsConfig.lastLabel?.labelTemplate).toBe(
			"end {revenue}"
		)
	})

	it("renames inside the split-piece map: the label id, the variable, and a slot varying by it", () => {
		const state = baseState()
		state.dataLabelsConfig = {
			...DEFAULT_DATA_LABELS_CONFIG,
			pieces: {
				// A default label's id IS the variable's name.
				sales: { region: { size: 9 }, sales: { font: { fontWeight: 700 } } },
				"lbl-1": {
					sales: { color: { field: "sales", singleColor: "#000" } },
					region: { size: 12 },
				},
			},
		}
		const next = renameFieldInConfigs(state, fields, "sales", "revenue")
		expect(next.dataLabelsConfig.pieces).toEqual({
			revenue: { region: { size: 9 }, revenue: { font: { fontWeight: 700 } } },
			"lbl-1": {
				revenue: { color: { field: "revenue", singleColor: "#000" } },
				region: { size: 12 },
			},
		})
		// Nothing to rename → same reference.
		const untouched = baseState()
		untouched.dataLabelsConfig = {
			...DEFAULT_DATA_LABELS_CONFIG,
			pieces: { "lbl-1": { region: { size: 12 } } },
		}
		expect(
			renameFieldInConfigs(untouched, fields, "sales", "revenue").dataLabelsConfig.pieces
		).toBe(untouched.dataLabelsConfig.pieces)
	})

	it("rewrites {tokens} in every conditional-rule condition", () => {
		const state = baseState()
		state.dataLabelsConfig = {
			...DEFAULT_DATA_LABELS_CONFIG,
			textColorRules: [
				{ condition: "{sales} > 0", color: "#0a0" },
				{ condition: "< 0", color: "#a00" },
			],
			positionRules: [{ condition: "{sales} < 0", xOffset: 0, yOffset: 8 }],
			fieldColorRules: { region: [{ condition: "{sales} >= 5", color: "#fff" }] },
			fieldPositionRules: {
				region: [{ condition: "{sales} != 0", xOffset: 2, yOffset: 0 }],
			},
			pieces: {
				"lbl-1": {
					region: { colorRules: [{ condition: "{sales} == 1", color: "#000" }] },
				},
			},
		}
		state.channelConfigs = {
			shape: {
				...DEFAULT_SHAPE_CONFIG,
				outlineColorRules: [{ condition: "{sales} > 9", color: "#111" }],
			},
			fillColorRules: [{ condition: "{sales} < 0", color: "#222" }],
			x: {
				...DEFAULT_AXIS_CONFIG,
				tickLabelColorRules: [{ condition: "{sales} > 1", color: "#555" }],
			},
			colorSlots: {
				line: {
					field: null,
					singleColor: "#333",
					colorRules: [{ condition: "{sales} == 2", color: "#444" }],
				},
			},
		}
		const next = renameFieldInConfigs(state, fields, "sales", "revenue")
		const dlc = next.dataLabelsConfig
		expect(dlc.textColorRules).toEqual([
			{ condition: "{revenue} > 0", color: "#0a0" },
			{ condition: "< 0", color: "#a00" },
		])
		// An implicit-value rule is untouched — same object.
		expect(dlc.textColorRules?.[1]).toBe(
			state.dataLabelsConfig.textColorRules?.[1]
		)
		expect(dlc.positionRules?.[0].condition).toBe("{revenue} < 0")
		expect(dlc.fieldColorRules?.region[0].condition).toBe("{revenue} >= 5")
		expect(dlc.fieldPositionRules?.region[0].condition).toBe("{revenue} != 0")
		expect(dlc.pieces?.["lbl-1"].region.colorRules?.[0].condition).toBe(
			"{revenue} == 1"
		)
		expect(next.channelConfigs.shape?.outlineColorRules?.[0].condition).toBe(
			"{revenue} > 9"
		)
		expect(next.channelConfigs.fillColorRules?.[0].condition).toBe(
			"{revenue} < 0"
		)
		expect(next.channelConfigs.x?.tickLabelColorRules?.[0].condition).toBe(
			"{revenue} > 1"
		)
		expect(
			next.channelConfigs.colorSlots?.line?.colorRules?.[0].condition
		).toBe("{revenue} == 2")
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

	it("follows a renamed value into a remembered scope LEVEL", () => {
		const state = meltedState()
		state.fieldLevelOrderSpecs = {
			region: { by: "field", byField: "value", scopeField: "category", scopeLevel: "jan" },
			// Scoped to a different variable, so its matching level is a
			// coincidence and stays put.
			jan: { by: "field", byField: "value", scopeField: "region", scopeLevel: "jan" },
		}
		const next = renameFieldInConfigs(state, fields, "jan", "January")
		expect(next.fieldLevelOrderSpecs).toEqual({
			region: {
				by: "field",
				byField: "value",
				scopeField: "category",
				scopeLevel: "January",
			},
			jan: {
				by: "field",
				byField: "value",
				scopeField: "region",
				scopeLevel: "jan",
			},
		})
	})

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

	it("follows a renamed value into a grid panel pair and the grid bounds, on the side that facet drives", () => {
		const state = meltedState()
		state.encodings = {
			...state.encodings,
			facet: { field: null },
			facetRow: { field: "category" },
			facetCol: { field: "region" },
		}
		state.channelConfigs = {
			facet: {
				...DEFAULT_FACET_CONFIG,
				gridPanelAxisOverrides: { jan: { east: { yMin: 1 } }, feb: { jan: { yMin: 2 } } },
			},
		}
		state.annotationsConfig = {
			...DEFAULT_ANNOTATIONS_CONFIG,
			rectangles: [
				// Row side is the melted column's value → moves. Column side is a
				// region that happens to be called "jan" → a coincidence, stays.
				{ facetKeys: [{ row: "jan", col: "jan" }, "jan"] } as never,
			],
		}
		const next = renameFieldInConfigs(state, fields, "jan", "January")
		expect(next.annotationsConfig.rectangles[0]).toEqual({
			facetKeys: [{ row: "January", col: "jan" }, "January"],
		})
		expect(next.channelConfigs.facet?.gridPanelAxisOverrides).toEqual({
			January: { east: { yMin: 1 } },
			feb: { jan: { yMin: 2 } },
		})
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

describe("renameFieldInConfigs — a second Combine group", () => {
	const fields = [c("region"), q("jan"), q("feb"), q("jan_cost"), q("feb_cost")]
	const groupedState = (): Required<FieldNameConfigs> => {
		const state = baseState()
		state.reshapeConfig = {
			...DEFAULT_RESHAPE_CONFIG,
			idFields: ["region"],
			meltFields: ["jan", "feb"],
			extraGroups: [
				{ meltFields: ["jan_cost", "feb_cost"], variableName: "cost of", valueName: "cost" },
			],
		}
		return state
	}

	it("swaps the column in the group that lists it and leaves the other group's reference", () => {
		const state = groupedState()
		const next = renameFieldInConfigs(state, fields, "jan_cost", "january_cost")
		expect(next.reshapeConfig.meltFields).toEqual(["jan", "feb"])
		expect(next.reshapeConfig.extraGroups).toEqual([
			{ meltFields: ["january_cost", "feb_cost"], variableName: "cost of", valueName: "cost" },
		])
		// A rename the extra group doesn't mention keeps its reference.
		const untouched = renameFieldInConfigs(state, fields, "jan", "January")
		expect(untouched.reshapeConfig.extraGroups).toBe(state.reshapeConfig.extraGroups)
	})

	it("renames value keys under the SECOND group's variable column for its melted columns", () => {
		const state = groupedState()
		state.encodings = { ...state.encodings, hue: { field: "cost of" } }
		state.channelConfigs = {
			hue: {
				kind: "categorical",
				colors: { jan_cost: "#111", feb_cost: "#222" },
				stackMode: "stack",
			},
		}
		const next = renameFieldInConfigs(state, fields, "jan_cost", "january_cost")
		expect(next.channelConfigs.hue).toEqual({
			kind: "categorical",
			colors: { january_cost: "#111", feb_cost: "#222" },
			stackMode: "stack",
		})
		// A first-group column renamed while hue maps the SECOND group's
		// variable column is not a value of that column: nothing to rename.
		expect(renameFieldInConfigs(state, fields, "jan", "January").channelConfigs.hue).toEqual({
			kind: "categorical",
			colors: { jan_cost: "#111", feb_cost: "#222" },
			stackMode: "stack",
		})
	})
})

describe("renameFieldInConfigs — derived variables", () => {
	const fields = [q("sales"), c("region")]
	const derivedState = (): Required<FieldNameConfigs> => {
		const state = baseState()
		state.derivedVariablesConfig = {
			variables: [
				{
					id: "dvr-1",
					name: "calc",
					kind: "math",
					math: { formula: "{sales} * 2" },
					concat: { template: "sold: {sales}" },
					rules: {
						rules: [
							{
								condition: "{sales} > 1 AND {region} == \"West\"",
								output: "hi {sales}",
							},
						],
						fallback: "kept {sales}",
					},
				},
			],
		}
		return state
	}

	it("swaps {tokens} in formulas, templates, conditions, outputs, and the fallback", () => {
		const state = derivedState()
		const next = renameFieldInConfigs(state, fields, "sales", "revenue")
		const v = next.derivedVariablesConfig.variables[0]
		expect(v.math?.formula).toBe("{revenue} * 2")
		expect(v.concat?.template).toBe("sold: {revenue}")
		expect(v.rules?.rules[0].condition).toBe(
			'{revenue} > 1 AND {region} == "West"'
		)
		expect(v.rules?.rules[0].output).toBe("hi {revenue}")
		expect(v.rules?.fallback).toBe("kept {revenue}")
	})

	it("rewrites only the payloads that mention the name", () => {
		const state = derivedState()
		const next = renameFieldInConfigs(state, fields, "region", "area")
		// Only the rule condition mentions {region}; the math and concat
		// payloads keep their identity through the rewrite.
		const v = next.derivedVariablesConfig.variables[0]
		expect(v.math).toBe(state.derivedVariablesConfig.variables[0].math)
		expect(v.concat).toBe(state.derivedVariablesConfig.variables[0].concat)
		expect(v.rules?.rules[0].condition).toBe(
			'{sales} > 1 AND {area} == "West"'
		)
	})

	it("leaves derived expressions alone in melted mode", () => {
		const meltFields = [c("region"), q("jan"), q("feb")]
		const state = derivedState()
		state.reshapeConfig = {
			...DEFAULT_RESHAPE_CONFIG,
			idFields: ["region"],
			meltFields: ["jan", "feb"],
		}
		state.derivedVariablesConfig = {
			variables: [
				{
					id: "dvr-1",
					name: "calc",
					kind: "concat",
					// "{jan}" as a token would be a stale reference (jan is not a
					// view column once melted) — it must survive the rename, like
					// every other view-field surface in melted mode.
					concat: { template: "was: {jan}" },
				},
			],
		}
		const next = renameFieldInConfigs(state, meltFields, "jan", "January")
		expect(next.derivedVariablesConfig).toBe(state.derivedVariablesConfig)
	})
})

/** Every string reachable from `value` — object keys included. */
const allStrings = (value: unknown, out: string[] = []): string[] => {
	if (typeof value === "string") out.push(value)
	else if (Array.isArray(value)) for (const v of value) allStrings(v, out)
	else if (value && typeof value === "object")
		for (const [k, v] of Object.entries(value)) {
			out.push(k)
			allStrings(v, out)
		}
	return out
}

describe("remapFieldsInConfigs", () => {
	const fields = [q("sales"), q("cost"), c("region")]

	const richState = () => {
		const state = baseState()
		state.encodings = {
			...state.encodings,
			x: { field: "sales" },
			y: { field: "cost" },
			hue: { field: "region" },
		}
		state.fieldTypeOverrides = { sales: "ordinal" }
		state.fieldOrder = ["sales", "cost", "region"]
		state.dataLabelsConfig = {
			...DEFAULT_DATA_LABELS_CONFIG,
			labelTemplate: "{sales} / {cost}",
			fieldFormats: { sales: ".1%", cost: "$,.0f" },
			textColorRules: [{ condition: "{sales} > {cost}", color: "#0a0" }],
		}
		return state
	}

	it("renames a single field onto a name absent from the data set", () => {
		const next = remapFieldsInConfigs(richState(), fields, {
			sales: "revenue",
		})
		expect(next.encodings.x.field).toBe("revenue")
		expect(next.encodings.y.field).toBe("cost")
		expect(next.fieldTypeOverrides).toEqual({ revenue: "ordinal" })
		expect(next.dataLabelsConfig.fieldFormats).toEqual({
			revenue: ".1%",
			cost: "$,.0f",
		})
	})

	it("swaps two fields cleanly across encodings, per-field maps and rule tokens", () => {
		const state = richState()
		const next = remapFieldsInConfigs(state, fields, {
			sales: "cost",
			cost: "sales",
		})
		expect(next.encodings.x.field).toBe("cost")
		expect(next.encodings.y.field).toBe("sales")
		expect(next.encodings.hue).toBe(state.encodings.hue)
		expect(next.fieldTypeOverrides).toEqual({ cost: "ordinal" })
		expect(next.fieldOrder).toEqual(["cost", "sales", "region"])
		expect(next.dataLabelsConfig.fieldFormats).toEqual({
			cost: ".1%",
			sales: "$,.0f",
		})
		expect(next.dataLabelsConfig.labelTemplate).toBe("{cost} / {sales}")
		expect(next.dataLabelsConfig.textColorRules?.[0].condition).toBe(
			"{cost} > {sales}"
		)
		// Untouched slices keep their identity.
		expect(next.tooltipConfig).toBe(state.tooltipConfig)
	})

	it("rotates three fields", () => {
		const next = remapFieldsInConfigs(richState(), fields, {
			sales: "cost",
			cost: "region",
			region: "sales",
		})
		expect(next.encodings.x.field).toBe("cost")
		expect(next.encodings.y.field).toBe("region")
		expect(next.encodings.hue.field).toBe("sales")
		expect(next.fieldOrder).toEqual(["cost", "region", "sales"])
	})

	it("returns the same reference for an empty or all-identity mapping", () => {
		const state = richState()
		expect(remapFieldsInConfigs(state, fields, {})).toBe(state)
		expect(
			remapFieldsInConfigs(state, fields, { sales: "sales", cost: "cost" })
		).toBe(state)
	})

	it("never leaks a temporary name into the result", () => {
		const state = richState()
		state.channelConfigs = {
			x: {
				...DEFAULT_AXIS_CONFIG,
				mirror: { enabled: true, directionField: "region" },
			},
			length: { ...DEFAULT_LENGTH_CONFIG, segmentThicknessField: "cost" },
		}
		const next = remapFieldsInConfigs(state, fields, {
			sales: "cost",
			cost: "region",
			region: "sales",
		})
		expect(allStrings(next).filter((s) => s.includes("__remap_"))).toEqual(
			[]
		)
		expect(next.channelConfigs.x?.mirror?.directionField).toBe("sales")
		expect(next.channelConfigs.length?.segmentThicknessField).toBe("region")
	})

	it("swaps melted columns' value keys under an applying reshape", () => {
		const wide = [c("region"), q("jan"), q("feb")]
		const state = baseState()
		state.reshapeConfig = {
			...DEFAULT_RESHAPE_CONFIG,
			idFields: ["region"],
			meltFields: ["jan", "feb"],
		}
		state.encodings = { ...state.encodings, hue: { field: "category" } }
		state.channelConfigs = {
			hue: {
				kind: "categorical",
				colors: { jan: "#111", feb: "#222" },
				stackMode: "stack",
			},
		}
		const next = remapFieldsInConfigs(state, wide, { jan: "feb", feb: "jan" })
		expect(next.reshapeConfig.meltFields).toEqual(["feb", "jan"])
		expect(next.channelConfigs.hue).toEqual({
			kind: "categorical",
			colors: { feb: "#111", jan: "#222" },
			stackMode: "stack",
		})
		expect(allStrings(next).filter((s) => s.includes("__remap_"))).toEqual(
			[]
		)
	})

	it("throws when a field already carries the temporary-name prefix", () => {
		expect(() =>
			remapFieldsInConfigs(richState(), [...fields, q("__remap_0__")], {
				sales: "cost",
			})
		).toThrow(/__remap_/)
		expect(() =>
			remapFieldsInConfigs(richState(), fields, { sales: "__remap_1__" })
		).toThrow(/__remap_/)
	})
})
