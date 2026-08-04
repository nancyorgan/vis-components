import { describe, expect, it } from "vitest"

import {
	DEFAULT_AXIS_CONFIG,
	DEFAULT_OPACITY_QUANTITATIVE,
	DEFAULT_SHAPE_CONFIG,
	DEFAULT_TEXT_CONFIG,
	type ChannelConfigs,
} from "./channelConfig"
import {
	angleConfigFromTheme,
	axisConfigFromTheme,
	channelHasCustomization,
	configsFromTheme,
	connectionConfigFromTheme,
	explainChannelCustomization,
	explainLegendCustomization,
	legendConfigFromTheme,
	legendHasCustomization,
	patternConfigFromTheme,
	shapeConfigFromTheme,
	textConfigFromTheme,
} from "./themeConfig"
import { type LegendConfig } from "./labelsConfig"
import type { Theme } from "./types"

const STUB_THEME: Theme = {
	defaultFill: "#ddd",
	defaultRadius: 4,
	defaultOpacity: 0.85,
	defaultShape: 0,
	outlineColor: "#fff",
	outlineWidth: 1,
	titleFontFamily: "system-ui",
	titleFontColor: "#111",
	titlePrimarySize: 20,
	titleSubtitleSize: 14,
	titleSecondarySize: 13,
	textFontFamily: "system-ui",
	textFontSize: 12,
	textFontColor: "#444",
	categoricalPalettes: [{ id: "p1", name: "P1", colors: ["#a", "#b"] }],
	ordinalPalettes: [],
	linearGradients: [],
	divergingGradients: [],
	defaultCategoricalPaletteId: "p1",
	defaultOrdinalPaletteId: "",
	defaultTextPaletteId: null,
	defaultGradientPalette: "viridis",
	patternInkColor: "#000",
	patternBackgroundColor: "#eee",
	gridlineColor: "#ccc",
	gridlineThickness: 1,
	tickmarkColor: "#aaa",
	tickmarkThickness: 1,
	tickmarkLength: 4,
	spineColor: "#aaa",
	spineThickness: 1,
	textEncodingFontFamily: "system-ui",
	textEncodingFontSize: 11,
	textEncodingFontWeight: 500,
	textEncodingColor: "#111",
	distributionOverlayStroke: "#555",
	distributionOverlayFill: "#ccc",
	regressionStroke: "#555",
	regressionCiFill: "#ccc",
	connectionThickness: 2,
	connectionColor: "#888888",
	lengthMin: 4,
	lengthMax: 40,
	angleMin: -180,
	angleMax: 180,
	areaMin: 3,
	areaMax: 18,
	saturationMin: 0.2,
	saturationMax: 1,
	brightnessMin: 0.25,
	brightnessMax: 0.85,
	chartBackgroundColor: null,
	legendBackgroundColor: "#fff",
	legendSwatchColor: "#4f8eda",
	legendSwatchStroke: "#ffffff",
}

const dot = (
	channel: string,
	configs: ChannelConfigs,
	theme: Theme = STUB_THEME,
	fieldMapped = false
) => channelHasCustomization(channel, configs, theme, fieldMapped)

const ALL_CHANNELS = [
	"x",
	"y",
	"r",
	"hue",
	"outlineHue",
	"saturation",
	"brightness",
	"opacity",
	"shape",
	"pattern",
	"area",
	"length",
	"angle",
	"connection",
	"facet",
	"facetRow",
	"facetCol",
	"text",
]

// ── The guardrail ───────────────────────────────────────────────────────────
// A fresh, untouched chart must NEVER light a dot, on any channel, with or
// without a field mapped. This single invariant catches the whole class of bugs
// we kept hitting (incomplete baselines, missing defaults, self-dotting configs)
// the moment any default/builder drifts out of sync — no per-symptom vigilance.
describe("guardrail: a fresh chart shows no dots anywhere", () => {
	const fresh = configsFromTheme(STUB_THEME)
	for (const channel of ALL_CHANNELS) {
		it(`${channel}: untouched → no dot (field unmapped)`, () => {
			expect(dot(channel, fresh, STUB_THEME, false)).toBe(false)
		})
		it(`${channel}: untouched → no dot (field mapped)`, () => {
			expect(dot(channel, fresh, STUB_THEME, true)).toBe(false)
		})
	}

	it("holds for an EMPTY config too (older save with nothing seeded)", () => {
		for (const channel of ALL_CHANNELS) {
			expect(dot(channel, {}, STUB_THEME, false)).toBe(false)
			expect(dot(channel, {}, STUB_THEME, true)).toBe(false)
		}
	})
})

