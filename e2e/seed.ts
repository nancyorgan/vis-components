/** Helpers to seed the editor with a known dataset + saved visual via
 *  Playwright's `addInitScript`. Runs in the browser context BEFORE the
 *  app boots, so navigating to `/editor/<visualId>` triggers the
 *  VisualLoaderForExisting flow — which reads the visual from localStorage
 *  and populates Recoil atoms from it (no reset, unlike /editor/new). */

export type SeedFixture = {
	visualId: string
	datasetId: string
	datasetName: string
	fields: Array<{ name: string; inferredType: string }>
	rows: Array<Record<string, string>>
	encodings: Record<string, { field: string } | undefined>
	/** Extra channelConfigs merged into the built config (e.g. a histogram
	 *  config under `x`, or a pattern config). Shallow-merged over the
	 *  facet-derived config. */
	channelConfigs?: Record<string, unknown>
	facet?: {
		rows: number | null
		cols: number | null
		gapX: number
		gapY: number
		// Tri-state strings (Phase 2) — boolean legacy values still
		// accepted; buildVisualScript writes the value through and the
		// app's migrateShareValue helper normalizes both forms.
		shareX: "none" | "perGroup" | "all" | boolean
		shareY: "none" | "perGroup" | "all" | boolean
		proportionalSizing?: boolean
		// Polar "Size panels by unit" — scales each radar/pie disc (and now
		// percent annotations) by the panel's unit relative to the largest.
		proportionalPanelSizing?: boolean
		// Per-axis sizing (newer) — drives the size-by-unit / category
		// weight calculations.
		proportionalSizingX?: "off" | "categoryCount" | "unit"
		proportionalSizingY?: "off" | "categoryCount" | "unit"
		// Pixel-precise per-panel inner dim overrides. Null/undefined =
		// auto from the solver.
		panelWidth?: number | null
		panelHeight?: number | null
		// Axis-range pins applied at render time. `overall*` apply under
		// share=all; the per-row / per-col maps apply under share=perGroup
		// (or under share=none in 1D grids per the row/col panel logic).
		// panelAxisOverrides keys by facet value for wrap mode (shareY=none
		// + shareX=none) and currently isn't honored in grid mode.
		overallYRange?: { min?: number; max?: number }
		overallXRange?: { min?: number; max?: number }
		rowAxisOverrides?: Record<string, { min?: number; max?: number }>
		colAxisOverrides?: Record<string, { min?: number; max?: number }>
		panelAxisOverrides?: Record<
			string,
			{ xMin?: number; xMax?: number; yMin?: number; yMax?: number }
		>
	}
	labels?: {
		title?: string
		subtitle?: string
		xAxisTitle?: string
		yAxisTitle?: string
		yAxisTitleHorizontal?: boolean
	}
	/** Rectangle annotations to seed into the editor. Written onto the saved
	 *  Visual's `annotationsConfig` — useLoadVisual reads them from there
	 *  when opening the visual, so they render immediately. Each entry is a
	 *  full RectangleAnnotation; the builder fills any omitted style fields
	 *  with sensible defaults. */
	annotations?: Array<{
		id: string
		coordSystem: "percent" | "values"
		xMin: number | string
		xMax: number | string
		yMin: number | string
		yMax: number | string
		zOrder?: "behind" | "front"
		backgroundColor?: string
		backgroundOpacity?: number
		borderColor?: string
		borderThickness?: number
		borderOpacity?: number
		borderDash?: string
		name?: string
	}>
	/** Circle annotations to seed (same Visual.annotationsConfig path as
	 *  rectangles). Omitted style fields default like rectangles. */
	circleAnnotations?: Array<{
		id: string
		coordSystem: "percent" | "values"
		centerX: number | string
		centerY: number | string
		radius: number
		radiusAxis: "x" | "y"
		zOrder?: "behind" | "front"
		backgroundColor?: string
		backgroundOpacity?: number
		borderColor?: string
		borderThickness?: number
		borderOpacity?: number
		borderDash?: string
		name?: string
	}>
}

