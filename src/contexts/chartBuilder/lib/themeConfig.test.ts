import { describe, expect, it } from "vitest"

import {
	DEFAULT_AXIS_CONFIG,
	DEFAULT_CHORD_AXIS_CONFIG,
	DEFAULT_DATA_LABELS_CONFIG,
	DEFAULT_OPACITY_QUANTITATIVE,
	DEFAULT_SHAPE_CONFIG,
	DEFAULT_TEXT_CONFIG,
	type ChannelConfigs,
} from "./channelConfig"
import {
	DEFAULT_BOX_ANNOTATION_STYLE,
	DEFAULT_LINE_ANNOTATION_STYLE,
	DEFAULT_RECTANGLE_TEXT,
	newCircle,
	newLineSegment,
	newRectangle,
} from "./annotationsConfig"
import {
	angleConfigFromTheme,
	axisConfigFromTheme,
	boxAnnotationStyleFromTheme,
	lineAnnotationStyleFromTheme,
	rectangleStyleFromTheme,
	channelHasCustomization,
	chordAxisConfigFromTheme,
	configsFromTheme,
	connectionConfigFromTheme,
	dataLabelsConfigFromTheme,
	explainChannelCustomization,
	explainLegendCustomization,
	labelsFromTheme,
	legendConfigFromTheme,
	legendHasCustomization,
	patternConfigFromTheme,
	resolveTextPickerPalette,
	shapeConfigFromTheme,
	textConfigFromTheme,
} from "./themeConfig"
import { DEFAULT_LABELS_CONFIG, type LegendConfig } from "./labelsConfig"
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
describe("resolveTextPickerPalette", () => {
	it("returns the designated text palette when the theme sets one", () => {
		const theme: Theme = {
			...STUB_THEME,
			categoricalPalettes: [
				{ id: "p1", name: "P1", colors: ["#a", "#b"] },
				{ id: "txt", name: "Text", colors: ["#111", "#222"] },
			],
			defaultTextPaletteId: "txt",
		}
		expect(resolveTextPickerPalette(theme)).toEqual(["#111", "#222"])
	})

	it("falls back to the default categorical palette when none is designated", () => {
		expect(resolveTextPickerPalette(STUB_THEME)).toEqual(["#a", "#b"])
	})

	it("falls back when the designated id no longer exists (deleted palette)", () => {
		const theme: Theme = { ...STUB_THEME, defaultTextPaletteId: "gone" }
		expect(resolveTextPickerPalette(theme)).toEqual(["#a", "#b"])
	})
})

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

