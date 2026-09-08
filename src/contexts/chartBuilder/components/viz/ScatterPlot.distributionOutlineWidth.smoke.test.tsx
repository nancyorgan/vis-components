import { render } from "@testing-library/react"
import { TestProvider } from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import { describe, expect, it } from "vitest"
import {
	DEFAULT_AXIS_CONFIG,
	DEFAULT_DISTRIBUTION_OVERLAY_CONFIG,
	DEFAULT_SHAPE_CONFIG,
} from "../../lib/channelConfig"
import { DEFAULT_LABELS_CONFIG } from "../../lib/labelsConfig"
import { emptyEncodings, type Dataset } from "../../lib/types"

import { ChartCanvas } from "./ChartCanvas"

/** The violin outline and the box borders follow the Shape panel's
 *  "Violin / box outline" knob (`shape.distributionOutlineWidth`) —
 *  independent of `shape.outlineWidth`, which the point marks read. The
 *  median line keeps its 1.5× emphasis relative to that width. */

const DATASET_ID = "ds-dist-outline"

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "scores",
		filename: "scores.csv",
		fields: [{ name: "score", inferredType: "quantitative" }],
		rows: Array.from({ length: 20 }, (_, i) => ({ score: String(i + 1) })),
	})

const seed = (outlineWidth: number) => {
	installInMemoryLocalStorage()
	/* eslint-disable no-restricted-globals, @th/no-storage-outside-try, @th/use-wrapped-json-functions */
	const set = (k: string, v: unknown) => localStorage.setItem(k, JSON.stringify(v))
	set("vis-components:datasets", { [DATASET_ID]: buildDataset() })
	set("vis-components:currentDatasetId", DATASET_ID)
	set("vis-components:previewVersionId", null)
	// Only X is mapped (a single quantitative variable → horizontal overlays).
	set("vis-components:currentEncodings", {
		...emptyEncodings(),
		x: { field: "score" },
	})
	set("vis-components:currentChannelConfigs", {
		x: {
			...DEFAULT_AXIS_CONFIG,
			distributionOverlay: {
				...DEFAULT_DISTRIBUTION_OVERLAY_CONFIG,
				showBoxPlot: true,
				showDensityViolin: true,
				showPoints: false,
			},
		},
		// A different point outline width, to prove the violin/box knob is
		// independent of it.
		shape: {
			...DEFAULT_SHAPE_CONFIG,
			outlineWidth: 7,
			distributionOutlineWidth: outlineWidth,
		},
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

describe("distribution overlay outline width", () => {
	it("applies the Shape panel's violin/box outline width to the violin path and box borders", () => {
		seed(3)
		const { container } = mount()

		// The violin body is the only <path> filled with the overlay fill color.
		const violin = [...container.querySelectorAll("path")].find(
			(p) =>
				p.getAttribute("fill") === DEFAULT_DISTRIBUTION_OVERLAY_CONFIG.fillColor
		)
		expect(violin).toBeTruthy()
		expect(violin!.getAttribute("stroke-width")).toBe("3")

		// The box body is the only <rect> filled with that color; its parent
		// group carries the width for the rect, whiskers, and caps.
		const boxRect = [...container.querySelectorAll("rect")].find(
			(r) =>
				r.getAttribute("fill") === DEFAULT_DISTRIBUTION_OVERLAY_CONFIG.fillColor
		)
		expect(boxRect).toBeTruthy()
		expect(boxRect!.parentElement?.getAttribute("stroke-width")).toBe("3")

		// The median line keeps its 1.5× emphasis over the configured width.
		const median = [...container.querySelectorAll("line")].find(
			(l) => l.getAttribute("stroke-width") === "4.5"
		)
		expect(median).toBeTruthy()
	})
})
