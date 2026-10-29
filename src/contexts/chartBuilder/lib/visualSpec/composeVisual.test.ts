import { describe, expect, it } from "vitest"

import { CAFE, contextFor, DATES, FOLDER, THEME } from "../../../../testSupport/chartSpecFixtures"
import { buildDataset } from "../../../../testSupport/fixtures"
import { getChartMode } from "../chartMode"
import { buildQuantHueConfigFromTheme } from "../hueDefaults"
import {
	clearLegacyAutoTickLabelAngle,
	VISUALS_VERSION,
	visualsMigrations,
} from "../storage/migrations"
import { themeOf } from "../systemThemes"
import { configsFromTheme, labelsFromTheme } from "../themeConfig"
import { ALL_ENCODING_CHANNELS, type Visual } from "../types"
import { hydrateVisual } from "../visualDefaults"
import { MAX_PROBLEMS } from "./chartSpec"
import { composeChartEdit, composeChartSpec } from "./composeVisual"

const DATASETS = [CAFE, DATES]

const compose = (input: unknown) =>
	composeChartSpec(input, contextFor(DATASETS, (input as { datasetId?: unknown })?.datasetId))

const composed = (input: unknown): Visual => {
	const result = compose(input)
	if (!result.ok) {
		throw new Error(result.errors.map((e) => `${e.path}: ${e.message}`).join("; "))
	}
	return result.visual
}

const paths = (input: unknown) => {
	const result = compose(input)
	return result.ok ? [] : result.errors.map((e) => e.path).sort()
}

const cafe = (extra: Record<string, unknown> = {}) => ({
	datasetId: CAFE.id,
	folderId: null,
	encodings: { x: "month", length: "muffins", hue: "flavor" },
	...extra,
})

