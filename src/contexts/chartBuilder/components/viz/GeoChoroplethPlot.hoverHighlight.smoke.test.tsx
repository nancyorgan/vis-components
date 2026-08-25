/* eslint-disable no-restricted-globals, @th/no-storage-outside-try -- tests seed localStorage deliberately */
import { cleanup, render, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import {
	TestProvider,
	type TestStore,
} from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import {
	DEFAULT_HOVER_HIGHLIGHT_COLOR,
	DEFAULT_HOVER_OUTLINE_COLOR,
} from "../../lib/labelsConfig"
import { DEFAULT_MAP_CONFIG } from "../../lib/mapConfig"
import { MAP_CONFIG_VERSION } from "../../lib/storage/migrations"
import { emptyEncodings, type Dataset } from "../../lib/types"
import {
	currentTooltipConfigAtom,
	hoveredLegendEntryAtom,
} from "../../store/atoms"
import { LEGEND_HIGHLIGHT_DIM } from "../../store/useLegendHighlight"

import { GeoChoroplethPlot } from "./GeoChoroplethPlot"

/** Legend-hover highlight on the choropleth: hovering a categorical legend
 *  entry keeps the matching regions at full presentation and fades everything
 *  else — INCLUDING the no-data regions, which belong to no category and so
 *  must never light up.
 *
 *  Seeding mirrors GeoChoroplethPlot.smoke.test.tsx (localStorage for the
 *  dataset / encodings / map config); the transient hover atom and the
 *  Hover-appearance options go through `initializeState`, which wins over the
 *  persisted bootstrap. */

const DATASET_ID = "ds-geo-choropleth-hover"

/** CA / TX / NY carry a categorical `region` alongside the quantitative
 *  `rate`; every other state is absent from the dataset (no-data regions). */
const ROWS: Record<string, string>[] = [
	{ state: "CA", region: "west", rate: "1" },
	{ state: "TX", region: "south", rate: "2" },
	{ state: "NY", region: "east", rate: "3" },
]

const buildDataset = (rows: Record<string, string>[] = ROWS): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "rates",
		filename: "rates.csv",
		fields: [
			{ name: "state", inferredType: "categorical" },
			{ name: "region", inferredType: "categorical" },
			{ name: "rate", inferredType: "quantitative" },
		],
		rows,
	})

type SeedOpts = {
	rows?: Record<string, string>[]
	/** Encoding overrides merged over `connection: state` (default hue is the
	 *  categorical `region`, so the legend has discrete entries). */
	encodings?: Record<string, unknown>
	mapConfig?: Partial<typeof DEFAULT_MAP_CONFIG>
}

const seed = (opts: SeedOpts = {}) => {
	installInMemoryLocalStorage()
	/* eslint-disable @th/use-wrapped-json-functions */
	const set = (k: string, v: unknown) =>
		localStorage.setItem(k, JSON.stringify(v))
	set("vis-components:datasets", { [DATASET_ID]: buildDataset(opts.rows) })
	set("vis-components:currentDatasetId", DATASET_ID)
	set("vis-components:previewVersionId", null)
	set("vis-components:currentEncodings", {
		...emptyEncodings(),
		connection: { field: "state" },
		hue: { field: "region" },
		...opts.encodings,
	})
	// Versioned envelope so the overrides are taken literally (see the sibling
	// smoke test: a bare object runs the v5→v6 showNoDataRegions reset).
	set("vis-components:currentMapConfig", {
		_v: MAP_CONFIG_VERSION,
		data: {
			...DEFAULT_MAP_CONFIG,
			coordSystem: "geographic",
			showNoDataRegions: true,
			...opts.mapConfig,
		},
	})
	/* eslint-enable @th/use-wrapped-json-functions */
}

/** Mount with an optional hovered legend entry + Hover appearance options. */
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
				<GeoChoroplethPlot />
			</svg>
		</TestProvider>
	)
}

/** Region paths only — the `<pattern>` defs contain paths of their own. */
const markPaths = (container: HTMLElement) =>
	[...container.querySelectorAll("path")].filter(
		(p) => p.closest("defs") === null
	)

const waitForRegions = async (container: HTMLElement) =>
	waitFor(() => {
		expect(markPaths(container).length).toBeGreaterThanOrEqual(50)
	})

/** Paths carrying NO `opacity` attribute — i.e. rendered exactly as they would
 *  be with no hover at all. */
const undimmed = (container: HTMLElement) =>
	markPaths(container).filter((p) => p.getAttribute("opacity") === null)

const dimmedValues = (container: HTMLElement) =>
	markPaths(container)
		.map((p) => p.getAttribute("opacity"))
		.filter((o): o is string => o !== null)
		.map(Number)

afterEach(cleanup)

