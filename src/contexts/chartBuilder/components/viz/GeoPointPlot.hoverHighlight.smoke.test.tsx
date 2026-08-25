/* eslint-disable no-restricted-globals, @th/no-storage-outside-try -- tests seed localStorage deliberately */
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import {
	TestProvider,
	type TestStore,
} from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import { DEFAULT_HOVER_HIGHLIGHT_COLOR } from "../../lib/labelsConfig"
import { DEFAULT_MAP_CONFIG } from "../../lib/mapConfig"
import { emptyEncodings, type Dataset } from "../../lib/types"
import {
	currentTooltipConfigAtom,
	hoveredLegendEntryAtom,
} from "../../store/atoms"
import { LEGEND_HIGHLIGHT_DIM } from "../../store/useLegendHighlight"

import { GeoPointPlot } from "./GeoPointPlot"

/** Legend-hover highlight on the lat/long dot map: dots whose row carries the
 *  hovered category keep full presentation, the rest fade. The geography
 *  BACKDROP is context rather than a mark, so it never dims. */

const DATASET_ID = "ds-geo-point-hover"

const CITIES: Record<string, string>[] = [
	{ city: "NYC", region: "east", lon: "-74", lat: "40.7", pop: "8400000" },
	{ city: "LA", region: "west", lon: "-118", lat: "34", pop: "3900000" },
	{ city: "Chicago", region: "midwest", lon: "-87.6", lat: "41.8", pop: "2700000" },
	{ city: "Boston", region: "east", lon: "-71", lat: "42.3", pop: "700000" },
]

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "cities",
		filename: "cities.csv",
		fields: [
			{ name: "city", inferredType: "categorical" },
			{ name: "region", inferredType: "categorical" },
			{ name: "lon", inferredType: "quantitative" },
			{ name: "lat", inferredType: "quantitative" },
			{ name: "pop", inferredType: "quantitative" },
		],
		rows: CITIES,
	})

const seed = () => {
	installInMemoryLocalStorage()
	/* eslint-disable @th/use-wrapped-json-functions */
	const set = (k: string, v: unknown) =>
		localStorage.setItem(k, JSON.stringify(v))
	set("vis-components:datasets", { [DATASET_ID]: buildDataset() })
	set("vis-components:currentDatasetId", DATASET_ID)
	set("vis-components:previewVersionId", null)
	set("vis-components:currentEncodings", {
		...emptyEncodings(),
		x: { field: "lon" },
		y: { field: "lat" },
		hue: { field: "region" },
	})
	set("vis-components:currentMapConfig", {
		...DEFAULT_MAP_CONFIG,
		coordSystem: "geographic",
		geographyLevel: "states",
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
				<GeoPointPlot />
			</svg>
		</TestProvider>
	)
}

const dots = (container: HTMLElement) => [
	...container.querySelectorAll("circle"),
]

const waitForDots = async (container: HTMLElement) =>
	waitFor(() => {
		expect(dots(container).length).toBe(4)
	})

const opacityOf = (el: Element) => el.getAttribute("opacity")

afterEach(cleanup)

describe("GeoPointPlot legend-hover highlight", () => {
	it("renders identically to no-hover when nothing is hovered", async () => {
		seed()
		const { container } = mount(null)
		await waitForDots(container)
		expect(dots(container).map(opacityOf)).toEqual([null, null, null, null])
	})

	it("keeps the hovered category's dots and fades the others", async () => {
		seed()
		const { container } = mount({ field: "region", value: "east" })
		await waitForDots(container)
		const bright = dots(container).filter((c) => opacityOf(c) === null)
		const faded = dots(container).filter((c) => opacityOf(c) !== null)
		// NYC + Boston are "east".
		expect(bright.length).toBe(2)
		expect(faded.length).toBe(2)
		for (const c of faded)
			expect(Number(opacityOf(c))).toBeCloseTo(LEGEND_HIGHLIGHT_DIM, 5)
	})

	it("leaves the geography backdrop untouched while a category is hovered", async () => {
		// The basemap is geographic CONTEXT (uniform no-data fill,
		// non-interactive), not a data mark — it must render unchanged.
		seed()
		const { container } = mount({ field: "region", value: "east" })
		await waitForDots(container)
		const backdrop = [...container.querySelectorAll("path")]
		expect(backdrop.length).toBeGreaterThanOrEqual(50)
		expect(backdrop.every((p) => opacityOf(p) === null)).toBe(true)
	})

	it("leaves every dot untouched when an unrelated field is hovered", async () => {
		seed()
		const { container } = mount({ field: "not_a_column", value: "east" })
		await waitForDots(container)
		expect(dots(container).every((c) => opacityOf(c) === null)).toBe(true)
	})

	it("recolors the matching dots when Recolor is on", async () => {
		seed()
		const { container } = mount(
			{ field: "region", value: "west" },
			{ hoverEnabled: true, hoverRecolor: true, hoverFade: true }
		)
		await waitForDots(container)
		const recolored = dots(container).filter(
			(c) => c.getAttribute("fill") === DEFAULT_HOVER_HIGHLIGHT_COLOR
		)
		// Only LA is "west".
		expect(recolored.length).toBe(1)
		expect(opacityOf(recolored[0])).toBeNull()
	})

	it("hovering a dot highlights its whole category (mark → legend direction)", async () => {
		// The reverse direction the cartesian renderers have: a categorical hue
		// means the mark's own value publishes to the same atom.
		seed()
		const { container } = mount(null)
		await waitForDots(container)
		// Hue is categorical, so a dot's FILL identifies its category — the
		// expected bright count is however many dots share the hovered one's
		// color (order-independent).
		const hoveredDot = dots(container)[0]
		const category = hoveredDot.getAttribute("fill")
		const sameCategory = dots(container).filter(
			(c) => c.getAttribute("fill") === category
		).length
		fireEvent.mouseEnter(hoveredDot)
		await waitFor(() => {
			expect(
				dots(container).filter((c) => opacityOf(c) !== null).length
			).toBe(dots(container).length - sameCategory)
		})
		// The hovered dot itself is one of the bright ones.
		expect(
			dots(container).filter((c) => opacityOf(c) === null).length
		).toBe(sameCategory)
	})

	it("clears the highlight when the pointer leaves the map", async () => {
		seed()
		const { container } = mount(null)
		await waitForDots(container)
		const dot = dots(container)[0]
		fireEvent.mouseEnter(dot)
		await waitFor(() => {
			expect(dots(container).some((c) => opacityOf(c) !== null)).toBe(true)
		})
		fireEvent.mouseLeave(container.querySelector("g")!)
		await waitFor(() => {
			expect(dots(container).every((c) => opacityOf(c) === null)).toBe(true)
		})
	})
})
