import { render } from "@testing-library/react"
import { TestProvider, type TestStore } from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { describe, expect, it } from "vitest"
import {
	DEFAULT_DATA_LABELS_CONFIG,
	EMPTY_CHANNEL_CONFIGS,
	type DataLabelsConfig,
} from "../../lib/channelConfig"
import { DEFAULT_LABELS_CONFIG } from "../../lib/labelsConfig"
import {
	emptyDataLabelsEncodings,
	emptyEncodings,
	type Dataset,
	type DataLabelsEncodings,
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
	loadedDatasetsAtom,
	previewVersionIdAtom,
} from "../../store/atoms"

import { ScatterPlot } from "./ScatterPlot"

/** `labelPoints: "first-last"` + per-endpoint overrides on a scatter +
 *  connection line chart — the "directly labeled line chart" recipe: value
 *  only on each line's first point, value + series name on its last point
 *  (via a lastLabel template override), with the last label left-aligned
 *  past its point. Mirrors DataLabels.onlyLast.smoke.test.tsx's setup. */

const DATASET_ID = "ds-first-last"

const buildLineDataset = (): Dataset => ({
	id: DATASET_ID,
	name: "lines",
	fields: [
		{ name: "month", inferredType: "quantitative" },
		{ name: "sales", inferredType: "quantitative" },
		{ name: "region", inferredType: "categorical" },
	],
	versions: [
		{
			id: "v1",
			filename: "lines.csv",
			// Rows are SCRAMBLED so input order doesn't match visual order —
			// endpoint selection must rank by position, not index.
			rows: [
				{ month: "4", sales: "40", region: "north" }, // rightmost
				{ month: "1", sales: "10", region: "north" }, // leftmost
				{ month: "3", sales: "30", region: "north" },
				{ month: "2", sales: "20", region: "north" },
				{ month: "4", sales: "35", region: "south" }, // rightmost
				{ month: "1", sales: "5", region: "south" }, // leftmost
				{ month: "3", sales: "25", region: "south" },
				{ month: "2", sales: "15", region: "south" },
			],
			createdAt: 0,
		},
	],
	latestVersionId: "v1",
	createdAt: 0,
})

// Multi-field value (sales + region) so the lastLabel template can weave the
// series name into the last point's label.
const dataLabelsEncodings: DataLabelsEncodings = {
	...emptyDataLabelsEncodings(),
	x: { field: "month" },
	y: { field: "sales" },
	value: { field: null, multiField: true, fields: ["sales", "region"] },
}

const dataLabelsConfig: DataLabelsConfig = {
	...DEFAULT_DATA_LABELS_CONFIG,
	labelPoints: "first-last",
	// Base template renders just the value → first labels show "10" / "5".
	labelTemplate: "{sales}",
	lastLabel: {
		labelTemplate: "{sales} {region}",
		alignment: "left",
		xOffset: 8,
	},
	firstLabel: {
		yOffset: -10,
	},
}

const seedState = () => {
	const store = installInMemoryLocalStorage()
	/* eslint-disable @th/use-wrapped-json-functions */
	store.set(
		"vis-components:datasets",
		JSON.stringify({ [DATASET_ID]: buildLineDataset() })
	)
	store.set("vis-components:currentDatasetId", JSON.stringify(DATASET_ID))
	store.set("vis-components:previewVersionId", JSON.stringify(null))
	store.set(
		"vis-components:currentEncodings",
		JSON.stringify({
			...emptyEncodings(),
			x: { field: "month" },
			y: { field: "sales" },
			connection: { field: "region" },
		})
	)
	store.set(
		"vis-components:currentDataLabelsEncodings",
		JSON.stringify(dataLabelsEncodings)
	)
	store.set(
		"vis-components:currentDataLabelsConfig",
		JSON.stringify(dataLabelsConfig)
	)
	/* eslint-enable @th/use-wrapped-json-functions */
}