describe("GeoChoroplethPlot legend-hover highlight", () => {
	it("renders identically to no-hover when nothing is hovered", async () => {
		seed()
		const { container } = mount(null)
		await waitForRegions(container)
		// Not one region carries an opacity attribute: the hover path is
		// completely inert until something is hovered.
		expect(dimmedValues(container)).toEqual([])
		expect(undimmed(container).length).toBe(markPaths(container).length)
	})

	it("keeps the matching region at full presentation and fades every other region", async () => {
		seed()
		const { container } = mount({ field: "region", value: "west" })
		await waitForRegions(container)
		// Exactly one region (CA, the only "west" row) is undimmed.
		const bright = undimmed(container)
		expect(bright.length).toBe(1)
		// Its fill is the hue-scale color, not the no-data fill.
		expect(bright[0].getAttribute("fill")).not.toBe(
			DEFAULT_MAP_CONFIG.noDataFill
		)
		// Everything else — the two other data regions AND the ~53 no-data
		// regions — dropped to the default faded level.
		const dimmed = dimmedValues(container)
		expect(dimmed.length).toBe(markPaths(container).length - 1)
		for (const o of dimmed) expect(o).toBeCloseTo(LEGEND_HIGHLIGHT_DIM, 5)
	})

	it("fades the no-data regions along with the rest (they never highlight)", async () => {
		seed()
		const { container } = mount({ field: "region", value: "west" })
		await waitForRegions(container)
		const noData = markPaths(container).filter(
			(p) => p.getAttribute("fill") === DEFAULT_MAP_CONFIG.noDataFill
		)
		expect(noData.length).toBeGreaterThan(10)
		for (const p of noData)
			expect(Number(p.getAttribute("opacity"))).toBeCloseTo(
				LEGEND_HIGHLIGHT_DIM,
				5
			)
	})

	it("never highlights a no-data region even when its row IS in the hovered category", async () => {
		// The precise no-data rule: TX carries `region: south` (the hovered
		// category) but a BLANK measure, so it draws in the no-data paint. It
		// must fade with the rest rather than light up — a region with no
		// measure isn't a member of anything. The categorical channel doing the
		// hovering here is `outlineHue`, with the gradient measure on hue.
		seed({
			rows: [
				{ state: "CA", region: "west", rate: "1" },
				{ state: "TX", region: "south", rate: "" },
				{ state: "NY", region: "south", rate: "3" },
			],
			encodings: {
				hue: { field: "rate" },
				outlineHue: { field: "region" },
			},
			mapConfig: { noDataPattern: 1 },
		})
		const { container } = mount({ field: "region", value: "south" })
		await waitForRegions(container)
		// Only NY (south, WITH a measure) stays bright.
		const bright = undimmed(container)
		expect(bright.length).toBe(1)
		expect(bright[0].getAttribute("fill")).not.toBe("url(#vc-pat-nodata)")
		// Every no-data-pattern region — TX included — is faded.
		const noDataPatterned = markPaths(container).filter(
			(p) => p.getAttribute("fill") === "url(#vc-pat-nodata)"
		)
		expect(noDataPatterned.length).toBeGreaterThan(10)
		for (const p of noDataPatterned)
			expect(Number(p.getAttribute("opacity"))).toBeCloseTo(
				LEGEND_HIGHLIGHT_DIM,
				5
			)
	})

	it("leaves the map untouched when an unrelated field is hovered", async () => {
		seed()
		const { container } = mount({ field: "not_a_column", value: "west" })
		await waitForRegions(container)
		expect(dimmedValues(container)).toEqual([])
	})

	it("recolors the matching region when Recolor is on", async () => {
		seed()
		const { container } = mount(
			{ field: "region", value: "west" },
			{ hoverEnabled: true, hoverRecolor: true, hoverFade: true }
		)
		await waitForRegions(container)
		const bright = undimmed(container)
		expect(bright.length).toBe(1)
		expect(bright[0].getAttribute("fill")).toBe(DEFAULT_HOVER_HIGHLIGHT_COLOR)
		// The no-data regions keep their own paint — recolor is emphasis, and
		// they are never the matched mark.
		const fills = markPaths(container).map((p) => p.getAttribute("fill"))
		expect(
			fills.filter((f) => f === DEFAULT_HOVER_HIGHLIGHT_COLOR).length
		).toBe(1)
	})

	it("outlines the matching region when Outline is on", async () => {
		seed()
		const { container } = mount(
			{ field: "region", value: "west" },
			{ hoverEnabled: true, hoverOutline: true, hoverFade: true }
		)
		await waitForRegions(container)
		const bright = undimmed(container)
		expect(bright.length).toBe(1)
		expect(bright[0].getAttribute("stroke")).toBe(DEFAULT_HOVER_OUTLINE_COLOR)
		// The outline width wins over the (default 1px) region border.
		expect(Number(bright[0].getAttribute("stroke-width"))).toBeGreaterThan(1)
	})

	it("fades nothing when the user turned Fade other elements off", async () => {
		seed()
		const { container } = mount(
			{ field: "region", value: "west" },
			{ hoverEnabled: true, hoverRecolor: true, hoverFade: false }
		)
		await waitForRegions(container)
		// No fade → no opacity attributes at all; only the recolor marks the
		// matched region.
		expect(dimmedValues(container)).toEqual([])
		const fills = markPaths(container).map((p) => p.getAttribute("fill"))
		expect(
			fills.filter((f) => f === DEFAULT_HOVER_HIGHLIGHT_COLOR).length
		).toBe(1)
	})
})