// ── Data Labels theme seed ──────────────────────────────────────────────────
// `dataLabelsConfigFromTheme` can't join the configsFromTheme parity describe
// above: the Data Labels blob is its OWN persisted slice
// (`currentDataLabelsConfigAtom` / `Visual.dataLabelsConfig`), not part of
// `ChannelConfigs`, so `configsFromTheme` has no `dataLabels` key to compare
// against. These direct tests are the drift guard instead — they pin both the
// theme pickup and the legacy-theme fallbacks, which are the two ways this
// builder can silently ship the wrong font.
describe("dataLabelsConfigFromTheme", () => {
	const THEMED: Theme = {
		...STUB_THEME,
		dataLabelsColor: "#ff00aa",
		dataLabelsFontFamily: "Inter, system-ui, sans-serif",
		dataLabelsFontSize: 17,
		dataLabelsFontWeight: 800,
		dataLabelsItalic: true,
		dataLabelsUnderline: true,
	}

	it("picks up every theme-driven data-label field", () => {
		const cfg = dataLabelsConfigFromTheme(THEMED)
		expect(cfg.color).toBe("#ff00aa")
		expect(cfg.fontFamily).toBe("Inter, system-ui, sans-serif")
		expect(cfg.fontSize).toBe(17)
		expect(cfg.fontWeight).toBe(800)
		expect(cfg.italic).toBe(true)
		expect(cfg.underline).toBe(true)
	})

	it("leaves the non-theme-driven fields at the built-in defaults", () => {
		// Only the font knobs are theme-driven; everything else (offsets,
		// templates, per-value color maps) must come through untouched or a
		// re-theme would silently wipe the user's label setup.
		const cfg = dataLabelsConfigFromTheme(THEMED)
		expect(cfg.colorOverrides).toEqual(DEFAULT_DATA_LABELS_CONFIG.colorOverrides)
		expect(cfg.labelTemplate).toBe(DEFAULT_DATA_LABELS_CONFIG.labelTemplate)
		expect(cfg.sizeMin).toBe(DEFAULT_DATA_LABELS_CONFIG.sizeMin)
		expect(cfg.sizeMax).toBe(DEFAULT_DATA_LABELS_CONFIG.sizeMax)
		expect(cfg.xOffset).toBe(DEFAULT_DATA_LABELS_CONFIG.xOffset)
		expect(cfg.yOffset).toBe(DEFAULT_DATA_LABELS_CONFIG.yOffset)
		expect(cfg.barLabelPosition).toBe(
			DEFAULT_DATA_LABELS_CONFIG.barLabelPosition
		)
	})

	it("a legacy theme (fields predate the feature) falls back to the built-ins", () => {
		// STUB_THEME carries none of the six optional fields — exactly the shape
		// of a theme saved before data-label fonts were themeable.
		const cfg = dataLabelsConfigFromTheme(STUB_THEME)
		expect(cfg).toEqual(DEFAULT_DATA_LABELS_CONFIG)
		// Pinned literally so a default change has to be a deliberate edit here.
		expect(cfg.fontSize).toBe(11)
		expect(cfg.fontWeight).toBe(500)
		expect(cfg.fontFamily).toBe("system-ui, sans-serif")
		expect(cfg.color).toBe("#111827")
		expect(cfg.italic).toBe(false)
		expect(cfg.underline).toBe(false)
	})

	it("italic / underline fall back to false, not undefined", () => {
		// These two use `?? false` rather than `?? DEFAULT.x`; a leaked
		// `undefined` would read as "unset" against the dot baseline.
		const cfg = dataLabelsConfigFromTheme({
			...STUB_THEME,
			dataLabelsItalic: false,
			dataLabelsUnderline: false,
		})
		expect(cfg.italic).toBe(false)
		expect(cfg.underline).toBe(false)
	})
})

