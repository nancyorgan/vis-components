import { render } from "@testing-library/react"
import { TestProvider } from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import { describe, expect, it } from "vitest"
import {
	DEFAULT_AXIS_CONFIG,
	DEFAULT_DISTRIBUTION_OVERLAY_CONFIG,
} from "../../lib/channelConfig"
import { DEFAULT_LABELS_CONFIG } from "../../lib/labelsConfig"
import { emptyEncodings, type Dataset } from "../../lib/types"

import { ChartCanvas } from "./ChartCanvas"

/** A violin/box of a SINGLE quantitative variable — only one position axis is
 *  mapped, the other is empty. ScatterPlot normally requires both axes; this
 *  exercises the dedicated single-group render path. */

const DATASET_ID = "ds-single-var-dist"

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "scores",
		filename: "scores.csv",
		fields: [{ name: "score", inferredType: "quantitative" }],
		rows: Array.from({ length: 30 }, (_, i) => ({ score: String(i + 1) })),
	})

const seed = (
	overlay: Record<string, unknown> | null,
	histogram?: Record<string, unknown>
) => {
	installInMemoryLocalStorage()
	/* eslint-disable no-restricted-globals, @th/no-storage-outside-try, @th/use-wrapped-json-functions */
	const set = (k: string, v: unknown) => localStorage.setItem(k, JSON.stringify(v))
	set("vis-components:datasets", { [DATASET_ID]: buildDataset() })
	set("vis-components:currentDatasetId", DATASET_ID)
	set("vis-components:previewVersionId", null)
	// Only X is mapped (a single quantitative variable, no Y).
	set("vis-components:currentEncodings", {
		...emptyEncodings(),
		x: { field: "score" },
	})
	set(
		"vis-components:currentChannelConfigs",
		overlay
			? {
					x: {
						...DEFAULT_AXIS_CONFIG,
						distributionOverlay: {
							...DEFAULT_DISTRIBUTION_OVERLAY_CONFIG,
							...overlay,
						},
						...(histogram
							? { histogram: { ...DEFAULT_AXIS_CONFIG.histogram, ...histogram } }
							: {}),
					},
				}
			: {}
	)
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

describe("single-variable distribution (one quant axis, no other)", () => {
	it("renders a violin for a single variable", () => {
		seed({ showDensityViolin: true })
		const { container } = mount()
		// ViolinShape renders a filled <path>; a single-group violin = ≥1 path.
		expect(container.querySelectorAll("path").length).toBeGreaterThan(0)
	})

	it("renders a standalone density curve (a stroked KDE line) for a single variable", () => {
		seed({ showDensityCurve: true })
		const { container } = mount()
		// DensityCurveShape draws an open, unfilled line at stroke-width 2.
		const curves = [...container.querySelectorAll("path")].filter(
			(p) =>
				p.getAttribute("fill") === "none" &&
				p.getAttribute("stroke-width") === "2"
		)
		expect(curves.length).toBeGreaterThan(0)
	})

	it("fills under the density curve only when fill is enabled (shared histogram config)", () => {
		// Fill lives on the histogram config (shared with the histogram overlay),
		// so the standalone curve reads `histogram.densityFill`.
		const filledPaths = (histogram: Record<string, unknown>) => {
			seed({ showDensityCurve: true }, histogram)
			return [...mount().container.querySelectorAll("path")].filter((p) => {
				const fill = p.getAttribute("fill")
				return fill !== null && fill !== "none"
			}).length
		}
		const without = filledPaths({ densityFill: false })
		const withFill = filledPaths({ densityFill: true })
		expect(withFill).toBeGreaterThan(without)
	})

	it("draws the rug as tassels (lines), reusing the shared histogram rug config", () => {
		// Density + the shared histogram rug toggle → tassel <line>s along the
		// floor (not scatter circles). This is what makes the rug + its sizes
		// persist across the Histogram ⇄ Density switch.
		seed(
			{ showDensityCurve: true },
			{ showRug: true, rugTickLength: 24, rugTickThickness: 3 }
		)
		const { container } = mount()
		const tassels = [...container.querySelectorAll("line")].filter(
			(l) => l.getAttribute("stroke-width") === "3"
		)
		expect(tassels.length).toBeGreaterThan(0)
	})

	it("draws no rug tassels when the shared rug toggle is off", () => {
		seed({ showDensityCurve: true }, { showRug: false })
		const { container } = mount()
		const tassels = [...container.querySelectorAll("line")].filter(
			(l) => l.getAttribute("stroke-width") === "3"
		)
		expect(tassels).toHaveLength(0)
	})

	it("renders nothing distribution-like when no overlay is enabled", () => {
		// One quant axis with no violin/box selected → ScatterPlot has nothing
		// to draw (it needs both axes for points).
		seed(null)
		const { container } = mount()
		expect(container.querySelectorAll("path").length).toBe(0)
	})
})