describe("composeChartSpec", () => {
	it("makes the visual a new chart would be, with the spec's choices", () => {
		const v = composed(
			cafe({ folderId: FOLDER.id, title: "Muffins", subtitle: "Q1", axes: { x: { title: "Month" } } })
		)
		const theme = themeOf(THEME)
		expect(v).toMatchObject({
			id: "vs-spec-test",
			name: "Muffins",
			folderId: FOLDER.id,
			datasetId: CAFE.id,
			createdAtVersionId: CAFE.latestVersionId,
			themeId: THEME.id,
			thumbnail: null,
			createdAt: 1_700_000_000_000,
			updatedAt: 1_700_000_000_000,
		})
		expect(v.labelsConfig).toEqual({
			...labelsFromTheme(theme),
			title: "Muffins",
			subtitle: "Q1",
			xAxisTitle: "Month",
		})
		expect(v.channelConfigs.categoricalPalette).toEqual(configsFromTheme(theme).categoricalPalette)
		expect(getChartMode(v.encodings)).toBe("bars-x")
		for (const ch of ALL_ENCODING_CHANNELS) {
			const want = { x: "month", length: "muffins", hue: "flavor" }[ch as string] ?? null
			expect(v.encodings[ch], ch).toEqual({ field: want })
		}
	})

	it("survives a load unchanged", () => {
		const v = composed(cafe())
		expect(hydrateVisual(v)).toEqual(v)
	})

	// Composed charts are already in the current shape: no migration step
	// from the version the composer was written against onward may change
	// one. A new step that does is the cue to update compose.
	const COMPOSER_BASELINE = 6
	it.each([
		["bar", cafe({ family: "bar", stack: "group" })],
		["line", cafe({ family: "line", encodings: { x: "month", y: "muffins", connection: "flavor" } })],
		["tile", cafe({ family: "tile", encodings: { x: "month", y: "flavor", hue: "muffins" } })],
	])("a %s chart is unchanged by every migration step since the baseline", (_key, spec) => {
		const v = composed(spec)
		expect(visualsMigrations).toHaveLength(VISUALS_VERSION)
		visualsMigrations.slice(COMPOSER_BASELINE - 1).forEach((step, i) => {
			expect(step([v]), `step to v${COMPOSER_BASELINE + i}`).toEqual([v])
		})
		expect(clearLegacyAutoTickLabelAngle(v)).toBe(v)
	})

	it("names the chart after its title, else Untitled", () => {
		expect(composed(cafe({ name: "   ", title: " Muffins " })).name).toBe("Muffins")
		expect(composed(cafe()).name).toBe("Untitled")
	})

	it("stacks or groups the hue levels, and seeds a quantitative hue from the theme", () => {
		expect(composed(cafe({ stack: "group" })).channelConfigs.hue?.stackMode).toBe("group")
		const tile = composed(cafe({ encodings: { x: "month", y: "flavor", hue: "muffins" } }))
		expect(tile.channelConfigs.hue).toEqual(buildQuantHueConfigFromTheme(themeOf(THEME)))
	})

	it("seeds an outline color as the Outline color panel does", () => {
		const quant = composed(cafe({ encodings: { x: "month", y: "muffins", outlineHue: "coffees" } }))
		expect(quant.channelConfigs.outlineHue).toEqual(buildQuantHueConfigFromTheme(themeOf(THEME)))
		const cat = composed(cafe({ encodings: { x: "month", y: "muffins", outlineHue: "flavor" } }))
		expect(cat.channelConfigs.outlineHue).toBeUndefined()
	})

	it("keeps a named variation's stack mode unless the spec sets one", () => {
		const grouped = cafe({ family: "bar", variation: "Vertical grouped bars" })
		expect(composed(grouped).channelConfigs.hue?.stackMode).toBe("group")
		expect(composed({ ...grouped, stack: "stack" }).channelConfigs.hue?.stackMode).toBe("stack")
		const overlay = composed(
			cafe({
				family: "area",
				variation: "Overlay area",
				encodings: { x: "month", length: "muffins", connection: "flavor", hue: "flavor" },
			})
		)
		expect(overlay.channelConfigs.hue?.stackMode).toBe("overlay")
	})

	it("refuses a density curve with the other axis mapped", () => {
		const density = (encodings: Record<string, string>) => cafe({ family: "density", encodings })
		expect(composed(density({ x: "muffins" })).channelConfigs.x?.distributionOverlay?.showDensityCurve).toBe(true)
		const result = compose(density({ x: "muffins", y: "coffees" }))
		expect(result.ok ? [] : result.errors.map((e) => e.path)).toEqual(["encodings.y"])
		expect(result.ok ? "" : result.errors[0]?.message).toMatch(/density curve .*"y" must be left out/)
	})

	it("takes a family's best-fitting variation, or the one named", () => {
		const line = composed(cafe({ family: "line", encodings: { x: "month", y: "muffins", connection: "flavor" } }))
		expect(line.channelConfigs.connection?.fill).toBe("line")
		expect(getChartMode(line.encodings)).toBe("scatter")
		expect(paths(cafe({ family: "bar", variation: "Bubble" }))).toEqual(["variation"])
		expect(paths(cafe({ family: "scatter", variation: "Bubble" }))).toEqual(["variation"])
	})

	it("applies field-type overrides before checking channels", () => {
		const v = composed(cafe({ encodings: { x: "muffins", length: "coffees" }, fieldTypes: { muffins: "ordinal" } }))
		expect(v.fieldTypeOverrides).toEqual({ muffins: "ordinal" })
	})

	it("accepts an override the converted cells satisfy, and refuses one none do", () => {
		const money = buildDataset({
			id: "ds-money",
			fields: [
				{ name: "store", inferredType: "categorical" },
				{ name: "sales", inferredType: "categorical" },
			],
			rows: [
				{ store: "a", sales: "$1,200" },
				{ store: "b", sales: "$950" },
			],
		})
		const spec = { datasetId: money.id, folderId: null, encodings: { x: "store", length: "sales" } }
		expect(composeChartSpec({ ...spec, fieldTypes: { sales: "quantitative" } }, contextFor([money], money.id)).ok).toBe(true)
		expect(paths(cafe({ fieldTypes: { flavor: "temporal" } }))).toEqual(["fieldTypes.flavor"])
	})

	it("reads fields named like Object.prototype members as fields", () => {
		const proto = buildDataset({
			id: "ds-proto",
			fields: [
				{ name: "constructor", inferredType: "categorical" },
				{ name: "toString", inferredType: "quantitative" },
			],
			rows: [{ constructor: "a", toString: "1" }],
		})
		const spec = { datasetId: proto.id, folderId: null, encodings: { x: "constructor", length: "toString" } }
		expect(composeChartSpec(spec, contextFor([proto], proto.id)).ok).toBe(true)
	})

	it("writes axis bounds and formats, dates as local midnight", () => {
		const v = composed(cafe({ axes: { y: { min: 0, max: 30, format: ",.0f" }, x: { format: "literal" } } }))
		expect(v.channelConfigs.y).toEqual({ ...configsFromTheme(themeOf(THEME)).y, min: 0, max: 30, customFormat: ",.0f" })
		expect(v.channelConfigs.x?.customFormat).toBe("literal")
		const line = composed({ datasetId: DATES.id, folderId: null, encodings: { x: "day", y: "n" }, axes: { x: { min: "2026-01" } } })
		expect(line.channelConfigs.x?.min).toBe(new Date(2026, 0, 1).getTime())
	})
})