/** Serializes the fixture for interpolation into the browser init script,
 *  where the @th/lib json helpers are not available. */
// eslint-disable-next-line @th/use-wrapped-json-functions
const fixtureJson = (fixture: SeedFixture): string => JSON.stringify(fixture)

/** Build a Visual JSON shape that matches what useLoadVisual expects.
 *  Fields it can't infer (legend, tooltip, dataLabels) are omitted and
 *  fall back to the editor defaults. */
const buildVisualScript = (fixture: SeedFixture): string => `
(() => {
	const fixture = ${fixtureJson(fixture)};
	const dataset = {
		id: fixture.datasetId,
		name: fixture.datasetName,
		fields: fixture.fields,
		versions: [{
			id: "v1",
			filename: "seed.csv",
			rows: fixture.rows,
			createdAt: 0,
		}],
		latestVersionId: "v1",
		createdAt: 0,
	};
	localStorage.setItem(
		"vis-components:datasets",
		JSON.stringify({ [fixture.datasetId]: dataset })
	);
	const emptyEnc = {
		x: { field: null }, y: { field: null }, r: { field: null },
		length: { field: null }, hue: { field: null },
		outlineHue: { field: null },
		saturation: { field: null }, brightness: { field: null },
		pattern: { field: null }, opacity: { field: null },
		shape: { field: null }, angle: { field: null },
		area: { field: null }, text: { field: null },
		facet: { field: null },
		facetRow: { field: null },
		facetCol: { field: null },
		size: { field: null }, connection: { field: null },
	};
	const encodings = { ...emptyEnc, ...fixture.encodings };
	const facetShareX = fixture.facet ? fixture.facet.shareX : undefined;
	const facetShareY = fixture.facet ? fixture.facet.shareY : undefined;
	const channelConfigs = fixture.facet ? {
		facet: {
			rows: fixture.facet.rows,
			cols: fixture.facet.cols,
			shareAxes:
				(facetShareX === true || facetShareX === "all") &&
				(facetShareY === true || facetShareY === "all"),
			shareX: facetShareX,
			shareY: facetShareY,
			gapX: fixture.facet.gapX,
			gapY: fixture.facet.gapY,
			panelAxisOverrides: fixture.facet.panelAxisOverrides ?? {},
			panelOrder: {},
			rowAxisOverrides: fixture.facet.rowAxisOverrides ?? {},
			colAxisOverrides: fixture.facet.colAxisOverrides ?? {},
			overallYRange: fixture.facet.overallYRange ?? {},
			overallXRange: fixture.facet.overallXRange ?? {},
			proportionalSizing: fixture.facet.proportionalSizing ?? true,
			proportionalPanelSizing: fixture.facet.proportionalPanelSizing ?? false,
			proportionalSizingX: fixture.facet.proportionalSizingX,
			proportionalSizingY: fixture.facet.proportionalSizingY,
			panelWidth: fixture.facet.panelWidth ?? null,
			panelHeight: fixture.facet.panelHeight ?? null,
		},
	} : {};
	Object.assign(channelConfigs, fixture.channelConfigs ?? {});
	// Axis configs read many fields directly at render time (customFormat,
	// tickmarks, …). The real app always merges DEFAULT_AXIS_CONFIG; mirror that
	// here so a fixture can pass just { x: { histogram: {...} } } without the
	// renderer crashing on undefined axis fields.
	const DEF_AXIS = {
		tickCount: 5,
		customFormat: "",
		gridlines: { enabled: true, color: "#e2e8f0", thickness: 1, count: null },
		tickmarks: { color: "#94a3b8", thickness: 1, length: 4 },
		spine: { color: "#94a3b8", thickness: 1 },
		tickLabelAngle: 0,
		jitterAmount: 0,
		distributionOverlay: {
			showDensityViolin: false, showBoxPlot: false, showPoints: true,
			color: "#475569", fillColor: "#cbd5e1",
			colorOverrides: {}, fillColorOverrides: {},
			strokePaletteId: null, strokePalette: [],
			fillPaletteId: null, fillPalette: [],
		},
		categoricalTickStride: 1,
	};
	for (const ax of ["x", "y", "r"]) {
		if (channelConfigs[ax]) channelConfigs[ax] = { ...DEF_AXIS, ...channelConfigs[ax] };
	}
	const labelsConfig = {
		title: fixture.labels?.title ?? "",
		subtitle: fixture.labels?.subtitle ?? "",
		xAxisTitle: fixture.labels?.xAxisTitle ?? "",
		yAxisTitle: fixture.labels?.yAxisTitle ?? "",
		yAxisTitleHorizontal: fixture.labels?.yAxisTitleHorizontal ?? false,
		baseFont: {
			titles: {
				family: "system-ui, sans-serif",
				primarySize: 20,
				subtitleSize: 14,
				secondarySize: 13,
				color: "#111827",
			},
			text: {
				family: "system-ui, sans-serif",
				size: 12,
				color: "#4a5568",
			},
		},
		titleAlignments: {},
		fontOverrides: {},
	};
	const annotationRects = (fixture.annotations ?? []).map((a) => ({
		id: a.id,
		name: a.name ?? a.id,
		xMin: a.xMin,
		xMax: a.xMax,
		yMin: a.yMin,
		yMax: a.yMax,
		backgroundColor: a.backgroundColor ?? "#facc15",
		backgroundOpacity: a.backgroundOpacity ?? 0.2,
		borderColor: a.borderColor ?? "#facc15",
		borderThickness: a.borderThickness ?? 0,
		borderOpacity: a.borderOpacity ?? 0,
		borderDash: a.borderDash ?? "solid",
		zOrder: a.zOrder ?? "behind",
		coordSystem: a.coordSystem,
	}));
	const annotationCircles = (fixture.circleAnnotations ?? []).map((c) => ({
		id: c.id,
		name: c.name ?? c.id,
		centerX: c.centerX,
		centerY: c.centerY,
		radius: c.radius,
		radiusAxis: c.radiusAxis,
		backgroundColor: c.backgroundColor ?? "#facc15",
		backgroundOpacity: c.backgroundOpacity ?? 0.2,
		borderColor: c.borderColor ?? "#facc15",
		borderThickness: c.borderThickness ?? 0,
		borderOpacity: c.borderOpacity ?? 0,
		borderDash: c.borderDash ?? "solid",
		zOrder: c.zOrder ?? "behind",
		coordSystem: c.coordSystem,
	}));
	const visual = {
		id: fixture.visualId,
		name: "Seeded fixture",
		folderId: null,
		datasetId: fixture.datasetId,
		createdAtVersionId: "v1",
		fieldTypeOverrides: {},
		encodings,
		channelConfigs,
		labelsConfig,
	};
	// useLoadVisual reads annotations off the Visual (it overwrites the
	// annotations atom on load, so a separate currentAnnotations entry
	// wouldn't survive). Only attach when the fixture defines some — when
	// absent, the loader falls back to DEFAULT_ANNOTATIONS_CONFIG (which
	// carries the full shape, e.g. an empty circles list).
	if (annotationRects.length > 0 || annotationCircles.length > 0) {
		visual.annotationsConfig = {
			rectangles: annotationRects,
			circles: annotationCircles,
		};
	}
	localStorage.setItem(
		"vis-components:visuals",
		JSON.stringify([visual])
	);
})();
`

