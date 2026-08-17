import { describe, expect, it } from "vitest"

import {
	fontWeightDisplayName,
	fontWeightOptionsFor,
	layerFacetOverride,
	legendChannelHiddenByDefault,
	legendSwatchOutlineColor,
	legendSwatchOutlineWidth,
	legendSwatchShape,
	legendSwatchSize,
	migrateLabelsConfig,
	resolveLegendHidden,
} from "./labelsConfig"

/** Migration regressions on this code path are silent — the user clicks
 *  alignment buttons in a fresh session, sees them work, then reloads
 *  the visual and the alignment is gone. These tests guard against that
 *  by asserting newly-added LabelsConfig fields round-trip through the
 *  migrate function. */
describe("migrateLabelsConfig", () => {
	it("preserves titleAlignments when present on the saved config", () => {
		const out = migrateLabelsConfig({
			title: "My chart",
			subtitle: "",
			xAxisTitle: "",
			yAxisTitle: "",
			legendTitles: {},
			fontOverrides: {},
			titleAlignments: { title: "left", xAxisTitle: "right" },
		})
		expect(out.titleAlignments).toEqual({
			title: "left",
			xAxisTitle: "right",
		})
	})

	it("preserves yAxisTitleHorizontal when present", () => {
		const out = migrateLabelsConfig({
			title: "",
			subtitle: "",
			xAxisTitle: "",
			yAxisTitle: "",
			legendTitles: {},
			fontOverrides: {},
			yAxisTitleHorizontal: true,
		})
		expect(out.yAxisTitleHorizontal).toBe(true)
	})

	it("preserves titleOffsets when present (e.g. facet panel title offset)", () => {
		// Regression: the export/embed path re-hydrates through this migration,
		// so a dropped titleOffsets made offsets vanish in the export preview
		// while the live editor (which never re-migrates) still showed them.
		const out = migrateLabelsConfig({
			title: "",
			subtitle: "",
			xAxisTitle: "",
			yAxisTitle: "",
			legendTitles: {},
			fontOverrides: {},
			titleOffsets: {
				facetPanelTitle: { x: 12, y: -8 },
				facetTitle: { x: 0, y: 4 },
			},
		})
		expect(out.titleOffsets).toEqual({
			facetPanelTitle: { x: 12, y: -8 },
			facetTitle: { x: 0, y: 4 },
		})
	})

	it("preserves titleAngles (facet-title Orientation) through migration", () => {
		const out = migrateLabelsConfig({
			title: "",
			subtitle: "",
			xAxisTitle: "",
			yAxisTitle: "",
			legendTitles: {},
			fontOverrides: {},
			titleAngles: { facetTitle: 90 },
		} as unknown as Parameters<typeof migrateLabelsConfig>[0])
		expect(out.titleAngles).toEqual({ facetTitle: 90 })
		// Its neighbours in the same "newer fields" group DO survive — the drop
		// is specific to titleAngles, not a whole-group regression.
		expect(out.titleAlignments).toEqual({})
		expect(out.titleOffsets).toEqual({})
		expect(out.titleVerticalAlignments).toEqual({})
	})

	it("defaults newer fields to safe values when absent (older saved visuals)", () => {
		// Simulates a visual saved BEFORE titleAlignments / yAxisTitleHorizontal
		// existed — migrate should fill in safe defaults, not leave them
		// undefined and crash downstream readers.
		const out = migrateLabelsConfig({
			title: "Legacy",
			subtitle: "",
			xAxisTitle: "",
			yAxisTitle: "",
			legendTitles: {},
			fontOverrides: {},
		})
		expect(out.titleAlignments).toEqual({})
		expect(out.yAxisTitleHorizontal).toBe(false)
		expect(out.titleOffsets).toEqual({})
	})

	it("returns the full DEFAULT_LABELS_CONFIG shape on null input", () => {
		const out = migrateLabelsConfig(null)
		expect(out.title).toBe("")
		expect(out.titleAlignments).toBeDefined()
		expect(out.yAxisTitleHorizontal).toBe(false)
	})
})

/** The grid-mode column / row facet-title strips layer their per-strip
 *  override on top of the shared `facetTitle` override. The merge has to keep
 *  the shared baseline for any sub-setting the strip hasn't touched — and a
 *  field "reset" surfaces as an explicit `undefined`, which must fall back to
 *  the baseline rather than blanking it. */