describe("composeChartSpec, refused", () => {
	it("names the real field for a misspelled one", () => {
		const result = compose(cafe({ encodings: { x: "Month", length: "muffins" } }))
		expect(result.ok ? [] : result.errors).toEqual([
			{ path: "encodings.x", message: `no field "Month" in dataset "ds-cafe"; did you mean "month"?` },
		])
	})

	it("refuses an unknown dataset, folder, theme or field-type field", () => {
		expect(paths(cafe({ datasetId: "ds-nope" }))).toEqual(["datasetId"])
		expect(paths(cafe({ folderId: "fl-nope", themeId: "theme-nope", fieldTypes: { week: "ordinal" } }))).toEqual([
			"fieldTypes.week",
			"folderId",
			"themeId",
		])
	})

	it("lists the caller's themes when the spec names none of them", () => {
		const result = composeChartSpec(cafe({ themeId: "theme-nope" }), {
			...contextFor(DATASETS, CAFE.id),
			themes: [{ id: THEME.id, name: THEME.name }],
		})
		expect(result.ok ? [] : result.errors).toEqual([
			{ path: "themeId", message: `no theme with id or name "theme-nope" (themes: "${THEME.name}" (${THEME.id}))` },
		])
	})

	it("refuses a type a channel can't take, conflicting channels and a stack without hue", () => {
		expect(paths(cafe({ encodings: { x: "month", length: "muffins", facet: "coffees" } }))).toEqual(["encodings.facet"])
		expect(paths(cafe({ encodings: { x: "month", length: "muffins", shape: "flavor" } }))).toEqual(["encodings.shape"])
		expect(paths(cafe({ encodings: { x: "month", length: "muffins" }, stack: "group" }))).toEqual(["stack"])
	})

	it("refuses a family the encodings don't make, saying what it needs", () => {
		const result = compose(cafe({ family: "pie" }))
		expect(result.ok ? [] : result.errors.map((e) => e.path)).toEqual(["family"])
		expect(result.ok ? "" : result.errors[0]?.message).toMatch(/^a "pie" chart needs .*"bars-x" chart$/)
	})

	it("refuses bounds an axis can't take", () => {
		expect(paths(cafe({ axes: { x: { min: 0 } } }))).toEqual(["axes.x.min"])
		expect(paths(cafe({ axes: { y: { min: "2020" } } }))).toEqual(["axes.y.min"])
		const dates = { datasetId: DATES.id, folderId: null, encodings: { x: "day", length: "n" } }
		expect(paths({ ...dates, axes: { x: { min: "2026" } } })).toEqual(["axes.x.min"])
		expect(paths({ ...dates, encodings: { x: "day", y: "n" }, axes: { x: { min: 2026 } } })).toEqual(["axes.x.min"])
	})

	it("reports shape and data problems together, capped", () => {
		expect(
			paths({
				datasetId: CAFE.id,
				folderId: "fl-nope",
				encodings: { x: "Month", colour: "flavor", length: "muffins" },
				title: 3,
				family: "bars",
			})
		).toEqual(["encodings.colour", "encodings.x", "family", "folderId", "title"])
		const junk = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`k${i}`, 0]))
		const result = compose(cafe(junk))
		expect(result.ok ? [] : result.errors).toHaveLength(MAX_PROBLEMS + 1)
	})
})