export const seedFixtureScript = buildVisualScript

/** Common fixtures. */
export const FACETED_1x3: SeedFixture = {
	visualId: "vis-1x3",
	datasetId: "ds-1x3",
	datasetName: "iris-like",
	fields: [
		{ name: "x", inferredType: "quantitative" },
		{ name: "y", inferredType: "quantitative" },
		{ name: "group", inferredType: "categorical" },
	],
	rows: Array.from({ length: 60 }, (_, i) => ({
		x: String((i % 20) + 1),
		y: String(10 + Math.sin(i / 3) * 8 + (i % 7)),
		group: ["A", "B", "C"][Math.floor(i / 20)] ?? "A",
	})),
	encodings: {
		x: { field: "x" },
		y: { field: "y" },
		facet: { field: "group" },
	},
	facet: {
		rows: 1,
		cols: 3,
		gapX: 30,
		gapY: 60,
		shareX: true,
		shareY: true,
	},
	labels: {
		title: "Faceted scatter — 1×3 shared axes",
		xAxisTitle: "x axis",
		yAxisTitle: "y axis",
	},
}

export const FACETED_3x1_RIDGELINE: SeedFixture = {
	...FACETED_1x3,
	visualId: "vis-3x1-ridge",
	datasetId: "ds-3x1-ridge",
	facet: {
		rows: 3,
		cols: 1,
		gapX: 30,
		gapY: -40,
		shareX: true,
		shareY: false,
	},
	labels: {
		title: "Ridgeline — gapY = -40",
		xAxisTitle: "x axis",
		yAxisTitle: "y axis",
	},
}

