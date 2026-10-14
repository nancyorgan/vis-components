import { describe, expect, it } from "vitest"

import {
	ALL_DATASETS,
	CAFE,
	contextFor,
	FOLDER,
	THEME,
	TRENDS,
} from "../../../../testSupport/chartSpecFixtures"
import { getChartMode } from "../chartMode"
import {
	clearLegacyAutoTickLabelAngle,
	VISUALS_VERSION,
	visualsMigrations,
} from "../storage/migrations"
import { configsFromTheme, labelsFromTheme } from "../themeConfig"
import { themeOf } from "../systemThemes"
import { ALL_ENCODING_CHANNELS, type Visual } from "../types"
import { hydrateVisual } from "../visualDefaults"
import { buildDataset } from "../../../../testSupport/fixtures"
import {
	COMPOSED_VISUALS_VERSION,
	composeChartSpec,
	composeVisual,
} from "./composeVisual"

const compose = (input: unknown) => {
	const spec = input as { datasetId?: unknown; datasetVersionId?: unknown }
	return composeChartSpec(
		input,
		contextFor(ALL_DATASETS, spec?.datasetId, spec?.datasetVersionId)
	)
}

const composed = (input: unknown): Visual => {
	const result = compose(input)
	if (!result.ok) {
		throw new Error(`expected a visual, got ${result.errors.map((e) => `${e.path}: ${e.message}`).join("; ")}`)
	}
	return result.visual
}

const errorsOf = (input: unknown) => {
	const result = compose(input)
	if (result.ok) throw new Error("expected the spec to be rejected")
	return result.errors
}

const paths = (input: unknown) => errorsOf(input).map((e) => e.path).sort()

const cafe = (extra: Record<string, unknown> = {}) => ({
	datasetId: CAFE.id,
	folderId: null,
	encodings: { x: "month", length: "muffins", hue: "flavor" },
	...extra,
})

