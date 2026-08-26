import { render } from "@testing-library/react"
import { TestProvider, type TestStore } from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import { describe, expect, it } from "vitest"
import {
	DATA_LABELS_SINGLE_COLOR_ID,
	DEFAULT_DATA_LABELS_CONFIG,
	type DataLabelsConfig,
} from "../../lib/channelConfig"
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
	currentFieldOverridesAtom,
	loadedDatasetsAtom,
	previewVersionIdAtom,
	type AtomValueType,
} from "../../store/atoms"

import { DataLabelsLayer, type DataLabelAnchor } from "./DataLabelsLayer"

/** Anchor-path (bars / areas) label-color regressions, reported on a stacked
 *  bar chart:
 *
 *  1. "I picked a palette and the colors are wrong" — the layer built its
 *     categorical hue DOMAIN from the anchor list, which iterates stacks /
 *     slices in layout order. When that order differs from dataset row order
 *     (the order the chart's own hue scale + legend use), the category →
 *     color assignment shuffles. The domain must come from the full dataset.
 *
 *  2. "Picking the 'none' palette doesn't work — the text colors don't
 *     change" — `paletteId: null` was both "no pick yet" AND "explicit
 *     None", and the inherit-chart-palette fallback recolored labels either
 *     way, so the single color swatch had no effect. The explicit pick now
 *     stores the `DATA_LABELS_SINGLE_COLOR_ID` sentinel, which suppresses
 *     the fallback.
 *
 *  3. Per-category swatch overrides (`colorOverrides`) beat the palette. */

const DATASET_ID = "ds-anchor-hue"

const PALETTE = ["#ff0000", "#0000ff"] // north → red, south → blue

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "sales",
		filename: "sales.csv",
		fields: [
			{ name: "cat", inferredType: "categorical" },
			{ name: "val", inferredType: "quantitative" },
			{ name: "region", inferredType: "categorical" },
		],
		// Dataset row order introduces north FIRST — that's the order the
		// chart's marks + legend assign palette slots in.
		rows: [
			{ cat: "A", val: "10", region: "north" },
			{ cat: "A", val: "30", region: "south" },
			{ cat: "B", val: "20", region: "north" },
			{ cat: "B", val: "40", region: "south" },
		],
	})

// Anchors deliberately list SOUTH first — simulating a stack/slice layout
// order that differs from dataset row order.
const ANCHORS: DataLabelAnchor[] = [
	{ cx: 10, cy: 10, key: "A|south", label: "30", hueValue: "south" },
	{ cx: 10, cy: 40, key: "A|north", label: "10", hueValue: "north" },
	{ cx: 50, cy: 10, key: "B|south", label: "40", hueValue: "south" },
	{ cx: 50, cy: 40, key: "B|north", label: "20", hueValue: "north" },
]

/** Persist-effects hydrate atoms from localStorage on init (overriding the
 *  Jotai store), so the state must be seeded there — same pattern as
 *  DataLabels.hueColor.smoke.test.tsx. */
const seedState = (
	labelsCfg: Partial<DataLabelsConfig>,
	chartConfigs: AtomValueType<typeof currentChannelConfigsAtom>
) => {
	const store = installInMemoryLocalStorage()
	/* eslint-disable @th/use-wrapped-json-functions */
	store.set(
		"vis-components:datasets",
		JSON.stringify({ [DATASET_ID]: buildDataset() })
	)
	store.set("vis-components:currentDatasetId", JSON.stringify(DATASET_ID))
	store.set("vis-components:previewVersionId", JSON.stringify(null))
	store.set(
		"vis-components:currentEncodings",
		JSON.stringify({
			...emptyEncodings(),
			x: { field: "cat" },
			y: { field: "val" },
			hue: { field: "region" },
		})
	)
	store.set(
		"vis-components:currentChannelConfigs",
		JSON.stringify(chartConfigs)
	)
	store.set(
		"vis-components:currentDataLabelsEncodings",
		JSON.stringify({
			...emptyDataLabelsEncodings(),
			x: { field: "cat" },
			y: { field: "val" },
			value: { field: "val" },
			hue: { field: "region" },
		})
	)
	store.set(
		"vis-components:currentDataLabelsConfig",
		JSON.stringify({ ...DEFAULT_DATA_LABELS_CONFIG, ...labelsCfg })
	)
	/* eslint-enable @th/use-wrapped-json-functions */
}

