import { render } from "@testing-library/react"
import { TestProvider, type TestStore } from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import { describe, expect, it } from "vitest"
import {
	DEFAULT_CONNECTION_CONFIG,
	DEFAULT_DATA_LABELS_CONFIG,
	type ConnectionConfig,
	type PatternConfig,
} from "../../lib/channelConfig"
import { DEFAULT_LABELS_CONFIG } from "../../lib/labelsConfig"
import {
	emptyDataLabelsEncodings,
	emptyEncodings,
	type Dataset,
	type Encodings,
} from "../../lib/types"
import {
	currentChannelConfigsAtom,
	currentDataLabelsConfigAtom,
	currentDataLabelsEncodingsAtom,
	currentDatasetIdAtom,
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
	currentLabelsAtom,
	datasetsAtom,
	previewVersionIdAtom,
} from "../../store/atoms"

import { AreaPlot } from "./AreaPlot"
import { ScatterPlot } from "./ScatterPlot"

/** Pattern-channel line dash on connection lines. The user-reported bugs:
 *  per-category dash picks not applying to lines (the pattern field varies
 *  WITHIN a line — known vs projected), "Apply pattern to range"
 *  conflicting with a mapped pattern variable, and the gap-filling underlay
 *  needing to be optional (truly dashed lines). */

const DATASET_ID = "ds-pattern-dash"

// `status` varies WITHIN each region's line (months 1–2 known, 3–4
// projected) — the known-vs-forecast shape the pattern channel must split
// each polyline over.
const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "test",
		filename: "test.csv",
		fields: [
			{ name: "month", inferredType: "quantitative" },
			{ name: "sales", inferredType: "quantitative" },
			{ name: "region", inferredType: "categorical" },
			{ name: "status", inferredType: "categorical" },
		],
		rows: [
			{ month: "1", sales: "10", region: "north", status: "known" },
			{ month: "2", sales: "20", region: "north", status: "known" },
			{ month: "3", sales: "30", region: "north", status: "proj" },
			{ month: "4", sales: "40", region: "north", status: "proj" },
			{ month: "1", sales: "12", region: "south", status: "known" },
			{ month: "2", sales: "22", region: "south", status: "known" },
			{ month: "3", sales: "32", region: "south", status: "proj" },
			{ month: "4", sales: "42", region: "south", status: "proj" },
		],
	})

const mount = (opts: {
	/** "line" = x+y (scatter/line chart, <polyline>s); "area" = x+length
	 *  (areas-x line-fill mode, <path>s). */
	chart?: "line" | "area"
	patternField?: string
	hueField?: string
	connection?: Partial<ConnectionConfig>
	pattern?: Partial<PatternConfig>
	/** Extra top-level channel-config fields (palette snapshots etc.). */
	configs?: Partial<import("../../lib/channelConfig").ChannelConfigs>
}) => {
	const store = installInMemoryLocalStorage()
	const encodings: Encodings = {
		...emptyEncodings(),
		x: { field: "month" },
		...(opts.chart === "area"
			? { length: { field: "sales" } }
			: { y: { field: "sales" } }),
		connection: { field: "region" },
		...(opts.patternField ? { pattern: { field: opts.patternField } } : {}),
		...(opts.hueField ? { hue: { field: opts.hueField } } : {}),
	}
	/* eslint-disable @th/use-wrapped-json-functions */
	store.set(
		"vis-components:datasets",
		JSON.stringify({ [DATASET_ID]: buildDataset() })
	)
	store.set("vis-components:currentDatasetId", JSON.stringify(DATASET_ID))
	store.set("vis-components:previewVersionId", JSON.stringify(null))
	store.set("vis-components:currentEncodings", JSON.stringify(encodings))
	/* eslint-enable @th/use-wrapped-json-functions */
	const init = (snap: TestStore) => {
		snap.set(datasetsAtom, { [DATASET_ID]: buildDataset() })
		snap.set(currentDatasetIdAtom, DATASET_ID)
		snap.set(previewVersionIdAtom, null)
		snap.set(currentEncodingsAtom, encodings)
		snap.set(currentLabelsAtom, DEFAULT_LABELS_CONFIG)
		snap.set(currentDataLabelsConfigAtom, DEFAULT_DATA_LABELS_CONFIG)
		snap.set(currentDataLabelsEncodingsAtom, emptyDataLabelsEncodings())
		snap.set(currentFieldOverridesAtom, {})
		snap.set(currentFieldLevelOrdersAtom, {})
		if (opts.connection || opts.pattern || opts.configs) {
			snap.set(currentChannelConfigsAtom, (prev) => ({
				...prev,
				...opts.configs,
				...(opts.connection
					? {
							connection: {
								...DEFAULT_CONNECTION_CONFIG,
								...prev.connection,
								...opts.connection,
							},
						}
					: {}),
				...(opts.pattern
					? {
							pattern: {
								overrides: {},
								inkColors: {},
								backgroundColor: "#e2e8f0",
								stackMode: "stack",
								...prev.pattern,
								...opts.pattern,
							},
						}
					: {}),
			}))
		}
	}
	const { container } = render(
		<TestProvider initializeState={init}>
			<div style={{ width: 600, height: 400 }}>
				{opts.chart === "area" ? <AreaPlot /> : <ScatterPlot />}
			</div>
		</TestProvider>
	)
	return container
}