// ── Real edits DO dot, reverting clears ─────────────────────────────────────
describe("genuine edits light the dot; reverting clears it", () => {
	const fresh = configsFromTheme(STUB_THEME)

	it("axis tick count: change dots, revert clears", () => {
		const changed = { ...fresh, x: { ...fresh.x!, tickCount: 9 } }
		expect(dot("x", changed)).toBe(true)
		const reverted = { ...fresh, x: { ...fresh.x!, tickCount: DEFAULT_AXIS_CONFIG.tickCount } }
		expect(dot("x", reverted)).toBe(false)
	})

	it("default fill (Color): change dots", () => {
		expect(dot("hue", { ...fresh, defaultFill: "#ff00ff" })).toBe(true)
	})

	it("per-value fill override (Color): dots", () => {
		const c = {
			...fresh,
			hue: { kind: "categorical", colors: { A: "#f00" }, stackMode: "stack" },
		} as unknown as ChannelConfigs
		expect(dot("hue", c)).toBe(true)
	})

	it("a populated color slot (Color): dots", () => {
		const c = {
			...fresh,
			colorSlots: { line: { field: null, value: "#f00" } },
		} as unknown as ChannelConfigs
		expect(dot("hue", c)).toBe(true)
	})

	it("bar gap (Length): setting dots as its OWN control, clearing to null clears", () => {
		const changed = { ...fresh, length: { ...fresh.length!, barGapPx: 30 } }
		expect(dot("length", changed)).toBe(true)
		// Its own diagnostic label — a set gap must not read as a range edit.
		expect(explainChannelCustomization("length", changed, STUB_THEME, true)).toEqual([
			"bar gap",
		])
		// Cleared back to auto (null) — the dot goes out.
		const cleared = { ...fresh, length: { ...fresh.length!, barGapPx: null } }
		expect(dot("length", cleared)).toBe(false)
	})

	it("default opacity / radius / shape / angle: change dots, default value clears", () => {
		expect(dot("opacity", { ...fresh, defaultOpacity: 0.3 })).toBe(true)
		expect(dot("area", { ...fresh, defaultRadius: 99 })).toBe(true)
		expect(dot("shape", { ...fresh, defaultShape: 3 })).toBe(true)
		expect(dot("angle", { ...fresh, defaultAngle: 45 })).toBe(true)
		// Setting a default scalar to its own default is not a customization.
		expect(dot("angle", { ...fresh, defaultAngle: 0 })).toBe(false)
	})
})

// ── Drift / schema robustness (the recurring phantom class) ─────────────────
describe("no phantom dots from drift or schema evolution", () => {
	const fresh = configsFromTheme(STUB_THEME)

	it("an older shape config missing newer keys is not a phantom", () => {
		const old = {
			...fresh,
			shape: {
				overrides: {},
				outlineColor: STUB_THEME.outlineColor,
				outlineWidth: STUB_THEME.outlineWidth,
			},
		} as unknown as ChannelConfigs
		expect(dot("shape", old)).toBe(false)
	})

	it("an optional boolean absent (predates the field) is not a phantom", () => {
		const yBase = fresh.y as unknown as { distributionOverlay: Record<string, unknown> }
		const yOld = { ...yBase, distributionOverlay: { ...yBase.distributionOverlay } }
		delete yOld.distributionOverlay.showDensityCurve
		expect(dot("y", { ...fresh, y: yOld } as ChannelConfigs)).toBe(false)
	})

	it("a connection slice missing newer fields is not a phantom", () => {
		const partial = { thickness: STUB_THEME.connectionThickness, fill: "line" } as unknown as ChannelConfigs["connection"]
		expect(dot("connection", { ...fresh, connection: partial })).toBe(false)
	})
})

