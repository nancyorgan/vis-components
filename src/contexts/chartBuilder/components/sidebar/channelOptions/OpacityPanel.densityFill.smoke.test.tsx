import { fireEvent, render } from "@testing-library/react"
import { TestProvider, type TestStore } from "../../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../../testSupport/fixtures"
import { describe, expect, it } from "vitest"
import {
	DEFAULT_AXIS_CONFIG,
	DEFAULT_HISTOGRAM_CONFIG,
	EMPTY_CHANNEL_CONFIGS,
} from "../../../lib/channelConfig"
import { emptyEncodings, type Dataset } from "../../../lib/types"
import {
	currentChannelConfigsAtom,
	currentDatasetIdAtom,
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
	loadedDatasetsAtom,
	previewVersionIdAtom,
} from "../../../store/atoms"

import { OpacityOptionsPanel } from "./OpacityOptionsPanel"

/** The Opacity menu's "Density Curve Fill" subsection: it appears for a
 *  histogram with a density overlay (fill on), and its single Opacity level
 *  writes `opacitySlots.densityCurveFill.level` — the exact key both curve
 *  renderers (BarPlot overlay + ScatterPlot standalone) read. Pins the
 *  control → config side of the density-fill-opacity chain; the config →
 *  fill-opacity attribute side is pinned in BarPlot.densityCurve.smoke and
 *  ScatterPlot.singleVarDistribution.smoke. */

const ID = "ds-opacity-density"

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: ID,
		name: "scores",
		filename: "scores.csv",
		fields: [{ name: "score", inferredType: "quantitative" }],
		rows: Array.from({ length: 30 }, (_, i) => ({ score: String(i + 1) })),
	})

const enc = { ...emptyEncodings(), x: { field: "score" } }
const cfg = {
	...EMPTY_CHANNEL_CONFIGS,
	x: {
		...DEFAULT_AXIS_CONFIG,
		histogram: {
			...DEFAULT_HISTOGRAM_CONFIG,
			enabled: true,
			binCount: 8,
			mode: "count" as const,
			showDensity: true,
			densityFill: true,
		},
	},
}

const mount = () => {
	const storeShim = installInMemoryLocalStorage()
	/* eslint-disable @th/use-wrapped-json-functions */
	const set = (k: string, v: unknown) => storeShim.set(k, JSON.stringify(v))
	set("vis-components:datasets", { [ID]: buildDataset() })
	set("vis-components:currentDatasetId", ID)
	set("vis-components:previewVersionId", null)
	set("vis-components:currentEncodings", enc)
	set("vis-components:currentChannelConfigs", cfg)
	/* eslint-enable @th/use-wrapped-json-functions */
	let store: TestStore | null = null
	const init = (snap: TestStore) => {
		store = snap
		snap.set(loadedDatasetsAtom, { [ID]: buildDataset() })
		snap.set(currentDatasetIdAtom, ID)
		snap.set(previewVersionIdAtom, null)
		snap.set(currentEncodingsAtom, enc)
		snap.set(currentChannelConfigsAtom, cfg)
		snap.set(currentFieldOverridesAtom, {})
		snap.set(currentFieldLevelOrdersAtom, {})
	}
	const utils = render(
		<TestProvider initializeState={init}>
			<OpacityOptionsPanel />
		</TestProvider>
	)
	return { ...utils, store: store! as TestStore }
}

describe("OpacityOptionsPanel — Density Curve Fill", () => {
	it("shows a Density Curve Fill subsection for a histogram with density curve", () => {
		const { container } = mount()
		const headers = [...container.querySelectorAll("button[aria-expanded]")].map(
			(b) => b.textContent?.trim() ?? ""
		)
		expect(headers).toContain("Density Curve Fill")
	})

	it("changing the Density Curve Fill opacity writes opacitySlots.densityCurveFill.level", () => {
		const { container, store } = mount()
		const btn = [...container.querySelectorAll("button[aria-expanded]")].find(
			(b) => b.textContent?.trim() === "Density Curve Fill"
		)!
		fireEvent.click(btn)
		// The subsection's single Opacity number input.
		const section = btn.closest("div")?.parentElement as HTMLElement
		const input = section.querySelector("input[type='number'], input") as HTMLInputElement
		expect(input).toBeTruthy()
		fireEvent.change(input, { target: { value: "0.9" } })
		const configs = store.get(currentChannelConfigsAtom)
		expect(configs.opacitySlots?.densityCurveFill?.level).toBe(0.9)
	})
})
