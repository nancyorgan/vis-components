import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { TestProvider } from "../../../../testSupport/TestProvider"
import { DEFAULT_LEGEND_CONFIG, type LegendConfig } from "../../lib/labelsConfig"
import { emptyEncodings, type Dataset } from "../../lib/types"
import { currentLegendConfigAtom } from "../../store/atoms"

import { ChartCanvas } from "./ChartCanvas"

/** `[data-chart-root]` marks the figure the published picture captures
 *  (`publishEmbed.ts` → `renderExport(document, …, { root })`). Every legend
 *  layout must carry it — the inside-legend layout once didn't, and every
 *  chart with an inside legend published without a picture. */

afterEach(cleanup)

const DATASET_ID = "ds-chart-root"

const buildDataset = (): Dataset => ({
	id: DATASET_ID,
	name: "m",
	fields: [
		{ name: "x", inferredType: "quantitative" },
		{ name: "y", inferredType: "quantitative" },
		{ name: "c", inferredType: "categorical" },
	],
	versions: [
		{
			id: "v1",
			filename: "m.csv",
			rows: [
				{ x: "1", y: "10", c: "a" },
				{ x: "2", y: "20", c: "b" },
			],
			createdAt: 0,
		},
	],
	latestVersionId: "v1",
	createdAt: 0,
})

const seed = () => {
	const store = installInMemoryLocalStorage()
	/* eslint-disable @vc/use-wrapped-json-functions */
	store.set("vis-components:datasets", JSON.stringify({ [DATASET_ID]: buildDataset() }))
	store.set("vis-components:currentDatasetId", JSON.stringify(DATASET_ID))
	store.set("vis-components:previewVersionId", JSON.stringify(null))
	store.set(
		"vis-components:currentEncodings",
		JSON.stringify({
			...emptyEncodings(),
			x: { field: "x" },
			y: { field: "y" },
			hue: { field: "c" },
		})
	)
	/* eslint-enable @vc/use-wrapped-json-functions */
}

const mount = (position: LegendConfig["position"]) =>
	render(
		<TestProvider
			initializeState={(snap) => {
				snap.set(currentLegendConfigAtom, { ...DEFAULT_LEGEND_CONFIG, position })
			}}
		>
			<div style={{ width: 800, height: 600 }}>
				<ChartCanvas />
			</div>
		</TestProvider>
	)

describe("ChartCanvas — [data-chart-root] on every legend layout", () => {
	it.each(["right", "left", "top", "bottom", "inside"] as const)(
		"legend position %s renders exactly one chart root holding the plot",
		(position) => {
			seed()
			const { container } = mount(position)
			const roots = container.querySelectorAll("[data-chart-root]")
			expect(roots.length).toBe(1)
			expect(roots[0].querySelector("svg")).not.toBeNull()
		}
	)
})