// ── Annotation style theme seeds ────────────────────────────────────────────
// Shared by the Annotations panel (new-annotation seeding + reset baselines)
// and the theme editor's Annotations section, so the two can't drift.
describe("annotation style builders", () => {
	const THEMED: Theme = {
		...STUB_THEME,
		annotationFillColor: "#3b82f6",
		annotationFillOpacity: 0.5,
		annotationBorderColor: "#1d4ed8",
		annotationBorderThickness: 3,
		annotationBorderOpacity: 0.8,
		annotationBorderDash: "dashed",
		annotationBorderDasharray: "4,2",
		annotationTextFontFamily: "Inter, system-ui, sans-serif",
		annotationTextFontSize: 16,
		annotationTextColor: "#0f172a",
		annotationTextFontWeight: 600,
		annotationTextAlign: "left",
		annotationTextPadding: 12,
		annotationLineColor: "#dc2626",
		annotationLineThickness: 4,
		annotationLineOpacity: 0.7,
		annotationLineDash: "dotted",
		annotationLineDasharray: "1,3",
	}

	it("boxAnnotationStyleFromTheme picks up every fill + border field", () => {
		expect(boxAnnotationStyleFromTheme(THEMED)).toEqual({
			backgroundColor: "#3b82f6",
			backgroundOpacity: 0.5,
			borderColor: "#1d4ed8",
			borderThickness: 3,
			borderOpacity: 0.8,
			borderDash: "dashed",
			borderDasharray: "4,2",
		})
	})

	it("rectangleStyleFromTheme adds the text styling on top of the box style", () => {
		const style = rectangleStyleFromTheme(THEMED)
		expect(style).toMatchObject(boxAnnotationStyleFromTheme(THEMED))
		expect(style.textFontFamily).toBe("Inter, system-ui, sans-serif")
		expect(style.textFontSize).toBe(16)
		expect(style.textColor).toBe("#0f172a")
		expect(style.textFontWeight).toBe(600)
		expect(style.textAlign).toBe("left")
		expect(style.textPadding).toBe(12)
	})

	it("lineAnnotationStyleFromTheme picks up every stroke field", () => {
		expect(lineAnnotationStyleFromTheme(THEMED)).toEqual({
			lineColor: "#dc2626",
			lineThickness: 4,
			lineOpacity: 0.7,
			lineDash: "dotted",
			lineDasharray: "1,3",
		})
	})

	it("a legacy theme (no annotation fields) yields the built-in seed values", () => {
		// STUB_THEME predates the annotation fields — the builders must return
		// exactly the historical factory seeds, so old themes keep the old look.
		expect(boxAnnotationStyleFromTheme(STUB_THEME)).toEqual(
			DEFAULT_BOX_ANNOTATION_STYLE
		)
		expect(rectangleStyleFromTheme(STUB_THEME)).toEqual({
			...DEFAULT_BOX_ANNOTATION_STYLE,
			textFontFamily: DEFAULT_RECTANGLE_TEXT.textFontFamily,
			textFontSize: DEFAULT_RECTANGLE_TEXT.textFontSize,
			textColor: DEFAULT_RECTANGLE_TEXT.textColor,
			textFontWeight: DEFAULT_RECTANGLE_TEXT.textFontWeight,
			textAlign: DEFAULT_RECTANGLE_TEXT.textAlign,
			textPadding: DEFAULT_RECTANGLE_TEXT.textPadding,
		})
		expect(lineAnnotationStyleFromTheme(STUB_THEME)).toEqual(
			DEFAULT_LINE_ANNOTATION_STYLE
		)
	})

	it("an unset border color follows the fill color (the seed ties them)", () => {
		const style = boxAnnotationStyleFromTheme({
			...STUB_THEME,
			annotationFillColor: "#3b82f6",
		})
		expect(style.borderColor).toBe("#3b82f6")
	})

	it("the factories write the theme style onto new annotations", () => {
		const rect = newRectangle("r1", rectangleStyleFromTheme(THEMED))
		expect(rect.backgroundColor).toBe("#3b82f6")
		expect(rect.borderDash).toBe("dashed")
		expect(rect.borderDasharray).toBe("4,2")
		expect(rect.textFontWeight).toBe(600)
		expect(rect.text).toBe("")
		// Non-style fields keep the factory geometry / layering.
		expect(rect.zOrder).toBe("behind")
		expect(rect.coordSystem).toBe("percent")

		const circle = newCircle("c1", boxAnnotationStyleFromTheme(THEMED))
		expect(circle.backgroundOpacity).toBe(0.5)
		expect(circle.borderColor).toBe("#1d4ed8")
		expect(circle.radius).toBe(0.2)

		const line = newLineSegment("l1", lineAnnotationStyleFromTheme(THEMED))
		expect(line.lineColor).toBe("#dc2626")
		expect(line.lineDash).toBe("dotted")
		expect(line.zOrder).toBe("front")
	})

	it("style-less factory calls keep the historical seed values", () => {
		expect(newRectangle("r")).toMatchObject({
			...DEFAULT_BOX_ANNOTATION_STYLE,
			...DEFAULT_RECTANGLE_TEXT,
		})
		expect(newCircle("c")).toMatchObject(DEFAULT_BOX_ANNOTATION_STYLE)
		expect(newLineSegment("l")).toMatchObject(DEFAULT_LINE_ANNOTATION_STYLE)
	})
})