// ── Palette: drift-immune, gated on a hue field ─────────────────────────────
describe("palette pick", () => {
	const twoPal: Theme = {
		...STUB_THEME,
		categoricalPalettes: [
			{ id: "p1", name: "P1", colors: ["#a", "#b"] },
			{ id: "p2", name: "P2", colors: ["#c", "#d"] },
		],
		defaultCategoricalPaletteId: "p1",
	}
	const fresh = configsFromTheme(twoPal)

	it("picking a different palette dots ONLY with a hue field mapped", () => {
		const picked = { ...fresh, categoricalPaletteId: "p2" }
		expect(dot("hue", picked, twoPal, true)).toBe(true)
		expect(dot("hue", picked, twoPal, false)).toBe(false)
	})

	it("the theme default palette is not a pick", () => {
		expect(dot("hue", { ...fresh, categoricalPaletteId: "p1" }, twoPal, true)).toBe(false)
	})

	it("a migration-renamed palette (resolves to the same one) is not a pick", () => {
		// Theme default points at a now-missing id ("migrated"); it resolves to
		// the first palette. A chart that stored that first palette's real id must
		// not read as a pick.
		const migrated: Theme = { ...twoPal, defaultCategoricalPaletteId: "migrated" }
		const m = configsFromTheme(migrated)
		expect(dot("hue", { ...m, categoricalPaletteId: "p1" }, migrated, true)).toBe(false)
	})
})

// ── Connection: scoped to its own controls; cross-menu fields excluded ──────
describe("connection dot is scoped to the Connection dropdown", () => {
	const fresh = configsFromTheme(STUB_THEME)
	const withConn = (patch: Record<string, unknown>) =>
		({ ...fresh, connection: { ...fresh.connection, ...patch } }) as ChannelConfigs

	it("fill polygon (area) dots only with a connection field mapped", () => {
		// With a connection field, checking Fill-polygon is a real change.
		expect(dot("connection", withConn({ fill: "area" }), STUB_THEME, true)).toBe(true)
		// Single-series area (no connection field): fill:"area" is the chart type,
		// the checkbox isn't shown → not a clearable deviation → no dot.
		expect(dot("connection", withConn({ fill: "area" }), STUB_THEME, false)).toBe(false)
		expect(dot("connection", withConn({ fill: "line" }), STUB_THEME, true)).toBe(false)
	})
	it("thickness / point-sampling / axis-stem dot", () => {
		expect(dot("connection", withConn({ thickness: 10.5 }))).toBe(true)
		// point sampling is gated on a mapped connection field (its control only
		// shows then); axis-stem (lollipop) is a scatter control, not gated.
		expect(dot("connection", withConn({ pointSampling: "first-only" }), STUB_THEME, true)).toBe(true)
		expect(dot("connection", withConn({ pointSampling: "first-only" }), STUB_THEME, false)).toBe(false)
		expect(dot("connection", withConn({ axisStem: "x-axis" }))).toBe(true)
	})
	it("radar-only fillPolygon and Opacity-menu fillOpacity do NOT dot Connection", () => {
		expect(dot("connection", withConn({ fillPolygon: true, fillOpacity: 0.25 }))).toBe(false)
	})
	it("outline color (strokeColor) dots the COLOR menu, not Connection", () => {
		const c = withConn({ strokeColor: "#5746dd" })
		expect(dot("connection", c)).toBe(false)
		expect(dot("hue", c)).toBe(true)
	})
})

// ── Faceting is an encoding, never a styling dot ────────────────────────────
describe("facet channels never dot", () => {
	const fresh = configsFromTheme(STUB_THEME)
	it("facet / facetRow / facetCol ignore even a non-default facet config", () => {
		const c = { ...fresh, facet: { rows: 2, cols: null, gapX: 99 } } as unknown as ChannelConfigs
		expect(dot("facet", c)).toBe(false)
		expect(dot("facetRow", c)).toBe(false)
		expect(dot("facetCol", c)).toBe(false)
	})
})

// ── Builders stay in sync with the baseline (drift guard) ───────────────────
describe("per-channel theme builders match the configsFromTheme baseline", () => {
	const baseline = configsFromTheme(STUB_THEME)
	it("shape", () => expect(shapeConfigFromTheme(STUB_THEME)).toEqual(baseline.shape))
	it("text", () => expect(textConfigFromTheme(STUB_THEME)).toEqual(baseline.text))
	it("connection", () =>
		expect(connectionConfigFromTheme(STUB_THEME)).toEqual(baseline.connection))
	it("pattern", () => expect(patternConfigFromTheme(STUB_THEME)).toEqual(baseline.pattern))
	it("angle", () => expect(angleConfigFromTheme(STUB_THEME)).toEqual(baseline.angle))
	it("axis", () => {
		expect(axisConfigFromTheme(STUB_THEME, "x")).toEqual(baseline.x)
		expect(axisConfigFromTheme(STUB_THEME, "y")).toEqual(baseline.y)
		expect(axisConfigFromTheme(STUB_THEME, "r")).toEqual(baseline.r)
	})
	it("the builders genuinely differ from the built-in defaults (bug premise)", () => {
		expect(shapeConfigFromTheme(STUB_THEME).outlineColor).not.toBe(
			DEFAULT_SHAPE_CONFIG.outlineColor
		)
		expect(textConfigFromTheme(STUB_THEME).color).not.toBe(DEFAULT_TEXT_CONFIG.color)
		expect(axisConfigFromTheme(STUB_THEME, "x").tickmarks.color).not.toBe(
			DEFAULT_AXIS_CONFIG.tickmarks.color
		)
	})
})

