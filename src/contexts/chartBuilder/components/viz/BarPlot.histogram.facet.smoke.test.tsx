import { render } from "@testing-library/react"
import { TestProvider } from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import { describe, expect, it } from "vitest"
import { DEFAULT_AXIS_CONFIG } from "../../lib/channelConfig"
import { DEFAULT_LABELS_CONFIG } from "../../lib/labelsConfig"
import { emptyEncodings, type Dataset } from "../../lib/types"

import { ChartCanvas } from "./ChartCanvas"

/** Faceted histogram: each panel must bin + COUNT its own facet group's rows
 *  (not the global total), while sharing bin edges and the count axis across
 *  panels (default shareX/shareY = "all"). Data is built so the two groups
 *  have DIFFERENT counts in a single shared bin, so per-panel counting is
 *  distinguishable from global counting by the bar heights. */

const DATASET_ID = "ds-hist-facet"

/** grp A: 5 rows (scores 1..5); grp B: 4 rows (scores 15..18). With one shared
 *  bin spanning the union, A's bar encodes 5 and B's encodes 4. */
const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "scores",
		filename: "scores.csv",
		fields: [
			{ name: "score", inferredType: "quantitative" },
			{ name: "grp", inferredType: "categorical" },
		],
		rows: [
			...[1, 2, 3, 4, 5].map((s) => ({ score: String(s), grp: "A" })),
			...[15, 16, 17, 18].map((s) => ({ score: String(s), grp: "B" })),
		],
	})

const seed = () => {
	installInMemoryLocalStorage()
	store_set("vis-components:datasets", { [DATASET_ID]: buildDataset() })
	store_set("vis-components:currentDatasetId", DATASET_ID)
	store_set("vis-components:previewVersionId", null)
	store_set("vis-components:currentEncodings", {
		...emptyEncodings(),
		x: { field: "score" },
		facet: { field: "grp" },
	})
	store_set("vis-components:currentChannelConfigs", {
		x: { ...DEFAULT_AXIS_CONFIG, histogram: { enabled: true, binCount: 1 } },
	})
	store_set("vis-components:currentLabels", { _v: 1, data: DEFAULT_LABELS_CONFIG })
}

const store_set = (key: string, value: unknown) => {
	/* eslint-disable-next-line no-restricted-globals, @th/no-storage-outside-try, @th/use-wrapped-json-functions */
	localStorage.setItem(key, JSON.stringify(value))
}

const mount = () =>
	render(
		<TestProvider>
			<div style={{ width: 900, height: 600 }}>
				<ChartCanvas />
			</div>
		</TestProvider>
	)

/** Mark rects (stroked) sorted left-to-right, i.e. by facet panel. */
const markRects = (container: HTMLElement) =>
	[...container.querySelectorAll("rect")]
		.filter((r) => r.getAttribute("stroke") !== null)
		.map((r) => ({
			x: Number(r.getAttribute("x")),
			height: Number(r.getAttribute("height")),
		}))
		.sort((a, b) => a.x - b.x)

describe("histogram faceting", () => {
	// NOTE: happy-dom does no layout, so the facet layout solver (which sizes
	// panels from the MEASURED container) produces 0×0 panels here — bar
	// geometry can't be asserted in this environment. This test guards the
	// render PATH (histogram + facet renders one bar per panel without
	// throwing); the per-panel COUNT correctness + shared bin edges are
	// verified deterministically by the `binnedCounts` unit tests in
	// histogramBins.test.ts.
	it("renders one count bar per facet panel without crashing", () => {
		seed()
		const { container } = mount()
		expect(markRects(container)).toHaveLength(2)
	})
})
