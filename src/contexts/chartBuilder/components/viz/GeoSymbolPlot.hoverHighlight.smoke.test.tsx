/* eslint-disable no-restricted-globals, @th/no-storage-outside-try -- tests seed localStorage deliberately */
import { cleanup, render, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import {
	TestProvider,
	type TestStore,
} from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import { DEFAULT_MAP_CONFIG } from "../../lib/mapConfig"
import { MAP_CONFIG_VERSION } from "../../lib/storage/migrations"
import { emptyEncodings, type Dataset } from "../../lib/types"
import {
	currentTooltipConfigAtom,
	hoveredLegendEntryAtom,
} from "../../store/atoms"
import { LEGEND_HIGHLIGHT_DIM } from "../../store/useLegendHighlight"

import { GeoSymbolPlot } from "./GeoSymbolPlot"

/** Legend-hover highlight on the bubble map. Both mark layers follow the
 *  hovered entry: the region choropleth basemap (a real measure-driven
 *  choropleth, no-data regions fading with the rest) and the centroid bubbles,
 *  which are keyed on the same joined rows. */

const DATASET_ID = "ds-geo-symbol-hover"

const ROWS: Record<string, string>[] = [
	{ state: "CA", region: "west", pop: "100" },
	{ state: "TX", region: "south", pop: "50" },
	{ state: "NY", region: "east", pop: "25" },
	{ state: "FL", region: "south", pop: "10" },
]

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "pops",
		filename: "pops.csv",
		fields: [
			{ name: "state", inferredType: "categorical" },
			{ name: "region", inferredType: "categorical" },
			{ name: "pop", inferredType: "quantitative" },
		],
		rows: ROWS,
	})

const seed = (mapConfig: Partial<typeof DEFAULT_MAP_CONFIG> = {}) => {
	installInMemoryLocalStorage()
	/* eslint-disable @th/use-wrapped-json-functions */
	const set = (k: string, v: unknown) =>
		localStorage.setItem(k, JSON.stringify(v))
	set("vis-components:datasets", { [DATASET_ID]: buildDataset() })
	set("vis-components:currentDatasetId", DATASET_ID)
	set("vis-components:previewVersionId", null)
	set("vis-components:currentEncodings", {
		...emptyEncodings(),
		connection: { field: "state" },
		area: { field: "pop" },
		// Categorical hue colors the REGION layer (bubbles take their own
		// color slots), giving the legend discrete entries to hover.
		hue: { field: "region" },
	})
	set("vis-components:currentMapConfig", {
		_v: MAP_CONFIG_VERSION,
		data: {
			...DEFAULT_MAP_CONFIG,
			coordSystem: "geographic",
			showNoDataRegions: true,
			...mapConfig,
		},
	})
	/* eslint-enable @th/use-wrapped-json-functions */
}

const mount = (
	hovered: { field: string; value: string } | null = null,
	hoverOptions: Record<string, unknown> = {}
) => {
	const init = (store: TestStore) => {
		store.set(hoveredLegendEntryAtom, hovered)
		if (Object.keys(hoverOptions).length > 0)
			store.set(currentTooltipConfigAtom, {
				enabled: true,
				visibleFields: [],
				customCss: "",
				customHtml: "",
				useCustomHtml: false,
				...hoverOptions,
			})
	}
	return render(
		<TestProvider initializeState={init}>
			<svg width={800} height={600}>
				<GeoSymbolPlot />
			</svg>
		</TestProvider>
	)
}

const bubbles = (container: HTMLElement) => [
	...container.querySelectorAll("circle"),
]
const regions = (container: HTMLElement) =>
	[...container.querySelectorAll("path")].filter(
		(p) => p.closest("defs") === null
	)
const opacityOf = (el: Element) => el.getAttribute("opacity")

const waitForBubbles = async (container: HTMLElement) =>
	waitFor(() => {
		expect(bubbles(container).length).toBe(4)
		expect(regions(container).length).toBeGreaterThanOrEqual(50)
	})

afterEach(cleanup)

describe("GeoSymbolPlot legend-hover highlight", () => {
	it("renders identically to no-hover when nothing is hovered", async () => {
		seed()
		const { container } = mount(null)
		await waitForBubbles(container)
		expect(bubbles(container).every((c) => opacityOf(c) === null)).toBe(true)
		expect(regions(container).every((p) => opacityOf(p) === null)).toBe(true)
	})

	it("fades the bubbles outside the hovered category", async () => {
		seed()
		const { container } = mount({ field: "region", value: "south" })
		await waitForBubbles(container)
		const bright = bubbles(container).filter((c) => opacityOf(c) === null)
		const faded = bubbles(container).filter((c) => opacityOf(c) !== null)
		// TX + FL are "south".
		expect(bright.length).toBe(2)
		expect(faded.length).toBe(2)
		for (const c of faded)
			expect(Number(opacityOf(c))).toBeCloseTo(LEGEND_HIGHLIGHT_DIM, 5)
	})

	it("fades the region choropleth too, no-data regions included", async () => {
		seed()
		const { container } = mount({ field: "region", value: "south" })
		await waitForBubbles(container)
		// Only the two "south" regions stay bright out of ~56 features.
		const brightRegions = regions(container).filter(
			(p) => opacityOf(p) === null
		)
		expect(brightRegions.length).toBe(2)
		const noData = regions(container).filter(
			(p) => p.getAttribute("fill") === DEFAULT_MAP_CONFIG.noDataFill
		)
		expect(noData.length).toBeGreaterThan(10)
		for (const p of noData)
			expect(Number(opacityOf(p))).toBeCloseTo(LEGEND_HIGHLIGHT_DIM, 5)
	})

	it("leaves both layers untouched when an unrelated field is hovered", async () => {
		seed()
		const { container } = mount({ field: "not_a_column", value: "south" })
		await waitForBubbles(container)
		expect(bubbles(container).every((c) => opacityOf(c) === null)).toBe(true)
		expect(regions(container).every((p) => opacityOf(p) === null)).toBe(true)
	})

	it("with the basemap off still highlights the bubbles", async () => {
		seed({ showBasemap: false })
		const { container } = mount({ field: "region", value: "west" })
		await waitFor(() => {
			expect(bubbles(container).length).toBe(4)
		})
		// Only CA is "west".
		expect(bubbles(container).filter((c) => opacityOf(c) === null).length).toBe(
			1
		)
	})
})