const polylines = (container: HTMLElement) =>
	[...container.querySelectorAll("polyline")]
const dashOf = (el: Element) => el.getAttribute("stroke-dasharray")
const firstX = (el: Element): string =>
	(el.getAttribute("points") ?? "").split(" ")[0]?.split(",")[0] ?? ""
const lastX = (el: Element): string =>
	(el.getAttribute("points") ?? "").split(" ").at(-1)?.split(",")[0] ?? ""

describe("Pattern channel drives connection-line dash (scatter/line chart)", () => {
	it("a pattern field constant per line auto-cycles DASH_CYCLE across lines", () => {
		const container = mount({ patternField: "region" })
		const dashes = polylines(container).map(dashOf)
		// Per line: gap-filling underlay (solid) + dashed top. Category 0
		// (north) → "dashed" (8,4); category 1 (south) → "dotted" (2,3).
		expect(dashes.filter((d) => d === "8,4").length).toBe(1)
		expect(dashes.filter((d) => d === "2,3").length).toBe(1)
		expect(dashes.filter((d) => d === null).length).toBe(2)
	})

	it("a pattern field varying WITHIN a line splits it into runs, one dash per category", () => {
		const container = mount({ patternField: "status" })
		const lines = polylines(container)
		// 2 lines × 2 runs × (underlay + dashed top): known → "8,4",
		// proj → "2,3".
		const known = lines.filter((p) => dashOf(p) === "8,4")
		const proj = lines.filter((p) => dashOf(p) === "2,3")
		expect(known.length).toBe(2)
		expect(proj.length).toBe(2)
		expect(lines.length).toBe(8)
		// Runs connect: each projected run starts exactly at its line's last
		// known point (the connecting span takes the projected styling).
		for (const p of proj) {
			expect(known.some((k) => lastX(k) === firstX(p))).toBe(true)
		}
	})

	it("per-category dash overrides apply to the runs ('none' → solid known, pick → dashed proj)", () => {
		const container = mount({
			patternField: "status",
			pattern: { dashOverrides: { known: "none", proj: 0 } },
		})
		const lines = polylines(container)
		// Per line: solid known run (no underlay for solid) + underlay +
		// "dashed" (8,4) proj run = 3 polylines; 2 lines = 6.
		expect(lines.length).toBe(6)
		expect(lines.filter((p) => dashOf(p) === "8,4").length).toBe(2)
		expect(lines.filter((p) => dashOf(p) === "2,3").length).toBe(0)
	})

	it("'Apply pattern to range' is IGNORED when a pattern variable is mapped", () => {
		const container = mount({
			patternField: "region",
			connection: { dashRange: { enabled: true, min: "2", max: null } },
		})
		// No range split: same 4 polylines (underlay + dashed per line) as
		// without the range — NOT the 6 a range split would produce.
		expect(polylines(container).length).toBe(4)
	})

	it("gap fill AUTO: pattern mapped to the SAME field as hue → truly dashed (no underlay)", () => {
		const container = mount({ patternField: "region", hueField: "region" })
		const lines = polylines(container)
		expect(lines.length).toBe(2)
		expect(lines.every((p) => dashOf(p) !== null)).toBe(true)
	})

	it("gap fill AUTO: pattern ≠ hue keeps the underlay so lines read connected", () => {
		const container = mount({ patternField: "status", hueField: "region" })
		const lines = polylines(container)
		// 2 lines × 2 runs × (underlay + dashed top).
		expect(lines.length).toBe(8)
		expect(lines.filter((p) => dashOf(p) === null).length).toBe(4)
	})

	it("explicit dashGapFill: false removes the underlay even when pattern ≠ hue", () => {
		const container = mount({
			patternField: "status",
			hueField: "region",
			connection: { dashGapFill: false },
		})
		const lines = polylines(container)
		expect(lines.length).toBe(4)
		expect(lines.every((p) => dashOf(p) !== null)).toBe(true)
	})

	it("explicit dashGapFill: true restores the underlay when pattern === hue", () => {
		const container = mount({
			patternField: "region",
			hueField: "region",
			connection: { dashGapFill: true },
		})
		const lines = polylines(container)
		expect(lines.length).toBe(4)
		expect(lines.filter((p) => dashOf(p) === null).length).toBe(2)
	})

	it("gap color pairs with the palette's pattern-ink options (the area-pattern rule)", () => {
		// The line's stroke is the theme connection color; snapshot a palette
		// containing it with a paired ink → the underlay strokes that ink.
		const container = mount({
			patternField: "status",
			configs: {
				categoricalPalette: ["#888888"],
				categoricalPalettePatternInks: ["#ff00aa"],
			},
		})
		const underlays = polylines(container).filter((p) => dashOf(p) === null)
		expect(underlays.length).toBe(4)
		expect(underlays.every((p) => p.getAttribute("stroke") === "#ff00aa")).toBe(
			true
		)
	})

	it("the pattern channel's per-category Color pick wins the gap color for its run", () => {
		const container = mount({
			patternField: "status",
			pattern: { inkColors: { proj: "#00ff00" } },
		})
		const underlayStrokes = polylines(container)
			.filter((p) => dashOf(p) === null)
			.map((p) => p.getAttribute("stroke"))
		// The proj runs' gaps take the picked green; the known runs fall back
		// to the default pattern ink.
		expect(underlayStrokes.filter((s) => s === "#00ff00").length).toBe(2)
		expect(underlayStrokes.filter((s) => s !== "#00ff00").length).toBe(2)
	})

	it("per-HUE-category gap overrides (the panel's gap swatches) color that line's underlay", () => {
		const container = mount({
			patternField: "status",
			hueField: "region",
			connection: {
				dashAlternateColors: { north: "#aa0000", south: "#0000aa" },
			},
		})
		const underlayStrokes = polylines(container)
			.filter((p) => dashOf(p) === null)
			.map((p) => p.getAttribute("stroke"))
		expect(underlayStrokes.filter((s) => s === "#aa0000").length).toBe(2)
		expect(underlayStrokes.filter((s) => s === "#0000aa").length).toBe(2)
	})

	it("the single dashGapColor override applies when no hue is mapped", () => {
		const container = mount({
			connection: {
				defaultDashPattern: "dashed",
				dashGapColor: "#00aa00",
			},
		})
		const underlays = polylines(container).filter((p) => dashOf(p) === null)
		expect(underlays.length).toBe(2)
		expect(underlays.every((p) => p.getAttribute("stroke") === "#00aa00")).toBe(
			true
		)
	})

	it("gap color falls back to the default pattern ink (never the invisible background)", () => {
		const container = mount({
			connection: { defaultDashPattern: "dashed" },
			configs: { defaultPatternInk: "#123456" },
		})
		const underlays = polylines(container).filter((p) => dashOf(p) === null)
		expect(underlays.length).toBe(2)
		expect(underlays.every((p) => p.getAttribute("stroke") === "#123456")).toBe(
			true
		)
	})

	it("no pattern field: connection.defaultDashPattern (what the panel's no-field row writes) dashes every line", () => {
		const container = mount({
			connection: { defaultDashPattern: "dashed" },
		})
		const lines = polylines(container)
		// underlay + dashed top per line (gap fill auto-on without a
		// pattern/hue collision).
		expect(lines.length).toBe(4)
		expect(lines.filter((p) => dashOf(p) === "8,4").length).toBe(2)
	})

	it("no pattern field: connection.customDashPattern (the no-field 'Custom' pick) wins over the swatch pick", () => {
		const container = mount({
			connection: { defaultDashPattern: "dashed", customDashPattern: "1 5 9" },
		})
		const lines = polylines(container)
		expect(lines.length).toBe(4)
		// Normalized to comma-separated; no line keeps the swatch's 8,4.
		expect(lines.filter((p) => dashOf(p) === "1,5,9").length).toBe(2)
		expect(lines.filter((p) => dashOf(p) === "8,4").length).toBe(0)
	})

	it("an unparseable customDashPattern falls back to the swatch pick", () => {
		const container = mount({
			connection: { defaultDashPattern: "dotted", customDashPattern: "abc" },
		})
		expect(
			polylines(container).filter((p) => dashOf(p) === "2,3").length
		).toBe(2)
	})

	it("'Apply pattern to range' gates the custom dasharray too (custom inside, solid outside)", () => {
		const container = mount({
			connection: {
				customDashPattern: "1,5",
				dashRange: { enabled: true, min: "2", max: null },
			},
		})
		const lines = polylines(container)
		const dashed = lines.filter((p) => dashOf(p) === "1,5")
		expect(dashed.length).toBe(2)
		// Each line also keeps a solid pre-range segment (plus the underlay
		// under the dashed part).
		expect(lines.filter((p) => dashOf(p) === null).length).toBe(4)
	})

	it("'Blank' in the range window leaves a true gap when dash gaps are unfilled", () => {
		const container = mount({
			connection: {
				defaultDashPattern: "blank",
				dashGapFill: false,
				dashRange: { enabled: true, min: "2", max: null },
			},
		})
		const lines = polylines(container)
		// Only the solid pre-range segment per line — nothing draws inside
		// the window.
		expect(lines.length).toBe(2)
		expect(lines.every((p) => dashOf(p) === null)).toBe(true)
	})

	it("'Blank' + 'Fill dash gaps' paints the window in the gap color alone (no dashes)", () => {
		const container = mount({
			connection: {
				defaultDashPattern: "blank",
				dashGapFill: true,
				dashRange: { enabled: true, min: "2", max: null },
			},
			configs: { defaultPatternInk: "#123456" },
		})
		const lines = polylines(container)
		// Per line: the solid pre-range segment + the gap-color underlay
		// across the window — no dashed top line.
		expect(lines.length).toBe(4)
		expect(lines.every((p) => dashOf(p) === null)).toBe(true)
		expect(
			lines.filter((p) => p.getAttribute("stroke") === "#123456").length
		).toBe(2)
	})

	it("'Blank' without an active range is inert — lines render solid", () => {
		const container = mount({
			connection: { defaultDashPattern: "blank" },
		})
		const lines = polylines(container)
		expect(lines.length).toBe(2)
		expect(lines.every((p) => dashOf(p) === null)).toBe(true)
	})
})