// ── Chord ring axis theme seed ──────────────────────────────────────────────
// Shared by the Connection panel and ChordPlot (and the dot baseline for the
// Tickmark / Spine controls), so the drawn ring and the panel's displayed
// values can't drift apart.
describe("chordAxisConfigFromTheme", () => {
	it("tickmarks + spine take the same theme fields the x / y axes seed from", () => {
		const cfg = chordAxisConfigFromTheme(STUB_THEME)
		expect(cfg.tickmarks).toEqual({
			color: STUB_THEME.tickmarkColor,
			thickness: STUB_THEME.tickmarkThickness,
			length: STUB_THEME.tickmarkLength,
		})
		expect(cfg.spine).toEqual({
			color: STUB_THEME.spineColor,
			thickness: STUB_THEME.spineThickness,
		})
		// Same source fields as the cartesian axis builder.
		const xAxis = axisConfigFromTheme(STUB_THEME, "x")
		expect(cfg.tickmarks).toEqual(xAxis.tickmarks)
		expect(cfg.spine).toEqual(xAxis.spine)
	})

	it("carries the full DEFAULT_CHORD_AXIS_CONFIG for the non-theme fields", () => {
		const cfg = chordAxisConfigFromTheme(STUB_THEME)
		expect(cfg.enabled).toBe(DEFAULT_CHORD_AXIS_CONFIG.enabled)
		expect(cfg.tickCount).toBe(DEFAULT_CHORD_AXIS_CONFIG.tickCount)
		expect(cfg.customFormat).toBe(DEFAULT_CHORD_AXIS_CONFIG.customFormat)
		expect(cfg.labelEvery).toBe(DEFAULT_CHORD_AXIS_CONFIG.labelEvery)
	})

	it("follows a different theme's tick / spine styling", () => {
		const other: Theme = {
			...STUB_THEME,
			tickmarkColor: "#123456",
			tickmarkThickness: 3,
			tickmarkLength: 9,
			spineColor: "#654321",
			spineThickness: 4,
		}
		const cfg = chordAxisConfigFromTheme(other)
		expect(cfg.tickmarks).toEqual({
			color: "#123456",
			thickness: 3,
			length: 9,
		})
		expect(cfg.spine).toEqual({ color: "#654321", thickness: 4 })
	})
})

