import { describe, expect, it } from "vitest"

import {
	ALL_DATASETS,
	CAFE,
	contextFor,
	RATIOS,
} from "../../../../testSupport/chartSpecFixtures"
import type { Visual } from "../types"
import { hydrateVisual } from "../visualDefaults"
import { parseChartEdit } from "./chartSpec"
import { composeChartEdit, composeVisual, type ComposeVisualResult } from "./composeVisual"

const ctx = (datasetId: string, now = 1_700_000_000_000) => ({
	...contextFor(ALL_DATASETS, datasetId),
	now,
})

const ok = (r: ComposeVisualResult): Visual => {
	if (!r.ok) throw new Error(r.errors.map((e) => `${e.path}: ${e.message}`).join("; "))
	return r.visual
}

const errorsOf = (r: ComposeVisualResult) => {
	if (r.ok) throw new Error("expected errors")
	return r.errors
}

const scatter = (): Visual =>
	ok(
		composeVisual(
			{
				datasetId: RATIOS.id,
				folderId: null,
				encodings: { x: "Ratio", y: "Country", hue: "Country" },
				title: "Specialists per primary care physician",
			},
			ctx(RATIOS.id)
		)
	)

const edit = (visual: Visual, input: unknown, step = 1) =>
	composeChartEdit(visual, input, ctx(visual.datasetId ?? "", visual.updatedAt + step))

/** Every slice except the ones named, and the save time. */
const without = (v: Visual, ...keys: string[]) => {
	const copy: Record<string, unknown> = { ...v }
	for (const k of [...keys, "updatedAt"]) delete copy[k]
	return copy
}

describe("editing a chart step by step (the lollipop walkthrough)", () => {
	it("builds the lollipop one instruction at a time", () => {
		const v0 = scatter()

		const v1 = ok(edit(v0, { sort: { Country: { by: "Ratio", decreasing: true } } }))
		expect(v1.fieldLevelOrders?.Country?.[0]).toBe("Greece")
		expect(v1.fieldLevelOrders?.Country?.at(-1)).toBe("Colombia")
		expect(v1.fieldLevelOrderSpecs?.Country).toEqual({
			by: "field",
			byField: "Ratio",
			decreasing: true,
		})

		const v2 = ok(
			edit(v1, {
				colorThreshold: { field: "Ratio", at: 1, below: "#ff8a00", above: "#8e81ee" },
			})
		)
		const hue = v2.channelConfigs.hue
		expect(hue?.kind).toBe("categorical")
		if (hue?.kind !== "categorical") return
		expect(hue.colors.Colombia).toBe("#ff8a00")
		expect(hue.colors.Portugal).toBe("#ff8a00")
		expect(hue.colors.Chile).toBe("#8e81ee")
		expect(hue.colors.Greece).toBe("#8e81ee")

		const v3 = ok(edit(v2, { stems: { axis: "x", at: 1 } }))
		expect(v3.channelConfigs.connection?.axisStem).toBe("custom-x")
		expect(v3.channelConfigs.connection?.axisStemCustomX).toBe(1)

		const v4 = ok(
			edit(v3, {
				annotations: [
					{ kind: "line", x: [1, 1], y: ["Colombia", "Greece"], color: "#0A1E33", thickness: 2 },
					{ kind: "band", x: [0, 1], y: ["Colombia", "Portugal"], color: "#eeeeee" },
				],
			})
		)
		const [line] = v4.annotationsConfig?.lineSegments ?? []
		const [band] = v4.annotationsConfig?.rectangles ?? []
		expect(line).toMatchObject({
			xMin: 1,
			xMax: 1,
			yMin: "Colombia",
			yMax: "Greece",
			coordSystem: "values",
			lineColor: "#0A1E33",
			lineThickness: 2,
			zOrder: "behind",
		})
		expect(band).toMatchObject({
			xMin: 0,
			xMax: 1,
			yMin: "Colombia",
			yMax: "Portugal",
			coordSystem: "values",
			backgroundColor: "#eeeeee",
			zOrder: "behind",
		})
		expect(line?.id).not.toBe(band?.id)

		// Each step kept everything the earlier steps set.
		expect(v4.fieldLevelOrders).toEqual(v1.fieldLevelOrders)
		expect(v4.channelConfigs.hue).toEqual(v2.channelConfigs.hue)
		expect(v4.labelsConfig.title).toBe("Specialists per primary care physician")
		// And the result is complete: a load fills nothing in.
		expect(hydrateVisual(v4)).toEqual(v4)
	})
})