describe("configsFromTheme", () => {
	it("axis configs inherit theme gridline / tick / spine colors", () => {
		const cfg = configsFromTheme(STUB_THEME)
		expect(cfg.x?.gridlines.color).toBe(STUB_THEME.gridlineColor)
		expect(cfg.x?.tickmarks.color).toBe(STUB_THEME.tickmarkColor)
		expect(cfg.x?.spine.color).toBe(STUB_THEME.spineColor)
		expect(cfg.x?.distributionOverlay.color).toBe(STUB_THEME.distributionOverlayStroke)
	})
	it("text-encoding config inherits theme text-palette colors when an id is set", () => {
		const themed: Theme = { ...STUB_THEME, defaultTextPaletteId: "p1" }
		expect(configsFromTheme(themed).text?.palette).toEqual(["#a", "#b"])
	})
	it("preserves DEFAULT_AXIS_CONFIG fields not driven by theme", () => {
		const cfg = configsFromTheme(STUB_THEME)
		expect(cfg.x?.tickCount).toBe(DEFAULT_AXIS_CONFIG.tickCount)
		expect(cfg.x?.customFormat).toBe(DEFAULT_AXIS_CONFIG.customFormat)
	})
})

describe("legend section changed dot", () => {
	const base = legendConfigFromTheme(STUB_THEME)

	it("a fresh legend (built from the theme) shows no dots", () => {
		expect(explainLegendCustomization(base, STUB_THEME).size).toBe(0)
		expect(legendHasCustomization(base, STUB_THEME)).toBe(false)
	})

	it("an empty config (older save with nothing seeded) shows no dots", () => {
		expect(legendHasCustomization({} as LegendConfig, STUB_THEME)).toBe(false)
	})

	it("changing legend columns lights the properties group (and the section)", () => {
		const groups = explainLegendCustomization({ ...base, columns: 2 }, STUB_THEME)
		expect(groups.has("properties")).toBe(true)
		expect(legendHasCustomization({ ...base, columns: 2 }, STUB_THEME)).toBe(true)
	})

	it("changing the column gap lights the properties group", () => {
		expect(
			explainLegendCustomization({ ...base, columnGap: -10 }, STUB_THEME).has(
				"properties",
			),
		).toBe(true)
	})

	it("hiding a channel lights the shown group", () => {
		expect(
			explainLegendCustomization(
				{ ...base, hidden: { hue: true } },
				STUB_THEME,
			).has("shown"),
		).toBe(true)
	})

	it("a shape-swatch color lights ONLY the shapeSwatch group", () => {
		const groups = explainLegendCustomization(
			{ ...base, shapeLegendFillColor: "#123456" },
			STUB_THEME,
		)
		expect(groups.has("shapeSwatch")).toBe(true)
		expect(groups.has("properties")).toBe(false)
	})

	it("a stale inside coord doesn't dot unless the legend is positioned inside", () => {
		expect(
			explainLegendCustomization(
				{ ...base, position: "right", insideX: 0.5 },
				STUB_THEME,
			).has("properties"),
		).toBe(false)
		expect(
			explainLegendCustomization(
				{ ...base, position: "inside", insideX: 0.5 },
				STUB_THEME,
			).has("properties"),
		).toBe(true)
	})
})