const initState =
	(
		labelsCfg: Partial<DataLabelsConfig>,
		chartConfigs: AtomValueType<typeof currentChannelConfigsAtom> = {}
	) =>
	(snap: TestStore) => {
		snap.set(loadedDatasetsAtom, { [DATASET_ID]: buildDataset() })
		snap.set(currentDatasetIdAtom, DATASET_ID)
		snap.set(previewVersionIdAtom, null)
		snap.set(currentEncodingsAtom, {
			...emptyEncodings(),
			x: { field: "cat" },
			y: { field: "val" },
			hue: { field: "region" },
		})
		snap.set(currentChannelConfigsAtom, chartConfigs)
		snap.set(currentDataLabelsConfigAtom, {
			...DEFAULT_DATA_LABELS_CONFIG,
			...labelsCfg,
		})
		snap.set(currentDataLabelsEncodingsAtom, {
			...emptyDataLabelsEncodings(),
			x: { field: "cat" },
			y: { field: "val" },
			value: { field: "val" },
			hue: { field: "region" },
		})
		snap.set(currentFieldOverridesAtom, {})
	}

const renderAnchorTexts = (
	labelsCfg: Partial<DataLabelsConfig>,
	chartConfigs: AtomValueType<typeof currentChannelConfigsAtom> = {}
): SVGTextElement[] => {
	seedState(labelsCfg, chartConfigs)
	const { container } = render(
		<TestProvider initializeState={initState(labelsCfg, chartConfigs)}>
			<svg>
				<DataLabelsLayer
					rows={[]}
					xScale={null}
					yScale={null}
					xType="categorical"
					yType="quantitative"
					anchors={ANCHORS}
				/>
			</svg>
		</TestProvider>
	)
	return [...container.querySelectorAll("text")]
}

const renderAnchors = (
	labelsCfg: Partial<DataLabelsConfig>,
	chartConfigs: AtomValueType<typeof currentChannelConfigsAtom> = {}
): Map<string, string | null> => {
	const texts = renderAnchorTexts(labelsCfg, chartConfigs)
	// Key each label by its text content (values are unique per anchor).
	return new Map(texts.map((t) => [t.textContent ?? "", t.getAttribute("fill")]))
}

describe("Data labels — anchor path (bars/areas) hue colors", () => {
	it("builds the hue domain from dataset row order, not anchor order", () => {
		const fills = renderAnchors({
			palette: PALETTE,
			paletteId: "test-palette",
		})
		// North appears first in the DATASET, so it owns the first palette
		// slot — even though the anchors list south first. Before the fix
		// the anchor order won and the colors swapped.
		expect(fills.get("10")).toBe("#ff0000") // A|north
		expect(fills.get("30")).toBe("#0000ff") // A|south
		expect(fills.get("20")).toBe("#ff0000") // B|north
		expect(fills.get("40")).toBe("#0000ff") // B|south
	})

	it("explicit 'None (single color)' paints every label with cfg.color despite the chart palette", () => {
		const fills = renderAnchors(
			{
				paletteId: DATA_LABELS_SINGLE_COLOR_ID,
				palette: [],
				color: "#123456",
			},
			// A chart palette exists — before the fix the inherit-chart-palette
			// fallback recolored the labels with it, so changing the single
			// color swatch did nothing.
			{ categoricalPalette: PALETTE }
		)
		expect([...new Set(fills.values())]).toEqual(["#123456"])
	})

	it("per-category colorOverrides beat the palette", () => {
		const fills = renderAnchors({
			palette: PALETTE,
			paletteId: "test-palette",
			colorOverrides: { south: "#00ff00" },
		})
		expect(fills.get("30")).toBe("#00ff00") // A|south — overridden
		expect(fills.get("10")).toBe("#ff0000") // A|north — palette slot
	})
})

describe("Data labels — Text Properties (family / weight / style)", () => {
	it("applies font family, weight, italic, and underline to every label", () => {
		const texts = renderAnchorTexts({
			fontFamily: "Georgia, 'Times New Roman', serif",
			fontWeight: 700,
			italic: true,
			underline: true,
		})
		expect(texts.length).toBeGreaterThan(0)
		for (const t of texts) {
			expect(t.getAttribute("font-family")).toBe(
				"Georgia, 'Times New Roman', serif"
			)
			expect(t.getAttribute("font-weight")).toBe("700")
			expect(t.getAttribute("font-style")).toBe("italic")
			expect(t.getAttribute("text-decoration")).toBe("underline")
		}
	})

	it("omits style attributes when italic / underline are off (saved-visual default)", () => {
		const texts = renderAnchorTexts({})
		expect(texts.length).toBeGreaterThan(0)
		for (const t of texts) {
			expect(t.getAttribute("font-style")).toBeNull()
			expect(t.getAttribute("text-decoration")).toBeNull()
		}
	})
})