// ── Labels theme seed ───────────────────────────────────────────────────────
// `labelsFromTheme` seeds the persisted `labelsConfig` slice on every new /
// reset visual. Anything it drops is a theme setting the user never sees.
describe("labelsFromTheme", () => {
	const FULL: Theme = {
		...STUB_THEME,
		titleFontWeight: 800,
		titleFontBold: false,
		subtitleFontWeight: 600,
		axisTitleFontWeight: 400,
		legendTitleFontWeight: 300,
		subtitleFontFamily: "Georgia, 'Times New Roman', serif",
		legendTitleFontFamily: "Inter, system-ui, sans-serif",
		titleAlignment: "left",
		subtitleAlignment: "right",
		legendTitleAlignment: "center",
		titleFontItalic: true,
		titleFontUnderline: true,
		textFontWeight: 300,
		textFontItalic: true,
		textFontUnderline: true,
		legendTextFontFamily: "'DM Sans', ui-sans-serif, sans-serif",
		legendTextFontSize: 15,
		legendTextFontWeight: 600,
		legendTextColor: "#00aa00",
	}

	it("a fully-populated theme flows into baseFont.titles", () => {
		const { titles } = labelsFromTheme(FULL).baseFont
		expect(titles).toEqual({
			family: FULL.titleFontFamily,
			primarySize: FULL.titlePrimarySize,
			subtitleSize: FULL.titleSubtitleSize,
			secondarySize: FULL.titleSecondarySize,
			color: FULL.titleFontColor,
			weight: 800,
			subtitleWeight: 600,
			secondaryWeight: 400,
			legendWeight: 300,
			subtitleFamily: "Georgia, 'Times New Roman', serif",
			legendFamily: "Inter, system-ui, sans-serif",
			primaryAlignment: "left",
			subtitleAlignment: "right",
			legendAlignment: "center",
			italic: true,
			underline: true,
		})
	})

	it("a fully-populated theme flows into baseFont.text", () => {
		const { text } = labelsFromTheme(FULL).baseFont
		expect(text).toEqual({
			family: FULL.textFontFamily,
			size: FULL.textFontSize,
			color: FULL.textFontColor,
			weight: 300,
			italic: true,
			underline: true,
			legendFamily: "'DM Sans', ui-sans-serif, sans-serif",
			legendSize: 15,
			legendWeight: 600,
			legendColor: "#00aa00",
		})
	})

	it("a minimal theme leaves optional slots unset (resolve-time fallback)", () => {
		// The per-slot weights / families / alignments MUST stay undefined rather
		// than being filled with a concrete value — resolveTitleFont /
		// resolveLegendTextFont fall back to the shared fields, and a baked-in
		// value here would freeze the slot against later theme edits.
		const { titles, text } = labelsFromTheme(STUB_THEME).baseFont
		expect(titles.weight).toBeUndefined()
		expect(titles.subtitleWeight).toBeUndefined()
		expect(titles.secondaryWeight).toBeUndefined()
		expect(titles.legendWeight).toBeUndefined()
		expect(titles.subtitleFamily).toBeUndefined()
		expect(titles.legendFamily).toBeUndefined()
		expect(titles.primaryAlignment).toBeUndefined()
		expect(titles.subtitleAlignment).toBeUndefined()
		expect(titles.legendAlignment).toBeUndefined()
		// italic / underline are `?? false`, not left undefined.
		expect(titles.italic).toBe(false)
		expect(titles.underline).toBe(false)
		expect(text.weight).toBeUndefined()
		expect(text.legendFamily).toBeUndefined()
		expect(text.legendSize).toBeUndefined()
		expect(text.legendWeight).toBeUndefined()
		expect(text.legendColor).toBeUndefined()
		expect(text.italic).toBe(false)
		expect(text.underline).toBe(false)
		// The required fields still come from the theme.
		expect(titles.family).toBe(STUB_THEME.titleFontFamily)
		expect(titles.primarySize).toBe(STUB_THEME.titlePrimarySize)
		expect(text.size).toBe(STUB_THEME.textFontSize)
		expect(text.color).toBe(STUB_THEME.textFontColor)
	})

	it("keeps the DEFAULT_LABELS_CONFIG scaffolding for everything outside baseFont", () => {
		const cfg = labelsFromTheme(STUB_THEME)
		expect(cfg.title).toBe(DEFAULT_LABELS_CONFIG.title)
		expect(cfg.subtitle).toBe(DEFAULT_LABELS_CONFIG.subtitle)
		expect(cfg.legendTitles).toEqual({})
		expect(cfg.fontOverrides).toEqual({})
		expect(cfg.titleAlignments).toEqual({})
		expect(cfg.titleOffsets).toEqual({})
		expect(cfg.yAxisTitleHorizontal).toBe(false)
		expect(cfg.configVersion).toBe(DEFAULT_LABELS_CONFIG.configVersion)
	})

	it("numeric theme weights win over the legacy bold flag", () => {
		// Legacy theme: only the boolean survives → maps onto 700.
		const legacyBold: Theme = {
			...STUB_THEME,
			titleFontBold: true,
			textFontBold: true,
		}
		expect(labelsFromTheme(legacyBold).baseFont.titles.weight).toBe(700)
		expect(labelsFromTheme(legacyBold).baseFont.text.weight).toBe(700)
		// Both present → the numeric weight wins, even when it's LIGHTER than
		// bold (the bold flag is stale once a weight has been picked).
		const both: Theme = {
			...legacyBold,
			titleFontWeight: 300,
			textFontWeight: 400,
		}
		expect(labelsFromTheme(both).baseFont.titles.weight).toBe(300)
		expect(labelsFromTheme(both).baseFont.text.weight).toBe(400)
		// bold: false with no numeric weight → unset (inherit the slot default),
		// NOT an explicit 400.
		const notBold: Theme = {
			...STUB_THEME,
			titleFontBold: false,
			textFontBold: false,
		}
		expect(labelsFromTheme(notBold).baseFont.titles.weight).toBeUndefined()
		expect(labelsFromTheme(notBold).baseFont.text.weight).toBeUndefined()
	})
})