// ── Saturation / brightness carry stackMode (phase 2) ───────────────────────
// The "range" dot must stay independent of stackMode, and a NON-default
// stackMode must light a separate "stacking" dot without a phantom on a fresh
// chart (default/absent stackMode reads as "stack").
describe.each([
	{
		channel: "saturation" as const,
		min: STUB_THEME.saturationMin,
		max: STUB_THEME.saturationMax,
		key: "saturation" as const,
		rangeLabel: "saturation range",
		stackLabel: "saturation stacking",
	},
	{
		channel: "brightness" as const,
		min: STUB_THEME.brightnessMin,
		max: STUB_THEME.brightnessMax,
		key: "brightness" as const,
		rangeLabel: "brightness range",
		stackLabel: "brightness stacking",
	},
])("$channel stackMode dot", ({ channel, min, max, key, rangeLabel, stackLabel }) => {
	const fresh = configsFromTheme(STUB_THEME)

	it("default range (absent slot) → no dot", () => {
		const cfg = { ...fresh, [key]: undefined } as ChannelConfigs
		expect(dot(channel, cfg, STUB_THEME, true)).toBe(false)
	})

	it("range equal to theme, explicit default stackMode 'stack' → no dot", () => {
		const cfg = {
			...fresh,
			[key]: { min, max, stackMode: "stack" },
		} as unknown as ChannelConfigs
		expect(dot(channel, cfg, STUB_THEME, true)).toBe(false)
	})

	it("non-default stackMode 'group' → dots via the stacking label only", () => {
		const cfg = {
			...fresh,
			[key]: { min, max, stackMode: "group" },
		} as unknown as ChannelConfigs
		expect(dot(channel, cfg, STUB_THEME, true)).toBe(true)
		const labels = explainChannelCustomization(channel, cfg, STUB_THEME, true)
		expect(labels).toContain(stackLabel)
		expect(labels).not.toContain(rangeLabel)
	})

	it("a range change alone → dots via the range label, stacking stays off", () => {
		const cfg = {
			...fresh,
			[key]: { min: min + 0.1, max },
		} as unknown as ChannelConfigs
		expect(dot(channel, cfg, STUB_THEME, true)).toBe(true)
		const labels = explainChannelCustomization(channel, cfg, STUB_THEME, true)
		expect(labels).toContain(rangeLabel)
		expect(labels).not.toContain(stackLabel)
	})

	// The min/max + stacking controls only exist while a field is mapped; a
	// leftover config after unmapping is invisible AND unclearable from the
	// panel, so it must not light the dot (same rule as palette picks).
	it("leftover range/stackMode edits with NO field mapped → no dot", () => {
		const cfg = {
			...fresh,
			[key]: { min: min + 0.1, max, stackMode: "group" },
		} as unknown as ChannelConfigs
		expect(dot(channel, cfg, STUB_THEME, false)).toBe(false)
	})
})

// ── Saturation / brightness DEFAULT override (unmapped-only control) ────────
// The override slider only exists while NO field is mapped; the inverse gate
// of the range/stacking dots above.
describe.each([
	{ channel: "saturation" as const, overrideKey: "defaultSaturation" as const },
	{ channel: "brightness" as const, overrideKey: "defaultBrightness" as const },
])("$channel default-override dot", ({ channel, overrideKey }) => {
	const fresh = configsFromTheme(STUB_THEME)

	it("an enabled override dots only while unmapped; turning it off clears", () => {
		const on = { ...fresh, [overrideKey]: 0.7 } as ChannelConfigs
		expect(dot(channel, on, STUB_THEME, false)).toBe(true)
		expect(dot(channel, on, STUB_THEME, true)).toBe(false)
		const off = { ...fresh, [overrideKey]: null } as ChannelConfigs
		expect(dot(channel, off, STUB_THEME, false)).toBe(false)
	})
})

// ── Opacity carries stackMode too (union config; range dot = "opacity scale") ─
// The fresh/empty guardrail above already proves a default opacity shows no dot;
// here we pin that a NON-default stackMode lights "opacity stacking" only, and
// an explicit default "stack" stays clean.
describe("opacity stackMode dot (phase 2)", () => {
	const fresh = configsFromTheme(STUB_THEME)
	const range = {
		kind: "quantitative" as const,
		min: DEFAULT_OPACITY_QUANTITATIVE.min,
		max: DEFAULT_OPACITY_QUANTITATIVE.max,
	}

	it("range equal to default, explicit stackMode 'stack' → no dot", () => {
		const cfg = {
			...fresh,
			opacity: { ...range, stackMode: "stack" },
		} as unknown as ChannelConfigs
		expect(dot("opacity", cfg)).toBe(false)
	})

	it("non-default stackMode 'group' → dots via 'opacity stacking' only", () => {
		const cfg = {
			...fresh,
			opacity: { ...range, stackMode: "group" },
		} as unknown as ChannelConfigs
		expect(dot("opacity", cfg)).toBe(true)
		const labels = explainChannelCustomization("opacity", cfg, STUB_THEME)
		expect(labels).toContain("opacity stacking")
		expect(labels).not.toContain("opacity scale")
	})
})
