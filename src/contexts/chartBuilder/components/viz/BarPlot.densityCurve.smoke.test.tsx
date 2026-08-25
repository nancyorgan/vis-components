import { render } from "@testing-library/react"
import { TestProvider } from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import { describe, expect, it } from "vitest"
import { DEFAULT_AXIS_CONFIG } from "../../lib/channelConfig"
import { DEFAULT_LABELS_CONFIG } from "../../lib/labelsConfig"
import { emptyEncodings, type Dataset } from "../../lib/types"

import { ChartCanvas } from "./ChartCanvas"

/** A histogram can overlay a smooth density curve (Gaussian KDE) rescaled into
 *  the bars' units. These tests mount the real render path and confirm the
 *  curve (a stroke-width-2 line `<path>`) appears only when the toggle is on,
 *  and that the optional fill adds a filled area path. */

const DATASET_ID = "ds-bar-density-curve"

/** 40 rows, score = 1..40 (quantitative). No measure field — count bars. */
const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "scores",
		filename: "scores.csv",
		fields: [{ name: "score", inferredType: "quantitative" }],
		rows: Array.from({ length: 40 }, (_, i) => ({ score: String(i + 1) })),
	})

const seed = (histogram: Record<string, unknown>) => {
	installInMemoryLocalStorage()
	/* eslint-disable no-restricted-globals, @th/no-storage-outside-try, @th/use-wrapped-json-functions */
	const set = (k: string, v: unknown) => localStorage.setItem(k, JSON.stringify(v))
	set("vis-components:datasets", { [DATASET_ID]: buildDataset() })
	set("vis-components:currentDatasetId", DATASET_ID)
	set("vis-components:previewVersionId", null)
	set("vis-components:currentEncodings", {
		...emptyEncodings(),
		x: { field: "score" },
	})
	set("vis-components:currentChannelConfigs", {
		x: { ...DEFAULT_AXIS_CONFIG, histogram: { enabled: true, binCount: 8, ...histogram } },
	})
	set("vis-components:currentLabels", { _v: 1, data: DEFAULT_LABELS_CONFIG })
	/* eslint-enable no-restricted-globals, @th/no-storage-outside-try, @th/use-wrapped-json-functions */
}

const mount = () =>
	render(
		<TestProvider>
			<div style={{ width: 800, height: 600 }}>
				<ChartCanvas />
			</div>
		</TestProvider>
	)

/** The density curve is the only stroke-width-2, fill="none" path we emit. */
const curvePaths = (container: HTMLElement) =>
	[...container.querySelectorAll("path")].filter(
		(p) =>
			p.getAttribute("fill") === "none" && p.getAttribute("stroke-width") === "2"
	)

const filledPaths = (container: HTMLElement) =>
	[...container.querySelectorAll("path")].filter((p) => {
		const fill = p.getAttribute("fill")
		return fill !== null && fill !== "none"
	})

