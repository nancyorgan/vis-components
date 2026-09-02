import { cleanup, fireEvent, render, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import {
	TestProvider,
	type TestStore,
} from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import {
	DEFAULT_CONNECTION_CONFIG,
	DEFAULT_DATA_LABELS_CONFIG,
	EMPTY_CHANNEL_CONFIGS,
} from "../../lib/channelConfig"
import { DEFAULT_LABELS_CONFIG } from "../../lib/labelsConfig"
import {
	emptyDataLabelsEncodings,
	emptyEncodings,
	type Dataset,
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
	currentTooltipConfigAtom,
	hoveredLegendEntryAtom,
	loadedDatasetsAtom,
	previewVersionIdAtom,
} from "../../store/atoms"
import { DEFAULT_HOVER_HIGHLIGHT_COLOR } from "../../lib/labelsConfig"
import { LEGEND_HIGHLIGHT_DIM } from "../../store/useLegendHighlight"

import { ScatterPlot } from "./ScatterPlot"

/** Legend-hover highlight completeness on the cartesian renderer: the fade
 *  applies to every mark PART, not just the point. A lollipop's stem and a
 *  point's data label belong to the point they annotate, so hovering one
 *  category must leave the other categories' stems and labels receded too —
 *  otherwise the "faded" series stays visually loud through its labels. */

const DATASET_ID = "ds-scatter-hover"

const buildDataset = (): Dataset => ({
	id: DATASET_ID,
	name: "lolli",
	fields: [
		{ name: "x", inferredType: "categorical" },
		{ name: "y", inferredType: "quantitative" },
		{ name: "g", inferredType: "categorical" },
	],
	versions: [
		{
			id: "v1",
			filename: "lolli.csv",
			rows: [
				{ x: "a", y: "10", g: "north" },
				{ x: "b", y: "20", g: "north" },
				{ x: "c", y: "30", g: "south" },
				{ x: "d", y: "40", g: "south" },
			],
			createdAt: 0,
		},
	],
	latestVersionId: "v1",
	createdAt: 0,
})

type MountOpts = {
	/** Map the connection channel — turns the scatter into a line chart. */
	connect?: boolean
	/** Drop the hue encoding, leaving the connection field as the only
	 *  series identity (the plain line chart the quick start builds). */
	noHue?: boolean
	/** Overrides for the Hover appearance options (recolor / outline). */
	hoverOptions?: Record<string, unknown>
}

const initState =
	(hovered: { field: string; value: string } | null, opts: MountOpts) =>
	(snap: TestStore) => {
		snap.set(loadedDatasetsAtom, { [DATASET_ID]: buildDataset() })
		snap.set(currentDatasetIdAtom, DATASET_ID)
		snap.set(previewVersionIdAtom, null)
		snap.set(currentEncodingsAtom, {
			...emptyEncodings(),
			x: { field: "x" },
			y: { field: "y" },
			...(opts.noHue ? {} : { hue: { field: "g" } }),
			// Line chart: `g` groups the rows into two 2-point polylines.
			...(opts.connect ? { connection: { field: "g" } } : {}),
		})
		snap.set(currentChannelConfigsAtom, {
			...EMPTY_CHANNEL_CONFIGS,
			// Lollipop: a stem from every point down to the x axis.
			connection: { ...DEFAULT_CONNECTION_CONFIG, axisStem: "x-axis" },
		})
		snap.set(currentLabelsAtom, DEFAULT_LABELS_CONFIG)
		snap.set(currentDataLabelsConfigAtom, DEFAULT_DATA_LABELS_CONFIG)
		// Data labels need position + value mapped to render at all.
		snap.set(currentDataLabelsEncodingsAtom, {
			...emptyDataLabelsEncodings(),
			x: { field: "x" },
			y: { field: "y" },
			value: { field: "y" },
		})
		snap.set(currentFieldOverridesAtom, {})
		snap.set(currentFieldLevelOrdersAtom, {})
		snap.set(hoveredLegendEntryAtom, hovered)
		if (opts.hoverOptions)
			snap.set(currentTooltipConfigAtom, {
				enabled: true,
				visibleFields: [],
				customCss: "",
				customHtml: "",
				useCustomHtml: false,
				...opts.hoverOptions,
			})
	}

const mount = (
	hovered: { field: string; value: string } | null = null,
	opts: MountOpts = {}
) => {
	installInMemoryLocalStorage()
	const { container } = render(
		<TestProvider initializeState={initState(hovered, opts)}>
			<div style={{ width: 600, height: 400 }}>
				<ScatterPlot />
			</div>
		</TestProvider>
	)
	return container
}

const stemOpacities = (c: HTMLElement) =>
	[...c.querySelectorAll(".vc-axis-stem")].map((l) =>
		Number(l.getAttribute("opacity"))
	)

/** Each data label's effective fade. The Data Labels layer wraps every label
 *  in its own group under the layer root, and only writes the `opacity`
 *  attribute when the label is actually faded — so an absent attribute is
 *  full strength. Scoped to the layer so axis tick labels don't count. */
const labelOpacities = (c: HTMLElement) =>
	[
		...c.querySelectorAll(
			'g[aria-hidden="true"][pointer-events="none"] > g > text'
		),
	].map((t) => {
		const raw = t.parentElement?.getAttribute("opacity")
		return raw === null || raw === undefined ? 1 : Number(raw)
	})

/** Visible connection polylines only — the invisible wide hover-hit strokes
 *  carry `vc-line-hit` and never take the fade. */
const lineOpacities = (c: HTMLElement) =>
	[...c.querySelectorAll("polyline:not(.vc-line-hit)")].map((l) =>
		Number(l.getAttribute("opacity"))
	)

afterEach(cleanup)

describe("ScatterPlot legend-hover highlight — stems and labels", () => {
	it("draws every stem and label at full strength with nothing hovered", () => {
		const c = mount(null)
		const stems = stemOpacities(c)
		expect(stems.length).toBe(4)
		expect(stems.every((o) => o === 1)).toBe(true)
		const labels = labelOpacities(c)
		expect(labels.length).toBe(4)
		expect(labels.every((o) => o === 1)).toBe(true)
	})

	it("fades the stems of the non-hovered category", () => {
		const c = mount({ field: "g", value: "north" })
		const stems = stemOpacities(c).sort((a, b) => a - b)
		expect(stems.length).toBe(4)
		// Two "north" rows keep full opacity; the two "south" rows recede.
		expect(stems.filter((o) => o === 1).length).toBe(2)
		for (const o of stems.filter((v) => v !== 1))
			expect(o).toBeCloseTo(LEGEND_HIGHLIGHT_DIM, 5)
	})

	it("fades the data labels of the non-hovered category", () => {
		const c = mount({ field: "g", value: "north" })
		const labels = labelOpacities(c)
		expect(labels.length).toBe(4)
		expect(labels.filter((o) => o === 1).length).toBe(2)
		for (const o of labels.filter((v) => v !== 1))
			expect(o).toBeCloseTo(LEGEND_HIGHLIGHT_DIM, 5)
	})

	it("fades the connection line of the non-hovered series", () => {
		const c = mount({ field: "g", value: "north" }, { connect: true })
		const lines = lineOpacities(c)
		// One polyline per group: "north" stays full, "south" recedes.
		expect(lines.length).toBe(2)
		expect(lines.filter((o) => o === 1).length).toBe(1)
		for (const o of lines.filter((v) => v !== 1))
			expect(o).toBeCloseTo(LEGEND_HIGHLIGHT_DIM, 5)
	})

	it("draws both connection lines at full strength with nothing hovered", () => {
		const c = mount(null, { connect: true })
		const lines = lineOpacities(c)
		expect(lines.length).toBe(2)
		expect(lines.every((o) => o === 1)).toBe(true)
	})

	it("keys on the connection field when no color is encoded", async () => {
		// The quick start's line chart is x + y + connection with NO hue, so
		// the series identity — and the only thing hover can highlight by —
		// is the connection group.
		const c = mount(null, { connect: true, noHue: true })
		expect(lineOpacities(c)).toEqual([1, 1])
		const points = [...c.querySelectorAll("path:not(.vc-line-hit)")]
		expect(points.length).toBe(4)

		fireEvent.mouseEnter(points[0])

		await waitFor(() => {
			const lines = lineOpacities(c).sort((a, b) => a - b)
			expect(lines.length).toBe(2)
			expect(lines[1]).toBe(1)
			expect(lines[0]).toBeCloseTo(LEGEND_HIGHLIGHT_DIM, 5)
		})
		// Labels and stems of the other series recede with it.
		expect(labelOpacities(c).filter((o) => o !== 1).length).toBe(2)
		expect(stemOpacities(c).filter((o) => o !== 1).length).toBe(2)
	})

	it("publishes the highlight from the LINE itself, not just its points", async () => {
		// On a line chart the line is what the pointer lands on — points can
		// be tiny or sampled away entirely.
		const c = mount(null, { connect: true, noHue: true })
		const hitLines = [...c.querySelectorAll(".vc-line-hit")]
		expect(hitLines.length).toBe(2)

		fireEvent.mouseEnter(hitLines[0])

		await waitFor(() => {
			const lines = lineOpacities(c).sort((a, b) => a - b)
			expect(lines[0]).toBeCloseTo(LEGEND_HIGHLIGHT_DIM, 5)
			expect(lines[1]).toBe(1)
		})
	})

	it("recolors the matched line and stems, like the matched points", () => {
		// The reported bug: with Recolor on, the hovered series' POINTS turned
		// the highlight color while its line kept its own — a recolored dot on
		// an un-recolored line reads as a rendering bug.
		const c = mount(
			{ field: "g", value: "north" },
			{
				connect: true,
				hoverOptions: { hoverEnabled: true, hoverRecolor: true },
			}
		)
		const strokes = (sel: string) =>
			[...c.querySelectorAll(sel)].map((el) => el.getAttribute("stroke"))
		expect(
			strokes("polyline:not(.vc-line-hit)").filter(
				(s) => s === DEFAULT_HOVER_HIGHLIGHT_COLOR
			).length
		).toBe(1)
		// Two "north" rows → two recolored stems.
		expect(
			strokes(".vc-axis-stem").filter(
				(s) => s === DEFAULT_HOVER_HIGHLIGHT_COLOR
			).length
		).toBe(2)
	})

	it("leaves stems and labels untouched when an unrelated field is hovered", () => {
		// The hovered field isn't a column of these rows — a legend hover in
		// another visual must never dim this one.
		const c = mount({ field: "not_a_column", value: "north" })
		expect(stemOpacities(c).every((o) => o === 1)).toBe(true)
		expect(labelOpacities(c).every((o) => o === 1)).toBe(true)
	})
})