describe("an edit changes only what it names", () => {
	it("a title edit leaves every other slice alone", () => {
		const v0 = scatter()
		const v1 = ok(edit(v0, { title: "New title" }))
		expect(v1.labelsConfig.title).toBe("New title")
		expect(without(v1, "labelsConfig")).toEqual(without(v0, "labelsConfig"))
		expect({ ...v1.labelsConfig, title: v0.labelsConfig.title }).toEqual(v0.labelsConfig)
	})

	it("keeps the name, folder and id, and moves updatedAt forward", () => {
		const v0 = scatter()
		const v1 = ok(edit(v0, { subtitle: "OECD" }))
		expect(v1.id).toBe(v0.id)
		expect(v1.name).toBe(v0.name)
		expect(v1.folderId).toBe(v0.folderId)
		expect(v1.createdAt).toBe(v0.createdAt)
		expect(v1.updatedAt).toBeGreaterThan(v0.updatedAt)
	})

	it("renames and moves when asked", () => {
		const v1 = ok(edit(scatter(), { name: "Lollipop", folderId: "fl-trends" }))
		expect(v1.name).toBe("Lollipop")
		expect(v1.folderId).toBe("fl-trends")
	})

	it("adds annotations to the ones the chart already has", () => {
		const v1 = ok(edit(scatter(), { annotations: [{ kind: "text", x: 2, y: "Chile", text: "a" }] }))
		const v2 = ok(edit(v1, { annotations: [{ kind: "text", x: 3, y: "Spain", text: "b" }] }))
		expect(v2.annotationsConfig?.texts.map((t) => t.text)).toEqual(["a", "b"])
	})

	it("starts from a complete visual even when the stored one lacks slices", () => {
		const full = scatter()
		const legacy = { ...full } as Partial<Visual>
		delete legacy.annotationsConfig
		delete legacy.fieldLevelOrderSpecs
		delete legacy.captionConfig
		const v1 = ok(edit(legacy as Visual, { title: "t" }))
		expect(hydrateVisual(v1)).toEqual(v1)
	})
})

describe("changing encodings", () => {
	it("maps, remaps and unmaps channels", () => {
		const v0 = scatter()
		const v1 = ok(edit(v0, { encodings: { hue: null } }))
		expect(v1.encodings.hue).toEqual({ field: null })
		expect(v1.encodings.x).toEqual({ field: "Ratio" })
		const v2 = ok(edit(v1, { encodings: { hue: "Country" } }))
		expect(v2.encodings.hue).toEqual({ field: "Country" })
	})

	it("switches hue to a gradient for a quantitative field and back", () => {
		const v0 = ok(edit(scatter(), { colors: { Greece: "#123456" } }))
		const v1 = ok(edit(v0, { encodings: { hue: "Ratio" } }))
		expect(v1.channelConfigs.hue?.kind).toBe("quantitative")
		const v2 = ok(edit(v1, { encodings: { hue: "Country" } }))
		const hue = v2.channelConfigs.hue
		expect(hue?.kind).toBe("categorical")
		if (hue?.kind === "categorical") expect(hue.colors.Greece).toBe("#123456")
	})

	it("refuses a conflict and says how to clear it", () => {
		const errors = errorsOf(edit(scatter(), { encodings: { r: "Ratio" } }))
		expect(errors.some((e) => e.path === "encodings.r" && /set "x" and "y" to null to unmap them/.test(e.message))).toBe(true)
	})

	it("refuses unmapping every channel", () => {
		const errors = errorsOf(edit(scatter(), { encodings: { x: null, y: null, hue: null } }))
		expect(errors.map((e) => e.message)).toContain("an edit can't unmap every channel")
	})

	it("clears the line-length fallback when length is unmapped", () => {
		const bars = ok(
			composeVisual(
				{ datasetId: CAFE.id, folderId: null, encodings: { x: "month", length: "muffins" } },
				ctx(CAFE.id)
			)
		)
		const withFallback = { ...bars, channelConfigs: { ...bars.channelConfigs, defaultLength: 12 } }
		const v1 = ok(edit(withFallback, { encodings: { length: null, y: "coffees" } }))
		expect(v1.channelConfigs.defaultLength).toBeNull()
	})
})