const initState = (snap: TestStore) => {
	snap.set(loadedDatasetsAtom, { [DATASET_ID]: buildLineDataset() })
	snap.set(currentDatasetIdAtom, DATASET_ID)
	snap.set(previewVersionIdAtom, null)
	snap.set(currentEncodingsAtom, {
		...emptyEncodings(),
		x: { field: "month" },
		y: { field: "sales" },
		connection: { field: "region" },
	})
	snap.set(currentChannelConfigsAtom, EMPTY_CHANNEL_CONFIGS)
	snap.set(currentLabelsAtom, DEFAULT_LABELS_CONFIG)
	snap.set(currentDataLabelsConfigAtom, dataLabelsConfig)
	snap.set(currentDataLabelsEncodingsAtom, dataLabelsEncodings)
	snap.set(currentFieldOverridesAtom, {})
	snap.set(currentFieldLevelOrdersAtom, {})
}

const renderedDataLabels = (container: HTMLElement) => {
	// DataLabelsLayer wraps its labels in `<g aria-hidden pointer-events>`;
	// filtering on that wrapper excludes axis tick labels.
	const groups = container.querySelectorAll(
		'g[aria-hidden="true"][pointer-events="none"]'
	)
	return [...groups].flatMap((g) => [...g.querySelectorAll("text")])
}

describe("Data labels — labelPoints 'first-last' with endpoint overrides", () => {
	it("labels both ends per series: base template first, lastLabel template + alignment last", () => {
		seedState()
		const { container } = render(
			<TestProvider initializeState={initState}>
				<div style={{ width: 600, height: 400 }}>
					<ScatterPlot />
				</div>
			</TestProvider>
		)
		const labels = renderedDataLabels(container)
		const byText = new Map(
			labels.map((t) => [t.textContent?.trim() ?? "", t] as const)
		)
		// Two series × two ends = four labels; interior points stay bare.
		expect([...byText.keys()].sort()).toEqual(
			["10", "35 south", "40 north", "5"].sort()
		)
		// Last labels take the override alignment (left → text-anchor start);
		// first labels inherit the base (center → middle).
		expect(byText.get("40 north")?.getAttribute("text-anchor")).toBe("start")
		expect(byText.get("10")?.getAttribute("text-anchor")).toBe("middle")
		// Last labels sit right of their first-label counterparts (rightmost
		// point + the override's +8px), first labels ride 10px above their
		// anchor via the firstLabel yOffset.
		const x = (t: SVGTextElement | HTMLElement | undefined) =>
			Number(t?.getAttribute("x") ?? NaN)
		expect(x(byText.get("40 north"))).toBeGreaterThan(x(byText.get("10")))
		expect(x(byText.get("35 south"))).toBeGreaterThan(x(byText.get("5")))
	})

	it("legacy onlyLastLabel saves render only last labels, ignoring stale endpoint overrides", () => {
		seedState()
		const legacyCfg: DataLabelsConfig = {
			...DEFAULT_DATA_LABELS_CONFIG,
			labelTemplate: "{sales}",
			onlyLastLabel: true,
			// Stale overrides (e.g. left over from a first-last session) must
			// NOT apply in single-endpoint modes: the base config drives
			// everything there, matching the panel's un-split controls.
			lastLabel: { labelTemplate: "{sales} {region}", alignment: "left" },
		}
		const { container } = render(
			<TestProvider
				initializeState={(snap) => {
					initState(snap)
					snap.set(currentDataLabelsConfigAtom, legacyCfg)
				}}
			>
				<div style={{ width: 600, height: 400 }}>
					<ScatterPlot />
				</div>
			</TestProvider>
		)
		const labels = renderedDataLabels(container)
		const texts = labels.map((t) => t.textContent?.trim() ?? "").sort()
		expect(texts).toEqual(["35", "40"])
		expect(labels[0]?.getAttribute("text-anchor")).toBe("middle")
	})
})