describe("composeChartEdit", () => {
	const ctx = { ...contextFor(DATASETS, CAFE.id), now: 1_700_000_000_500 }
	const base = () => ({ ...composed(cafe({ title: "Muffins", axes: { y: { min: 0 } } })), updatedBy: { id: "jane", name: "Jane" } })
	const edited = (visual: Visual, edit: unknown): Visual => {
		const result = composeChartEdit(visual, edit, ctx)
		if (!result.ok) throw new Error(result.errors.map((e) => `${e.path}: ${e.message}`).join("; "))
		return result.visual
	}
	const editPaths = (visual: Visual, edit: unknown) => {
		const result = composeChartEdit(visual, edit, ctx)
		return result.ok ? [] : result.errors.map((e) => e.path).sort()
	}

	it("changes only what the edit names", () => {
		const v0 = base()
		const v1 = edited(v0, { title: "Muffins sold" })
		expect(v1).toEqual({
			...v0,
			labelsConfig: { ...v0.labelsConfig, title: "Muffins sold" },
			updatedAt: ctx.now,
		})
	})

	it("unmaps a channel with null and maps a new one", () => {
		const v1 = edited(base(), { encodings: { hue: null, facet: "flavor" } })
		expect(v1.encodings.hue).toEqual({ field: null })
		expect(v1.encodings.facet).toEqual({ field: "flavor" })
		expect(v1.encodings.x).toEqual({ field: "month" })
		expect(editPaths(base(), { encodings: { x: null, length: null, hue: null } })).toEqual(["encodings"])
	})

	it("swaps the hue config when the hue field changes kind, keeping the old one", () => {
		const v0 = base()
		const v1 = edited(v0, { encodings: { x: "month", y: "flavor", length: null, hue: "coffees" } })
		expect(v1.channelConfigs.hue).toEqual(buildQuantHueConfigFromTheme(themeOf(THEME)))
		expect(v1.channelConfigs.hueCategoricalStash).toEqual(v0.channelConfigs.hue)
		expect(edited(v0, { stack: "group" }).channelConfigs.hue?.stackMode).toBe("group")
	})

	it("clears a bound with null and refuses one crossing the bound already set", () => {
		expect(edited(base(), { axes: { y: { min: null } } }).channelConfigs.y?.min).toBeUndefined()
		const result = composeChartEdit(base(), { axes: { y: { max: -1 } } }, ctx)
		expect(result.ok ? [] : result.errors).toEqual([
			{ path: "axes.y.max", message: `"max" (-1) must be above "min" (0), which the chart already has` },
		])
	})

	it("checks fields against the data as the editor shows it, reshape included", () => {
		const reshaped: Visual = {
			...base(),
			reshapeConfig: { idFields: ["month", "flavor"], meltFields: ["muffins", "coffees"], variableName: "item", valueName: "sold" },
		}
		expect(edited(reshaped, { encodings: { length: "sold", hue: "item" } }).encodings.length).toEqual({ field: "sold" })
		expect(editPaths(base(), { encodings: { length: "sold" } })).toEqual(["encodings.length"])
	})

	it("refuses a family the chart doesn't make and a dataset that is gone", () => {
		expect(editPaths(base(), { family: "pie" })).toEqual(["family"])
		const result = composeChartEdit(base(), { title: "x" }, { ...ctx, dataset: null })
		expect(result.ok ? [] : result.errors.map((e) => e.path)).toEqual([""])
	})
})