describe("layerFacetOverride", () => {
	it("returns undefined when neither side has anything set", () => {
		expect(layerFacetOverride(undefined, undefined)).toBeUndefined()
		expect(layerFacetOverride({}, {})).toBeUndefined()
	})

	it("uses the shared baseline when the strip has no override", () => {
		expect(layerFacetOverride({ weight: 700, size: 16 }, undefined)).toEqual({
			weight: 700,
			size: 16,
		})
	})

	it("layers strip overrides on top of the shared baseline", () => {
		expect(
			layerFacetOverride({ weight: 700, size: 16 }, { size: 20, italic: true })
		).toEqual({ weight: 700, size: 20, italic: true })
	})

	it("treats an explicitly-undefined strip field as 'inherit the baseline'", () => {
		// A field-level reset in the font editor emits `{ ...value, size: undefined }`.
		// That must not wipe the shared baseline's size.
		expect(
			layerFacetOverride({ size: 16, weight: 700 }, { size: undefined })
		).toEqual({ size: 16, weight: 700 })
	})
})

/** The Bold toggle was replaced by a numeric font-weight control. Visuals
 *  saved with the old boolean `bold` flag must keep their bold look by
 *  translating `bold: true` → `weight: 700` on load — in both the base font
 *  and any per-label override — while `bold: false` / absent leaves the
 *  weight unset so the slot keeps its default. */
describe("migrateLabelsConfig bold → weight", () => {
	it("translates a legacy bold base-font flag to weight 700", () => {
		const out = migrateLabelsConfig({
			title: "",
			subtitle: "",
			xAxisTitle: "",
			yAxisTitle: "",
			legendTitles: {},
			fontOverrides: {},
			baseFont: {
				titles: {
					family: "system-ui",
					primarySize: 20,
					subtitleSize: 14,
					secondarySize: 13,
					color: "#111",
					bold: true,
				},
				text: { family: "system-ui", size: 12, color: "#444", bold: false },
			},
		} as unknown as Parameters<typeof migrateLabelsConfig>[0])
		expect(out.baseFont.titles.weight).toBe(700)
		expect((out.baseFont.titles as Record<string, unknown>).bold).toBeUndefined()
		// bold: false leaves weight unset (inherits the slot default).
		expect(out.baseFont.text.weight).toBeUndefined()
	})

	it("translates a legacy bold per-label override to weight 700", () => {
		const out = migrateLabelsConfig({
			title: "",
			subtitle: "",
			xAxisTitle: "",
			yAxisTitle: "",
			legendTitles: {},
			fontOverrides: { title: { bold: true, size: 30 } },
		} as unknown as Parameters<typeof migrateLabelsConfig>[0])
		expect(out.fontOverrides.title).toEqual({ weight: 700, size: 30 })
	})
})

/** Mode-default legend visibility: flow / hierarchy modes declare
 *  `areaHiddenByDefault`, and the resolver folds it into the sparse
 *  `LegendConfig.hidden` map WITHOUT clobbering an explicit user choice.
 *  The Legend renderer and the sidebar panel both read through this, so a
 *  regression here desyncs the chart from its own "Legends shown" toggles. */
describe("resolveLegendHidden", () => {
	it("hides the area legend by default when the mode says so", () => {
		expect(resolveLegendHidden({}, { areaHiddenByDefault: true })).toEqual({
			area: true,
		})
	})

	it("leaves the map untouched when the mode has no default-hidden channels", () => {
		const hidden = { hue: true }
		expect(resolveLegendHidden(hidden, {})).toBe(hidden)
		expect(resolveLegendHidden(hidden, { areaHiddenByDefault: false })).toBe(
			hidden
		)
	})

	it("respects an explicit user choice over the mode default", () => {
		// The user re-checked "Size" in a flow mode: stored `area: false`
		// must survive resolution (that's the whole point of storing false).
		expect(
			resolveLegendHidden({ area: false }, { areaHiddenByDefault: true })
		).toEqual({ area: false })
		expect(
			resolveLegendHidden({ area: true }, { areaHiddenByDefault: true })
		).toEqual({ area: true })
	})

	it("reports the per-channel default so the sidebar can keep the stored map sparse", () => {
		expect(legendChannelHiddenByDefault("area", { areaHiddenByDefault: true })).toBe(
			true
		)
		expect(legendChannelHiddenByDefault("area", {})).toBe(false)
		expect(legendChannelHiddenByDefault("hue", { areaHiddenByDefault: true })).toBe(
			false
		)
	})
})