/** Mimics the user's reported overlap chart: 6×1 bars-y with long
 *  categorical y-labels and a quantitative measure (length). Hue
 *  encoded by facet field (animal). */
export const FACETED_6x1_BARS_Y: SeedFixture = {
	visualId: "vis-bars-y-6x1",
	datasetId: "ds-bars-y",
	datasetName: "bars-y-animals",
	fields: [
		{ name: "activity", inferredType: "categorical" },
		{ name: "silliness_score", inferredType: "quantitative" },
		{ name: "animal", inferredType: "categorical" },
	],
	rows: (() => {
		// Six animals — matches the user's actual chart. Generates a tall
		// chart that scrolls; visual test uses fullPage screenshot to
		// capture the entire scroll height.
		const animals = ["Penguin", "Capybara", "Sloth", "Llama", "Pug", "Raccoon"]
		const activities = [
			"Yoga",
			"Skateboarding",
			"Karaoke",
			"Knitting",
			"Salsa Dancing",
		]
		const rows: Array<Record<string, string>> = []
		let i = 0
		for (const a of animals) {
			for (const act of activities) {
				// Deterministic value — random made screenshots unstable.
				rows.push({
					animal: a,
					activity: act,
					silliness_score: String(20 + ((i * 17) % 80)),
				})
				i++
			}
		}
		return rows
	})(),
	encodings: {
		y: { field: "activity" },
		length: { field: "silliness_score" },
		facet: { field: "animal" },
	},
	facet: {
		rows: 6,
		cols: 1,
		gapX: 30,
		gapY: 60,
		shareX: true,
		shareY: true,
	},
	labels: {
		yAxisTitle: "activity",
		xAxisTitle: "silliness_score",
	},
}

export const SINGLE_PANEL: SeedFixture = {
	visualId: "vis-single",
	datasetId: "ds-single",
	datasetName: "single",
	fields: [
		{ name: "x", inferredType: "quantitative" },
		{ name: "y", inferredType: "quantitative" },
	],
	rows: Array.from({ length: 30 }, (_, i) => ({
		x: String(i + 1),
		y: String(10 + Math.sin(i / 2) * 8 + (i % 5)),
	})),
	encodings: {
		x: { field: "x" },
		y: { field: "y" },
	},
	labels: {
		title: "Single-panel scatter",
		xAxisTitle: "x axis",
		yAxisTitle: "y axis",
	},
}

/** Scatter whose mark OUTLINE color is driven by a categorical field via
 *  the `outlineHue` channel (fill stays the default). Exercises the
 *  field-driven outline-color encoding: marks should render with multiple
 *  distinct stroke colors, and — since hue is unmapped — `outlineHue` gets
 *  its own legend section. */