describe("edit checks", () => {
	it.each([
		[{ datasetId: "x" }, "datasetId"],
		[{ themeId: "x" }, "themeId"],
		[{ datasetVersionId: "x" }, "datasetVersionId"],
		[{ encodings: { x: "Nope" } }, "encodings.x"],
		[{ sort: { Ratio: { by: "Country" } } }, "sort.Ratio"],
		[{ sort: { Country: { by: "Country" } } }, "sort.Country.by"],
		[{ sort: { Country: { by: "Ratio" } }, order: { Country: ["Chile"] } }, "order.Country"],
		[{ stems: { axis: "y", at: 1 } }, "stems.at"],
		[{ stems: { axis: "z" } }, "stems.axis"],
		[{ colorThreshold: { field: "Country", at: 1, below: "#000", above: "#fff" } }, "colorThreshold.field"],
		[{ colorThreshold: { field: "Ratio", at: 1, below: "red", above: "#fff" } }, "colorThreshold.below"],
		[{ annotations: [{ kind: "band", x: [0, 1], y: ["Atlantis", "Greece"] }] }, "annotations[0].y"],
		[{ annotations: [{ kind: "band", x: ["a", "b"], y: ["Chile", "Greece"] }] }, "annotations[0].x"],
		[{ annotations: [{ kind: "line", x: [1], y: ["Chile", "Greece"] }] }, "annotations[0].x"],
		[{ annotations: [{ kind: "arrow" }] }, "annotations[0].kind"],
		[{ annotations: [{ kind: "text", x: 1, y: "Chile", text: "" }] }, "annotations[0].text"],
		[{ annotations: [{ kind: "band", x: [0, 1], y: ["Chile", "Greece"], opacity: 2 }] }, "annotations[0].opacity"],
		[{ wat: 1 }, "wat"],
	])("%j is refused at %s", (input, path) => {
		const errors = errorsOf(edit(scatter(), input))
		expect(errors.map((e) => e.path)).toContain(path)
	})

	it("refuses stems on a bar chart", () => {
		const bars = ok(
			composeVisual(
				{ datasetId: CAFE.id, folderId: null, encodings: { x: "month", length: "muffins" } },
				ctx(CAFE.id)
			)
		)
		expect(errorsOf(edit(bars, { stems: { axis: "y" } })).map((e) => e.path)).toContain("stems")
	})

	it("refuses a threshold when a hue level straddles it", () => {
		const bars = ok(
			composeVisual(
				{
					datasetId: CAFE.id,
					folderId: null,
					encodings: { x: "month", length: "muffins", hue: "flavor" },
				},
				ctx(CAFE.id)
			)
		)
		const errors = errorsOf(
			edit(bars, { colorThreshold: { field: "muffins", at: 12, below: "#000", above: "#fff" } })
		)
		expect(errors[0]?.message).toMatch(/both sides of 12/)
	})

	it("parses an edit without dataset, folder or encodings", () => {
		expect(parseChartEdit({ title: "t" })).toEqual({ ok: true, edit: { encodings: {}, title: "t" } })
		expect(parseChartEdit({ encodings: { x: null } })).toEqual({
			ok: true,
			edit: { encodings: { x: null } },
		})
	})

	it("refuses a null channel in a create", () => {
		const r = composeVisual(
			{ datasetId: RATIOS.id, folderId: null, encodings: { x: null as unknown as string } },
			ctx(RATIOS.id)
		)
		expect(r.ok).toBe(false)
	})
})

describe("new spec keys in a create", () => {
	it("creates the whole lollipop in one spec", () => {
		const v = ok(
			composeVisual(
				{
					datasetId: RATIOS.id,
					folderId: null,
					encodings: { x: "Ratio", y: "Country", hue: "Country" },
					sort: { Country: { by: "alphabetical" } },
					colorThreshold: { field: "Ratio", at: 1, below: "#ff8a00", above: "#8e81ee" },
					stems: { axis: "x" },
					annotations: [{ kind: "band", x: [0, 1], y: ["Colombia", "Portugal"], front: true, label: "Below 1" }],
				},
				ctx(RATIOS.id)
			)
		)
		expect(v.fieldLevelOrders?.Country?.[0]).toBe("Canada")
		expect(v.channelConfigs.connection?.axisStem).toBe("y-axis")
		expect(v.annotationsConfig?.rectangles[0]).toMatchObject({ zOrder: "front", text: "Below 1" })
		expect(hydrateVisual(v)).toEqual(v)
	})
})

describe("a named family uses its quick-start variation", () => {
	it("a dumbbell connects each category's own points", () => {
		const v = ok(
			composeVisual(
				{
					datasetId: CAFE.id,
					folderId: null,
					family: "dumbbell",
					encodings: { y: "flavor", x: "muffins", hue: "month", shape: "month", area: "coffees" },
				},
				ctx(CAFE.id)
			)
		)
		expect(v.encodings.connection).toEqual({ field: "flavor" })
		expect(v.channelConfigs.connection?.fill).toBe("line")
	})

	it("no family leaves connection unmapped", () => {
		const v = ok(
			composeVisual(
				{
					datasetId: CAFE.id,
					folderId: null,
					encodings: { y: "flavor", x: "muffins", hue: "month" },
				},
				ctx(CAFE.id)
			)
		)
		expect(v.encodings.connection).toEqual({ field: null })
	})

	it("a family whose variations don't fit falls back to plain channels", () => {
		const v = ok(
			composeVisual(
				{ datasetId: RATIOS.id, folderId: null, family: "scatter", encodings: { x: "Ratio", y: "Country" } },
				ctx(RATIOS.id)
			)
		)
		expect(v.encodings.x).toEqual({ field: "Ratio" })
	})
})