describe("legendSwatchShape / legendSwatchSize", () => {
	it("resolves per-channel entries for every swatch-shape channel", () => {
		const cfg = {
			swatchShapes: {
				hue: 1,
				pattern: 2,
				opacity: "line",
				saturation: 3,
				brightness: 4,
				rug: "line",
			},
			swatchSizes: { pattern: 9 },
		} as const
		expect(legendSwatchShape(cfg, "pattern")).toBe(2)
		expect(legendSwatchShape(cfg, "opacity")).toBe("line")
		expect(legendSwatchShape(cfg, "saturation")).toBe(3)
		expect(legendSwatchShape(cfg, "brightness")).toBe(4)
		expect(legendSwatchSize(cfg, "pattern")).toBe(9)
	})

	it("untouched channels resolve to the default (null shape / null size)", () => {
		expect(legendSwatchShape({}, "pattern")).toBe(null)
		expect(legendSwatchShape({}, "saturation")).toBe(null)
		expect(legendSwatchSize({}, "opacity")).toBe(null)
	})

	it("hue — and only hue — falls back to the legacy global fields", () => {
		const legacy = { hueLegendSwatchShape: 5, hueLegendSwatchSize: 12 }
		expect(legendSwatchShape(legacy, "hue")).toBe(5)
		expect(legendSwatchSize(legacy, "hue")).toBe(12)
		expect(legendSwatchShape(legacy, "pattern")).toBe(null)
		expect(legendSwatchSize(legacy, "brightness")).toBe(null)
		// A per-channel hue entry supersedes the legacy global.
		expect(
			legendSwatchShape({ ...legacy, swatchShapes: { hue: 0 } }, "hue")
		).toBe(0)
	})
})

describe("legendSwatchOutlineColor / legendSwatchOutlineWidth", () => {
	it("per-channel entries win; unset resolves to null/none", () => {
		const cfg = {
			swatchOutlineColors: { pattern: "#ff0000" },
			swatchOutlineWidths: { pattern: 2 },
		}
		expect(legendSwatchOutlineColor(cfg, "pattern")).toBe("#ff0000")
		expect(legendSwatchOutlineWidth(cfg, "pattern")).toBe(2)
		expect(legendSwatchOutlineColor(cfg, "opacity")).toBe(null)
		expect(legendSwatchOutlineWidth(cfg, "opacity")).toBe(null)
	})

	it("legacy GLOBAL color/width fall back for EVERY channel (pre-per-section visuals)", () => {
		const legacy = { swatchOutlineColor: "#00ff00", swatchOutlineWidth: 3 }
		for (const ch of ["hue", "pattern", "opacity", "saturation", "rug"] as const) {
			expect(legendSwatchOutlineColor(legacy, ch)).toBe("#00ff00")
			expect(legendSwatchOutlineWidth(legacy, ch)).toBe(3)
		}
	})

	it("an explicit per-channel null/0 overrides a set global (reset-to-auto / hide)", () => {
		const cfg = {
			swatchOutlineColor: "#00ff00",
			swatchOutlineWidth: 3,
			swatchOutlineColors: { pattern: null },
			swatchOutlineWidths: { pattern: 0 },
		}
		expect(legendSwatchOutlineColor(cfg, "pattern")).toBe(null)
		expect(legendSwatchOutlineWidth(cfg, "pattern")).toBe(0)
		// Other channels keep the global.
		expect(legendSwatchOutlineColor(cfg, "opacity")).toBe("#00ff00")
		expect(legendSwatchOutlineWidth(cfg, "opacity")).toBe(3)
	})
})

/** The single source of truth for EVERY Weight picker (builder panels and the
 *  theme editor), so all pickers for one family must offer the same list. Two
 *  silent-drift risks it guards: a family whose picker offers a weight the
 *  loaded font can't render (DM Sans clamps 800/900 to 700 — the user picks
 *  "Black" and nothing changes), and a stored weight vanishing from its own
 *  picker after a family switch (blank select, and re-saving loses the value).
 *
 *  NOTE the legacy `bold` flag is NOT this function's business — the
 *  boolean → numeric-weight rule lives in the two *config* builders
 *  (`labelsFromTheme` in themeConfig.ts and `migrateLabelsConfig` here), each
 *  covered by its own tests. By the time a weight reaches this function it is
 *  already numeric, and the function only decides which numbers to OFFER. */
