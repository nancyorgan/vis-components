import { render } from "@testing-library/react"
import { TestProvider, type TestStore } from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import { describe, expect, it } from "vitest"

import {
	DEFAULT_SHAPE_CONFIG,
	EMPTY_CHANNEL_CONFIGS,
	type ChannelConfigs,
} from "../../lib/channelConfig"
import { DEFAULT_LABELS_CONFIG } from "../../lib/labelsConfig"
import { emptyEncodings, type Dataset } from "../../lib/types"
import {
	currentChannelConfigsAtom,
	currentDatasetIdAtom,
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
	currentLabelsAtom,
	loadedDatasetsAtom,
	previewVersionIdAtom,
} from "../../store/atoms"

import { HexbinPlot } from "./HexbinPlot"

/** Mounts HexbinPlot against two exact-duplicate point clusters — (1,1)×3
 *  and (9,9)×2 — so cluster→cell assignment is guaranteed regardless of bin
 *  geometry: two occupied cells, counts 3 and 2. Each cluster also carries
 *  one value of `Z` (10 / 40) and one `Tier` (gold / silver), for the cell
 *  options that vary by a variable. */

const DATASET_ID = "ds-hexbin-test"

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "points",
		filename: "points.csv",
		fields: [
			{ name: "X", inferredType: "quantitative" },
			{ name: "Y", inferredType: "quantitative" },
			{ name: "Z", inferredType: "quantitative" },
			{ name: "Tier", inferredType: "categorical" },
		],
		rows: [
			{ X: "1", Y: "1", Z: "10", Tier: "gold" },
			{ X: "1", Y: "1", Z: "10", Tier: "gold" },
			{ X: "1", Y: "1", Z: "10", Tier: "gold" },
			{ X: "9", Y: "9", Z: "40", Tier: "silver" },
			{ X: "9", Y: "9", Z: "40", Tier: "silver" },
		],
	})

type MountOptions = {
	dropY?: boolean
	configs?: ChannelConfigs
	/** Further channels to map (Opacity, the Outline variable, Pattern, …). */
	encodings?: Record<string, { field: string }>
}

const encodingsFor = (opts?: MountOptions) => ({
	...emptyEncodings(),
	x: { field: "X" },
	...(opts?.dropY ? {} : { y: { field: "Y" } }),
	hue: { field: null, measureSource: "hexCount" as const },
	...opts?.encodings,
})

const mountHexbin = (opts?: MountOptions) => {
	const store = installInMemoryLocalStorage()
	const configs = opts?.configs ?? EMPTY_CHANNEL_CONFIGS
	/* eslint-disable @vc/use-wrapped-json-functions */
	store.set(
		"vis-components:datasets",
		JSON.stringify({ [DATASET_ID]: buildDataset() })
	)
	store.set("vis-components:currentDatasetId", JSON.stringify(DATASET_ID))
	store.set("vis-components:previewVersionId", JSON.stringify(null))
	store.set(
		"vis-components:currentEncodings",
		JSON.stringify(encodingsFor(opts))
	)
	store.set("vis-components:currentChannelConfigs", JSON.stringify(configs))
	/* eslint-enable @vc/use-wrapped-json-functions */

	const init = (snap: TestStore) => {
		snap.set(loadedDatasetsAtom, { [DATASET_ID]: buildDataset() })
		snap.set(currentDatasetIdAtom, DATASET_ID)
		snap.set(previewVersionIdAtom, null)
		snap.set(currentEncodingsAtom, encodingsFor(opts))
		snap.set(currentChannelConfigsAtom, configs)
		snap.set(currentLabelsAtom, DEFAULT_LABELS_CONFIG)
		snap.set(currentFieldOverridesAtom, {})
		snap.set(currentFieldLevelOrdersAtom, {})
	}

	return render(
		<TestProvider initializeState={init}>
			<div style={{ width: 600, height: 400 }}>
				<svg>
					<HexbinPlot />
				</svg>
			</div>
		</TestProvider>
	)
}