describe("Pattern channel drives layer dash (areas-x line-fill mode)", () => {
	const lineFillPaths = (container: HTMLElement) =>
		[...container.querySelectorAll("path")].filter(
			(p) => p.getAttribute("fill") === "none"
		)

	it("pattern mapped with hue (same field) auto-cycles dash per layer, truly dashed by default", () => {
		const container = mount({
			chart: "area",
			patternField: "region",
			hueField: "region",
		})
		const paths = lineFillPaths(container)
		// pattern === hue → gap fill auto-off → one dashed path per layer.
		expect(paths.length).toBe(2)
		const dashes = paths.map(dashOf)
		expect(dashes).toContain("8,4")
		expect(dashes).toContain("2,3")
	})

	it("per-category dash overrides from the Pattern panel apply per layer", () => {
		const container = mount({
			chart: "area",
			patternField: "region",
			hueField: "region",
			pattern: { dashOverrides: { north: "none", south: 2 } },
		})
		const paths = lineFillPaths(container)
		expect(paths.length).toBe(2)
		const dashes = paths.map(dashOf)
		expect(dashes).toContain(null)
		expect(dashes).toContain("8,3,2,3")
	})

	it("'Apply pattern to range' is IGNORED when a pattern variable is mapped", () => {
		const container = mount({
			chart: "area",
			patternField: "region",
			hueField: "region",
			connection: { dashRange: { enabled: true, min: "2", max: null } },
		})
		// No range split — still one dashed path per layer.
		expect(lineFillPaths(container).length).toBe(2)
	})

	it("no pattern field: connection.customDashPattern applies to every layer edge", () => {
		const container = mount({
			chart: "area",
			hueField: "region",
			connection: { defaultDashPattern: "dashed", customDashPattern: "1,5,9" },
		})
		const dashes = lineFillPaths(container).map(dashOf)
		expect(dashes.filter((d) => d === "1,5,9").length).toBe(2)
		expect(dashes).not.toContain("8,4")
	})

	it("'Blank' in the range window applies to layer edges too (gap-color underlay only)", () => {
		const container = mount({
			chart: "area",
			hueField: "region",
			connection: {
				defaultDashPattern: "blank",
				dashGapFill: true,
				dashRange: { enabled: true, min: "2", max: null },
			},
			configs: { defaultPatternInk: "#123456" },
		})
		const paths = lineFillPaths(container)
		// Per layer: the solid pre-range edge + the gap-color underlay across
		// the window — no dashed top path.
		expect(paths.length).toBe(4)
		expect(paths.every((p) => dashOf(p) === null)).toBe(true)
		expect(
			paths.filter((p) => p.getAttribute("stroke") === "#123456").length
		).toBe(2)
	})

	it("'Blank' with dash gaps unfilled leaves a true gap in each layer edge", () => {
		const container = mount({
			chart: "area",
			hueField: "region",
			connection: {
				defaultDashPattern: "blank",
				dashGapFill: false,
				dashRange: { enabled: true, min: "2", max: null },
			},
		})
		const paths = lineFillPaths(container)
		expect(paths.length).toBe(2)
		expect(paths.every((p) => dashOf(p) === null)).toBe(true)
	})
})