describe("fontWeightOptionsFor", () => {
	const values = (family?: string | null, current?: number | null) =>
		fontWeightOptionsFor(family, current).map((o) => o.value)

	it("a known family returns exactly its per-family weight list", () => {
		// Variable fonts: the full 100–900 ramp.
		expect(values("system-ui, sans-serif")).toEqual([
			100, 200, 300, 400, 500, 600, 700, 800, 900,
		])
		expect(values("Inter, system-ui, sans-serif")).toEqual([
			100, 200, 300, 400, 500, 600, 700, 800, 900,
		])
		// Static fonts that only ship regular + bold.
		expect(values("Georgia, 'Times New Roman', serif")).toEqual([400, 700])
		expect(values("ui-monospace, SFMono-Regular, Menlo, monospace")).toEqual([
			400, 700,
		])
		// DM Sans is loaded as a variable font at wght 300–700; 800/900 would
		// silently clamp, so they must not be offered.
		expect(values("'DM Sans', ui-sans-serif, sans-serif")).toEqual([
			300, 400, 500, 600, 700,
		])
		// DM Mono only ships 300/400/500.
		expect(values("'DM Mono', ui-monospace, monospace")).toEqual([300, 400, 500])
	})

	it("an unknown / missing family falls back to the safe middle range", () => {
		// Older saved configs carry custom stacks we don't recognize; the
		// fallback keeps a usable picker instead of an empty one.
		const FALLBACK = [300, 400, 500, 600, 700]
		expect(values("Comic Sans MS, cursive")).toEqual(FALLBACK)
		expect(values(undefined)).toEqual(FALLBACK)
		expect(values(null)).toEqual(FALLBACK)
		expect(values("")).toEqual(FALLBACK)
	})

	it("a stored weight outside the family's range is added, in sorted position", () => {
		// Saved 900 on Inter, then switched the family to DM Sans: without this
		// the select renders blank and the stored value is lost on next save.
		expect(values("'DM Sans', ui-sans-serif, sans-serif", 900)).toEqual([
			300, 400, 500, 600, 700, 900,
		])
		expect(values("Georgia, 'Times New Roman', serif", 500)).toEqual([
			400, 500, 700,
		])
		expect(values("Comic Sans MS, cursive", 100)).toEqual([
			100, 300, 400, 500, 600, 700,
		])
	})

	it("a stored weight already in the family's range is not duplicated", () => {
		expect(values("'DM Sans', ui-sans-serif, sans-serif", 700)).toEqual([
			300, 400, 500, 600, 700,
		])
		// null / undefined `current` means "nothing stored" — no extra entry.
		expect(values("Georgia, 'Times New Roman', serif", null)).toEqual([400, 700])
		expect(values("Georgia, 'Times New Roman', serif", undefined)).toEqual([
			400, 700,
		])
	})

	it("labels canonical weights by name, and off-ramp weights as bare 'Weight'", () => {
		expect(fontWeightOptionsFor("Georgia, 'Times New Roman', serif")).toEqual([
			{ value: 400, label: "Regular (400)" },
			{ value: 700, label: "Bold (700)" },
		])
		// A non-canonical stored weight (e.g. a variable-font 450) has no name.
		const opts = fontWeightOptionsFor("Georgia, 'Times New Roman', serif", 450)
		expect(opts.map((o) => o.label)).toEqual([
			"Regular (400)",
			"Weight (450)",
			"Bold (700)",
		])
		// Documenting a divergence rather than asserting it's right: the option
		// list says "Weight" for an unnamed value while the display-name helper
		// says the bare number. Both are only reachable via off-ramp weights.
		expect(fontWeightDisplayName(450)).toBe("450")
		expect(fontWeightDisplayName(700)).toBe("Bold")
	})

	it("never mutates the shared per-family list (the source-of-truth arrays)", () => {
		// The append path must copy — mutating would leak the stray weight into
		// every OTHER picker for that family for the rest of the session.
		fontWeightOptionsFor("'DM Mono', ui-monospace, monospace", 900)
		expect(values("'DM Mono', ui-monospace, monospace")).toEqual([300, 400, 500])
	})
})