describe("BarPlot — histogram density curve overlay", () => {
	it("draws no density curve when the toggle is off", () => {
		seed({ mode: "count", showDensity: false })
		expect(curvePaths(mount().container)).toHaveLength(0)
	})

	it("draws a density curve over a count histogram when enabled", () => {
		seed({ mode: "count", showDensity: true })
		expect(curvePaths(mount().container).length).toBeGreaterThan(0)
	})

	it("draws a density curve over a density-mode histogram too", () => {
		seed({ mode: "density", showDensity: true })
		expect(curvePaths(mount().container).length).toBeGreaterThan(0)
	})

	it("adds a filled area path only when fill is enabled", () => {
		seed({ mode: "count", showDensity: true, densityFill: false })
		const without = filledPaths(mount().container).length
		seed({ mode: "count", showDensity: true, densityFill: true })
		const withFill = filledPaths(mount().container).length
		expect(withFill).toBeGreaterThan(without)
	})

	it("the filled area honors the Density Curve Fill opacity slot", () => {
		installInMemoryLocalStorage()
		/* eslint-disable no-restricted-globals, @th/no-storage-outside-try, @th/use-wrapped-json-functions */
		const set = (k: string, v: unknown) => localStorage.setItem(k, JSON.stringify(v))
		set("vis-components:datasets", { [DATASET_ID]: buildDataset() })
		set("vis-components:currentDatasetId", DATASET_ID)
		set("vis-components:previewVersionId", null)
		set("vis-components:currentEncodings", {
			...emptyEncodings(),
			x: { field: "score" },
		})
		set("vis-components:currentChannelConfigs", {
			x: {
				...DEFAULT_AXIS_CONFIG,
				histogram: {
					enabled: true,
					binCount: 8,
					mode: "count",
					showDensity: true,
					densityFill: true,
				},
			},
			opacitySlots: { densityCurveFill: { field: null, level: 0.8 } },
		})
		set("vis-components:currentLabels", { _v: 1, data: DEFAULT_LABELS_CONFIG })
		/* eslint-enable no-restricted-globals, @th/no-storage-outside-try, @th/use-wrapped-json-functions */
		const { container } = mount()
		const areas = [...container.querySelectorAll("path")].filter(
			(p) => p.getAttribute("stroke") === "none" && p.getAttribute("fill") !== "none"
		)
		expect(areas.length).toBeGreaterThan(0)
		expect(areas[0]?.getAttribute("fill-opacity")).toBe("0.8")
	})

	it("'vary by' a field draws one curve per category (grouped density)", () => {
		// Dataset with a 3-level categorical field; map it to the density curve
		// outline color so the curve splits into one KDE per category.
		installInMemoryLocalStorage()
		/* eslint-disable no-restricted-globals, @th/no-storage-outside-try, @th/use-wrapped-json-functions */
		const set = (k: string, v: unknown) => localStorage.setItem(k, JSON.stringify(v))
		set("vis-components:datasets", {
			[DATASET_ID]: {
				id: DATASET_ID,
				name: "g",
				fields: [
					{ name: "score", inferredType: "quantitative" },
					{ name: "grp", inferredType: "categorical" },
				],
				versions: [
					{
						id: "v1",
						filename: "g.csv",
						rows: Array.from({ length: 60 }, (_, i) => ({
							score: String((i * 7) % 100),
							grp: ["A", "B", "C"][i % 3]!,
						})),
						createdAt: 0,
					},
				],
				latestVersionId: "v1",
				createdAt: 0,
			},
		})
		set("vis-components:currentDatasetId", DATASET_ID)
		set("vis-components:previewVersionId", null)
		set("vis-components:currentEncodings", { ...emptyEncodings(), x: { field: "score" } })
		set("vis-components:currentChannelConfigs", {
			x: {
				...DEFAULT_AXIS_CONFIG,
				histogram: {
					enabled: true,
					binCount: 8,
					showDensity: true,
					densityFill: true,
				},
			},
			colorSlots: {
				densityCurveStroke: {
					field: "grp",
					singleColor: "#475569",
					paletteId: "custom",
					palette: ["#e41a1c", "#377eb8", "#4daf4a"],
					hue: { type: "categorical", colors: {} },
				},
			},
			opacitySlots: { densityCurveFill: { field: null, level: 0.7 } },
		})
		set("vis-components:currentLabels", { _v: 1, data: DEFAULT_LABELS_CONFIG })
		/* eslint-enable no-restricted-globals, @th/no-storage-outside-try, @th/use-wrapped-json-functions */
		// Three categories → three curve paths, each a distinct stroke color.
		const { container } = mount()
		const curves = curvePaths(container)
		expect(curves.length).toBe(3)
		const strokes = new Set(curves.map((p) => p.getAttribute("stroke")))
		expect(strokes.size).toBe(3)
		// Grouped curves each fill their area at the Density Curve Fill slot's
		// opacity level.
		const areas = [...container.querySelectorAll("path")].filter(
			(p) => p.getAttribute("stroke") === "none" && p.getAttribute("fill") !== "none"
		)
		expect(areas.length).toBe(3)
		for (const a of areas) expect(a.getAttribute("fill-opacity")).toBe("0.7")
	})
})
