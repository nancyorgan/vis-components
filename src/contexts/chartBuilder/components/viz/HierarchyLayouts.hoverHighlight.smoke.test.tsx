import { cleanup, fireEvent, render, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import {
	TestProvider,
	type TestStore,
} from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import { type ChannelConfigs } from "../../lib/channelConfig"
import { DEFAULT_LABELS_CONFIG } from "../../lib/labelsConfig"
import { emptyEncodings, type Dataset } from "../../lib/types"
import {
	currentChannelConfigsAtom,
	currentDatasetIdAtom,
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
	currentLabelsAtom,
	hoveredLegendEntryAtom,
	loadedDatasetsAtom,
	previewVersionIdAtom,
} from "../../store/atoms"
import { LEGEND_HIGHLIGHT_DIM } from "../../store/useLegendHighlight"

import { PackedCirclesPlot } from "./PackedCirclesPlot"
import { SunburstPlot } from "./SunburstPlot"
import { TreemapPlot } from "./TreemapPlot"

/** Hover highlight on the NESTED charts (packed circles / treemap /
 *  sunburst): hovering a mark highlights everything sharing its color and
 *  fades the rest, the same gesture the cartesian renderers have. These
 *  charts are usually colored by the DERIVED "Top-level group" source, which
 *  no dataset column carries — so the highlight keys on the node's own group
 *  rather than a row value, and a hover published for some unrelated field
 *  must leave the chart alone. */

const DATASET_ID = "ds-hier-hover"

/** Same fruit edge list as the other hierarchy suites: three top-level
 *  groups — Pome (Apple, Pear), Citrus (Lemon), Melon (Watermelon → Mini,
 *  Seedless) — so a group's fade is distinguishable from a single mark's. */
const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "fruit",
		filename: "fruit.csv",
		fields: [
			{ name: "Parent", inferredType: "categorical" },
			{ name: "Child", inferredType: "categorical" },
			{ name: "Value", inferredType: "quantitative" },
		],
		rows: [
			{ Parent: "Pome", Child: "Apple", Value: "7" },
			{ Parent: "Pome", Child: "Pear", Value: "7" },
			{ Parent: "Citrus", Child: "Lemon", Value: "8" },
			{ Parent: "Melon", Child: "Watermelon", Value: "" },
			{ Parent: "Watermelon", Child: "Mini", Value: "1" },
			{ Parent: "Watermelon", Child: "Seedless", Value: "6" },
		],
	})

type Layout = "packed" | "treemap" | "sunburst"

const mount = (
	layout: Layout,
	opts: {
		/** Color by a real column instead of the derived group source. */
		hueField?: string
		/** Pre-set hovered legend entry (for the unrelated-field guard). */
		hovered?: { field: string; value: string }
	} = {}
) => {
	const store = installInMemoryLocalStorage()
	const encodings = {
		...emptyEncodings(),
		connection: { field: "Parent" },
		area: { field: "Value" },
		hue: opts.hueField
			? { field: opts.hueField }
			: { field: null, measureSource: "rootGroup" as const },
	}
	const configs: ChannelConfigs = {
		connection: {
			hierarchyLayout: layout === "packed" ? "circles" : layout,
		} as never,
	}
	/* eslint-disable @th/use-wrapped-json-functions */
	store.set(
		"vis-components:datasets",
		JSON.stringify({ [DATASET_ID]: buildDataset() })
	)
	store.set("vis-components:currentDatasetId", JSON.stringify(DATASET_ID))
	store.set("vis-components:previewVersionId", JSON.stringify(null))
	store.set("vis-components:currentEncodings", JSON.stringify(encodings))
	store.set("vis-components:currentChannelConfigs", JSON.stringify(configs))
	/* eslint-enable @th/use-wrapped-json-functions */

	const init = (snap: TestStore) => {
		snap.set(loadedDatasetsAtom, { [DATASET_ID]: buildDataset() })
		snap.set(currentDatasetIdAtom, DATASET_ID)
		snap.set(previewVersionIdAtom, null)
		snap.set(currentEncodingsAtom, encodings)
		snap.set(currentChannelConfigsAtom, configs)
		snap.set(currentLabelsAtom, DEFAULT_LABELS_CONFIG)
		snap.set(currentFieldOverridesAtom, {})
		snap.set(currentFieldLevelOrdersAtom, {})
		if (opts.hovered) snap.set(hoveredLegendEntryAtom, opts.hovered)
	}

	const Plot =
		layout === "packed"
			? PackedCirclesPlot
			: layout === "treemap"
				? TreemapPlot
				: SunburstPlot
	const { container } = render(
		<TestProvider initializeState={init}>
			<div style={{ width: 600, height: 400 }}>
				<Plot />
			</div>
		</TestProvider>
	)
	return container
}