describe("HexbinPlot", () => {
	it("renders one hexagon per occupied cell, colored by count", () => {
		const { container } = mountHexbin()
		const cells = container.querySelectorAll("path.vc-hexbin-cell")
		expect(cells).toHaveLength(2)
		const fills = [...cells].map((c) => c.getAttribute("fill"))
		expect(fills[0]).toBeTruthy()
		expect(fills[1]).toBeTruthy()
		// count-3 and count-2 cells sit at different gradient positions
		expect(fills[0]).not.toBe(fills[1])
	})

	it("renders nothing (but doesn't crash) when an axis is unmapped", () => {
		const { container } = mountHexbin({ dropY: true })
		expect(container.querySelectorAll("path.vc-hexbin-cell")).toHaveLength(0)
	})

	it("strokes cells with the Shape outline color/width; width 0 hides", () => {
		const { container } = mountHexbin({
			configs: {
				shape: { ...DEFAULT_SHAPE_CONFIG, outlineColor: "#123456", outlineWidth: 2 },
			},
		})
		const cell = container.querySelector("path.vc-hexbin-cell")
		expect(cell?.getAttribute("stroke")).toBe("#123456")
		expect(cell?.getAttribute("stroke-width")).toBe("2")

		const { container: hidden } = mountHexbin({
			configs: {
				shape: { ...DEFAULT_SHAPE_CONFIG, outlineColor: "#123456", outlineWidth: 0 },
			},
		})
		const hiddenCell = hidden.querySelector("path.vc-hexbin-cell")
		expect(hiddenCell?.getAttribute("stroke")).toBe("none")
	})
})

/** A hex cell is a body like a bar or a heatmap cell: the fill and outline
 *  options the menus offer reach it through the same pipeline. They used to
 *  be offered and ignored. */
describe("HexbinPlot — cell options", () => {
	const attr = (container: HTMLElement, name: string): (string | null)[] =>
		[...container.querySelectorAll("path.vc-hexbin-cell")].map((c) =>
			c.getAttribute(name)
		)
	const outlined = (more: Partial<ChannelConfigs> = {}): ChannelConfigs => ({
		shape: { ...DEFAULT_SHAPE_CONFIG, outlineColor: "#ff0000", outlineWidth: 2 },
		...more,
	})

	it("an untouched hexbin draws opaque cells with no opacity attributes", () => {
		const { container } = mountHexbin({ configs: outlined() })
		expect(attr(container, "fill-opacity")).toEqual([null, null])
		expect(attr(container, "stroke-opacity")).toEqual([null, null])
		expect(attr(container, "stroke")).toEqual(["#ff0000", "#ff0000"])
	})

	it("Opacity → Cell fill sets every cell's opacity", () => {
		const { container } = mountHexbin({ configs: outlined({ defaultOpacity: 0.5 }) })
		expect(attr(container, "fill-opacity")).toEqual(["0.5", "0.5"])
	})

	it("Opacity → Cell fill → Vary by reads the rows that fell in each cell", () => {
		const { container } = mountHexbin({
			configs: outlined(),
			encodings: { opacity: { field: "Z" } },
		})
		const [a, b] = attr(container, "fill-opacity").map((v) => Number(v ?? 1))
		expect(a).not.toBe(b)
	})

	it("Saturation and Brightness → Cell fill shade the cells", () => {
		const plain = attr(mountHexbin({ configs: outlined() }).container, "fill")
		const desaturated = attr(
			mountHexbin({ configs: outlined({ defaultSaturation: 0 }) }).container,
			"fill"
		)
		const darkened = attr(
			mountHexbin({ configs: outlined({ defaultBrightness: 0.2 }) }).container,
			"fill"
		)
		expect(desaturated).toHaveLength(2)
		for (const [i, fill] of desaturated.entries()) expect(fill).not.toBe(plain[i])
		for (const [i, fill] of darkened.entries()) expect(fill).not.toBe(plain[i])
	})

	it("Pattern → a default pattern tiles every cell, and its defs are registered", () => {
		const { container } = mountHexbin({ configs: outlined({ defaultPattern: 2 }) })
		const fills = attr(container, "fill")
		expect(fills).toHaveLength(2)
		for (const fill of fills) {
			expect(fill).toMatch(/^url\(#/)
			const id = fill?.slice(5, -1) ?? ""
			expect(container.querySelector(`pattern[id="${id}"]`), id).not.toBeNull()
		}
	})

	it("Color → Cell outline → Vary by colors each cell's outline", () => {
		const { container } = mountHexbin({
			configs: outlined(),
			encodings: { outlineHue: { field: "Tier" } },
		})
		const strokes = attr(container, "stroke")
		expect(new Set(strokes).size).toBe(2)
		expect(strokes).not.toContain("#ff0000")
	})

	it("Opacity and Saturation → Cell outline reach the outline", () => {
		const faded = mountHexbin({
			configs: outlined({ opacitySlots: { border: { field: null, level: 0.3 } } }),
		})
		expect(attr(faded.container, "stroke-opacity")).toEqual(["0.3", "0.3"])
		const shaded = mountHexbin({
			configs: outlined({ saturationSlots: { outline: { field: null, level: 0 } } }),
		})
		for (const stroke of attr(shaded.container, "stroke"))
			expect(stroke).not.toBe("#ff0000")
	})
})