describe("composeVisual — the Trends charts", () => {
	it.each(TRENDS.map((t) => [t.key, t] as const))("%s composes", (_key, t) => {
		const result = composeVisual(t.spec, contextFor(ALL_DATASETS, t.spec.datasetId))
		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.warnings).toEqual([])
		const v = result.visual
		expect(v.id).toBe("vs-spec-test")
		expect(v.folderId).toBe(FOLDER.id)
		expect(v.datasetId).toBe(t.dataset.id)
		expect(v.createdAtVersionId).toBe(t.dataset.latestVersionId)
		expect(v.themeId).toBe(THEME.id)
		expect(v.name).toBe(t.spec.name)
		expect(v.labelsConfig.title).toBe(t.spec.title)
		expect(v.labelsConfig.subtitle).toBe(t.spec.subtitle)
		expect(v.thumbnail).toBeNull()
		expect(v.createdAt).toBe(v.updatedAt)
	})

	it.each(TRENDS.map((t) => [t.key, t] as const))(
		"%s survives a load unchanged",
		(_key, t) => {
			const v = composed(t.spec)
			expect(hydrateVisual(v)).toEqual(v)
		}
	)

	it("targets the current visuals version", () => {
		const update =
			"visuals storage moved past COMPOSED_VISUALS_VERSION: check composeVisual against the new migration steps, then raise it"
		expect(VISUALS_VERSION, update).toBe(COMPOSED_VISUALS_VERSION)
		expect(visualsMigrations.length, update).toBe(COMPOSED_VISUALS_VERSION)
	})

	it.each(TRENDS.map((t) => [t.key, t] as const))(
		"%s is unchanged by the latest migration step and any after it",
		(_key, t) => {
			const v = composed(t.spec)
			const steps = visualsMigrations.slice(COMPOSED_VISUALS_VERSION - 1)
			const migrated = steps.reduce<unknown>((raw, step) => step(raw), [v])
			expect(migrated).toEqual([v])
			expect(clearLegacyAutoTickLabelAngle(v)).toBe(v)
		}
	)

	it.each(TRENDS.map((t) => [t.key, t] as const))(
		"%s maps every channel as { field }, never a bare string",
		(_key, t) => {
			const v = composed(t.spec)
			for (const ch of ALL_ENCODING_CHANNELS) {
				expect(v.encodings[ch], ch).toEqual({
					field: t.spec.encodings[ch as keyof typeof t.spec.encodings] ?? null,
				})
			}
		}
	)

	it.each(TRENDS.map((t) => [t.key, t] as const))(
		"%s gets complete axis configs from the theme, with the spec's bounds on top",
		(_key, t) => {
			const v = composed(t.spec)
			const base = configsFromTheme(themeOf(THEME))
			for (const axis of ["x", "y"] as const) {
				const cfg = v.channelConfigs[axis]
				const want = t.spec.axes?.[axis]
				expect(cfg, axis).toEqual({
					...base[axis],
					...(want?.min !== undefined ? { min: want.min } : {}),
					...(want?.max !== undefined ? { max: want.max } : {}),
					...(want?.format !== undefined ? { customFormat: want.format } : {}),
				})
			}
		}
	)

	it.each(TRENDS.map((t) => [t.key, t] as const))(
		"%s turns its data labels on: position, value and the asked-for look",
		(_key, t) => {
			const v = composed(t.spec)
			const measure = t.spec.encodings.length
			const category = t.spec.encodings.x ?? t.spec.encodings.y
			const horizontal = t.spec.encodings.y !== undefined
			expect(v.dataLabelsEncodings?.value.field).toBe(measure)
			expect(v.dataLabelsEncodings?.x.field).toBe(horizontal ? measure : category)
			expect(v.dataLabelsEncodings?.y.field).toBe(horizontal ? category : measure)
			const labels = t.spec.dataLabels
			if (typeof labels !== "object") throw new Error("fixture has no labels")
			expect(v.dataLabelsConfig?.barLabelPosition).toBe(labels.position)
			expect(v.dataLabelsConfig?.color).toBe(labels.color)
			expect(v.dataLabelsConfig?.fieldFormats).toEqual(
				labels.format && measure ? { [measure]: labels.format } : {}
			)
		}
	)

	it("resolves the Trends encodings to bar modes", () => {
		const modes = TRENDS.map((t) => getChartMode(composed(t.spec).encodings))
		expect(modes).toEqual(["bars-y", "bars-x", "bars-x", "bars-y", "bars-y", "bars-y"])
	})

	it("takes palettes and fonts from the theme, not from the spec", () => {
		const v = composed(TRENDS[0].spec)
		const theme = themeOf(THEME)
		expect(v.channelConfigs.categoricalPalette).toEqual(
			configsFromTheme(theme).categoricalPalette
		)
		expect(v.labelsConfig.baseFont).toEqual(labelsFromTheme(theme).baseFont)
	})

	it("writes the spec's colors, stack mode, fill, orders and axis titles", () => {
		const [t1, t2, , t4] = TRENDS
		const v1 = composed(t1.spec)
		expect(v1.channelConfigs.hue).toEqual({
			kind: "categorical",
			colors: t1.spec.colors,
			stackMode: "stack",
		})
		expect(v1.fieldLevelOrders).toEqual(t1.spec.order)
		expect(v1.labelsConfig.xAxisTitle).toBe("Percent of Americans (%)")
		expect(v1.labelsConfig.yAxisTitle).toBeUndefined()
		const v2 = composed(t2.spec)
		expect(v2.channelConfigs.hue?.stackMode).toBe("group")
		const v4 = composed(t4.spec)
		expect(v4.channelConfigs.defaultFill).toBe(t4.spec.fill)
		expect(v4.channelConfigs.hue).toBeUndefined()
	})

	it("stamps the pinned version when the spec names one", () => {
		const v = composed(cafe({ datasetVersionId: CAFE.latestVersionId }))
		expect(v.createdAtVersionId).toBe(CAFE.latestVersionId)
	})

	it("names an untitled spec after its title, else Untitled", () => {
		expect(composed(cafe({ title: "Muffins" })).name).toBe("Muffins")
		expect(composed(cafe({ name: "   ", title: " Muffins " })).name).toBe("Muffins")
		expect(composed(cafe()).name).toBe("Untitled")
	})

	it("reads fields named like Object.prototype members as fields", () => {
		const dataset = buildDataset({
			id: "ds-proto",
			fields: [
				{ name: "constructor", inferredType: "categorical" },
				{ name: "toString", inferredType: "quantitative" },
			],
			rows: [
				{ constructor: "a", toString: "1" },
				{ constructor: "b", toString: "2" },
			],
		})
		const result = composeChartSpec(
			{
				datasetId: dataset.id,
				folderId: null,
				encodings: { x: "constructor", length: "toString" },
			},
			contextFor([dataset], dataset.id)
		)
		expect(result.ok).toBe(true)
	})

	it("accepts a format on a quantitative axis and on the measure axis", () => {
		expect(compose(cafe({ axes: { y: { format: ".1f" } } })).ok).toBe(true)
		expect(
			compose(cafe({ encodings: { x: "coffees", y: "muffins" }, axes: { x: { format: ".0f" } } })).ok
		).toBe(true)
	})

	it("applies field-type overrides before checking channels", () => {
		const v = composed(
			cafe({
				encodings: { x: "muffins", length: "coffees" },
				fieldTypes: { muffins: "ordinal" },
			})
		)
		expect(v.fieldTypeOverrides).toEqual({ muffins: "ordinal" })
	})

	it("seeds a quantitative hue from the theme gradient", () => {
		const v = composed(
			cafe({ encodings: { x: "month", y: "flavor", hue: "muffins" } })
		)
		expect(v.channelConfigs.hue?.kind).toBe("quantitative")
	})

	it("warns when a fill is set but hue colors the marks", () => {
		const result = compose(cafe({ fill: "#123456" }))
		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.warnings.map((w) => w.path)).toEqual(["fill"])
	})
})