/** The mark elements each layout draws (leaves + any painted containers). */
const marksOf = (c: HTMLElement, layout: Layout) =>
	[
		...c.querySelectorAll(
			layout === "treemap" ? "rect" : layout === "packed" ? "circle" : "path"
		),
	].filter((el) => el.getAttribute("fill-opacity") !== null)

const fillOpacity = (el: Element) => Number(el.getAttribute("fill-opacity"))

/** Marks sharing a fill are one series — which is exactly what the derived
 *  group color encodes, so the fill is a usable series key in these tests. */
const sameFillCount = (marks: Element[], mark: Element) =>
	marks.filter((m) => m.getAttribute("fill") === mark.getAttribute("fill"))
		.length

afterEach(cleanup)

describe.each<Layout>(["packed", "treemap", "sunburst"])(
	"%s — hovering a mark highlights its group",
	(layout) => {
		it("fades every mark outside the hovered mark's group", async () => {
			const c = mount(layout)
			const marks = marksOf(c, layout)
			expect(marks.length).toBeGreaterThan(2)
			// The LAST mark is always a leaf: packed circles paint container
			// circles first and leave them non-interactive (pointer-events
			// none), so a leaf is the hoverable mark there.
			const hoveredMark = marks[marks.length - 1]
			const inGroup = sameFillCount(marks, hoveredMark)
			// The fixture has 3 groups, so a group is a strict subset.
			expect(inGroup).toBeLessThan(marks.length)
			const before = marks.map(fillOpacity)

			fireEvent.mouseEnter(hoveredMark)

			await waitFor(() => {
				const now = marksOf(c, layout).map(fillOpacity)
				expect(now.filter((o, i) => o < before[i]).length).toBe(
					marks.length - inGroup
				)
			})
			// Faded marks drop by exactly the configured fade; the hovered
			// group is untouched.
			const after = marksOf(c, layout)
			after.forEach((m, i) => {
				const expected =
					m.getAttribute("fill") === hoveredMark.getAttribute("fill")
						? before[i]
						: before[i] * LEGEND_HIGHLIGHT_DIM
				expect(fillOpacity(m)).toBeCloseTo(expected, 5)
			})
		})

		it("restores every mark when the pointer leaves the chart", async () => {
			const c = mount(layout)
			const before = marksOf(c, layout).map(fillOpacity)
			const all = marksOf(c, layout)
			fireEvent.mouseEnter(all[all.length - 1])
			await waitFor(() => {
				expect(
					marksOf(c, layout).map(fillOpacity).some((o, i) => o < before[i])
				).toBe(true)
			})
			fireEvent.mouseLeave(c.querySelector("g")!)
			await waitFor(() => {
				marksOf(c, layout).forEach((m, i) => {
					expect(fillOpacity(m)).toBeCloseTo(before[i], 5)
				})
			})
		})

		it("ignores a hover published for an unrelated field", () => {
			// `Parent` IS a column of these rows, but this chart is colored by
			// the derived group source — a legend hover elsewhere on Parent
			// must not dim it.
			const plain = marksOf(mount(layout), layout).map(fillOpacity)
			const c = mount(layout, {
				hovered: { field: "Parent", value: "Pome" },
			})
			marksOf(c, layout).forEach((m, i) => {
				expect(fillOpacity(m)).toBeCloseTo(plain[i], 5)
			})
		})
	}
)

describe("nested charts colored by a real field", () => {
	it("hovering a treemap tile highlights its field value's marks", async () => {
		// Hue on `Parent`: leaves carry Pome / Citrus / Watermelon, so the
		// highlight resolves through the ROW rather than the tree position.
		const c = mount("treemap", { hueField: "Parent" })
		const marks = marksOf(c, "treemap")
		const hoveredMark = marks[marks.length - 1]
		const inGroup = sameFillCount(marks, hoveredMark)
		const before = marks.map(fillOpacity)

		fireEvent.mouseEnter(hoveredMark)

		await waitFor(() => {
			const faded = marksOf(c, "treemap").filter(
				(m, i) => fillOpacity(m) < before[i]
			)
			expect(faded.length).toBe(marks.length - inGroup)
		})
	})
})