export const OUTLINE_HUE_SCATTER: SeedFixture = {
	visualId: "vis-outline-hue",
	datasetId: "ds-outline-hue",
	datasetName: "outline-hue",
	fields: [
		{ name: "x", inferredType: "quantitative" },
		{ name: "y", inferredType: "quantitative" },
		{ name: "grp", inferredType: "categorical" },
	],
	rows: Array.from({ length: 30 }, (_, i) => ({
		x: String(i + 1),
		y: String(10 + Math.sin(i / 2) * 8 + (i % 5)),
		grp: ["alpha", "beta", "gamma"][i % 3] ?? "alpha",
	})),
	encodings: {
		x: { field: "x" },
		y: { field: "y" },
		outlineHue: { field: "grp" },
	},
	labels: {
		title: "Outline color by group",
		xAxisTitle: "x axis",
		yAxisTitle: "y axis",
	},
}

/** 2 regions × 3 years grid. Both faceting axes categorical. */
export const GRID_2x3: SeedFixture = {
	visualId: "vis-grid-2x3",
	datasetId: "ds-grid-2x3",
	datasetName: "grid-2x3",
	fields: [
		{ name: "region", inferredType: "categorical" },
		{ name: "year", inferredType: "categorical" },
		{ name: "value", inferredType: "quantitative" },
	],
	rows: (() => {
		const regions = ["North", "South"]
		const years = ["2023", "2024", "2025"]
		const rows: Array<Record<string, string>> = []
		let i = 0
		for (const r of regions) {
			for (const y of years) {
				// 6 data points per cell with a deterministic value progression
				for (let k = 0; k < 6; k++) {
					rows.push({
						region: r,
						year: y,
						value: String(10 + ((i * 7) % 50) + k),
					})
					i++
				}
			}
		}
		return rows
	})(),
	encodings: {
		x: { field: "value" },
		y: { field: "value" },
		facetRow: { field: "region" },
		facetCol: { field: "year" },
	},
	facet: {
		rows: null,
		cols: null,
		gapX: 30,
		gapY: 30,
		shareX: "all",
		shareY: "all",
	},
	labels: { xAxisTitle: "Value", yAxisTitle: "Value" },
}

/** Row-only grid: 4 panels stacked vertically by `region`. */
export const GRID_ROW_ONLY: SeedFixture = {
	visualId: "vis-grid-row-only",
	datasetId: "ds-grid-row-only",
	datasetName: "grid-row-only",
	fields: [
		{ name: "region", inferredType: "categorical" },
		{ name: "x", inferredType: "quantitative" },
		{ name: "y", inferredType: "quantitative" },
	],
	rows: ["A", "B", "C", "D"].flatMap((r, i) =>
		Array.from({ length: 5 }, (_, k) => ({
			region: r,
			x: String(k + 1),
			y: String(10 + i * 5 + k),
		})),
	),
	encodings: {
		x: { field: "x" },
		y: { field: "y" },
		facetRow: { field: "region" },
	},
	facet: {
		rows: null,
		cols: null,
		gapX: 30,
		gapY: 30,
		shareX: "all",
		shareY: "all",
	},
}

/** Col-only grid: 4 panels in a horizontal strip by `category`. */
export const GRID_COL_ONLY: SeedFixture = {
	visualId: "vis-grid-col-only",
	datasetId: "ds-grid-col-only",
	datasetName: "grid-col-only",
	fields: [
		{ name: "category", inferredType: "categorical" },
		{ name: "x", inferredType: "quantitative" },
		{ name: "y", inferredType: "quantitative" },
	],
	rows: ["P", "Q", "R", "S"].flatMap((c, i) =>
		Array.from({ length: 5 }, (_, k) => ({
			category: c,
			x: String(k + 1),
			y: String(10 + i * 5 + k),
		})),
	),
	encodings: {
		x: { field: "x" },
		y: { field: "y" },
		facetCol: { field: "category" },
	},
	facet: {
		rows: null,
		cols: null,
		gapX: 30,
		gapY: 30,
		shareX: "all",
		shareY: "all",
	},
}