describe("composeChartSpec — rejected specs", () => {
	it("rejects a misspelled field and names the real one (the Month toy)", () => {
		const errors = errorsOf(cafe({ encodings: { x: "Month", length: "muffins" } }))
		expect(errors.map((e) => e.path)).toEqual(["encodings.x"])
		expect(errors[0].message).toMatch(/"month"/)
	})

	it("rejects a missing field", () => {
		expect(paths(cafe({ encodings: { x: "week", length: "muffins" } }))).toEqual([
			"encodings.x",
		])
	})

	it("rejects an unknown dataset", () => {
		expect(paths(cafe({ datasetId: "ds-nope" }))).toEqual(["datasetId"])
	})

	it("rejects a version that isn't one of the dataset's", () => {
		expect(paths(cafe({ datasetVersionId: "dv-nope" }))).toEqual([
			"datasetVersionId",
		])
	})

	it("rejects an unknown folder", () => {
		expect(paths(cafe({ folderId: "fl-nope" }))).toEqual(["folderId"])
	})

	it("rejects a theme the caller didn't resolve", () => {
		expect(paths(cafe({ themeId: "theme-nope" }))).toEqual(["themeId"])
	})

	it("rejects a color for a level the data doesn't have", () => {
		const errors = errorsOf(cafe({ colors: { Lemon: "#ff0", Pistachio: "#0f0" } }))
		expect(errors.map((e) => e.path)).toEqual(["colors.Pistachio"])
	})

	it("rejects colors without a categorical hue", () => {
		expect(
			paths(cafe({ encodings: { x: "month", length: "muffins" }, colors: { Lemon: "#ff0" } }))
		).toEqual(["colors"])
		expect(
			paths(
				cafe({
					encodings: { x: "month", y: "flavor", hue: "muffins" },
					colors: { "10": "#ff0" },
				})
			)
		).toEqual(["colors"])
	})

	it("rejects a stack mode without hue", () => {
		expect(
			paths(cafe({ encodings: { x: "month", length: "muffins" }, stack: "group" }))
		).toEqual(["stack"])
	})

	it("rejects a field type the channel can't take", () => {
		expect(
			paths(cafe({ encodings: { x: "month", length: "muffins", facet: "coffees" } }))
		).toEqual(["encodings.facet"])
	})

	it("rejects conflicting channels", () => {
		expect(
			paths(cafe({ encodings: { x: "month", length: "muffins", shape: "flavor" } }))
		).toEqual(["encodings.shape"])
	})

	it("rejects a family the encodings don't make", () => {
		const errors = errorsOf(cafe({ family: "pie" }))
		expect(errors.map((e) => e.path)).toEqual(["family"])
		expect(errors[0].message).toMatch(/bars-x/)
	})

	it("rejects bounds on a categorical axis", () => {
		expect(paths(cafe({ axes: { x: { min: 0 } } }))).toEqual(["axes.x.min"])
	})

	it("rejects a format on a categorical axis", () => {
		expect(paths(cafe({ axes: { x: { format: ".0f" } } }))).toEqual(["axes.x.format"])
	})

	it("rejects a field type override no value in the column can satisfy", () => {
		expect(
			paths(
				cafe({
					encodings: { x: "month", y: "muffins" },
					fieldTypes: { month: "quantitative" },
				})
			)
		).toEqual(["fieldTypes.month"])
		expect(paths(cafe({ fieldTypes: { flavor: "temporal" } }))).toEqual([
			"fieldTypes.flavor",
		])
	})

	it("accepts an override the converted cells satisfy", () => {
		const dataset = buildDataset({
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
		const result = composeChartSpec(
			{
				datasetId: dataset.id,
				folderId: null,
				encodings: { x: "store", length: "sales" },
				fieldTypes: { sales: "quantitative" },
			},
			contextFor([dataset], dataset.id)
		)
		expect(result.ok).toBe(true)
	})

	it("accepts bounds on the measure axis and on a quantitative axis", () => {
		expect(compose(cafe({ axes: { y: { min: 0, max: 30 } } })).ok).toBe(true)
		expect(
			compose(
				cafe({ encodings: { x: "coffees", y: "muffins" }, axes: { x: { max: 60 } } })
			).ok
		).toBe(true)
	})

	it("rejects an order that isn't a permutation of the levels", () => {
		expect(paths(cafe({ order: { flavor: ["Lemon", "Bran"] } }))).toEqual([
			"order.flavor",
		])
		expect(
			paths(cafe({ order: { flavor: ["Lemon", "Bran", "Blueberry", "Mint"] } }))
		).toEqual(["order.flavor"])
	})

	it("rejects an order for a field that doesn't exist", () => {
		expect(paths(cafe({ order: { flavour: ["Lemon"] } }))).toEqual([
			"order.flavour",
		])
	})

	it("rejects data labels the chart can't place", () => {
		expect(
			paths(cafe({ encodings: { x: "month", angle: "muffins" }, dataLabels: true }))
		).toEqual(["dataLabels"])
		expect(
			paths(
				cafe({
					encodings: { x: "coffees", y: "muffins" },
					dataLabels: { position: "outside-end" },
				})
			)
		).toEqual(["dataLabels.position"])
	})

	it("rejects field types for fields that don't exist", () => {
		expect(paths(cafe({ fieldTypes: { week: "ordinal" } }))).toEqual([
			"fieldTypes.week",
		])
	})

	it("rejects a malformed body before looking anything up", () => {
		expect(paths(cafe({ colour: "#fff" }))).toEqual(["colour"])
	})

	it("reports structural and data faults together", () => {
		expect(
			paths({
				datasetId: CAFE.id,
				folderId: "fl-nope",
				encodings: { x: "Month", colour: "flavor", length: "muffins" },
				title: 3,
				colors: { Lemon: "#GGG", Pistachio: "#00ff00" },
				family: "bars",
				order: { flavor: ["Lemon"] },
			})
		).toEqual(
			[
				"colors",
				"colors.Lemon",
				"encodings.colour",
				"encodings.x",
				"family",
				"folderId",
				"order.flavor",
				"title",
			].sort()
		)
	})
})
