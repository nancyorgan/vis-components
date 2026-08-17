import { cleanup, fireEvent, render } from "@testing-library/react"
import { TestProvider } from "../../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../../testSupport/fixtures"
import { afterEach, describe, expect, it } from "vitest"
import { useAtomValue } from "jotai"
import { emptyEncodings, type Dataset } from "../../../lib/types"
import { currentChannelConfigsAtom } from "../../../store/atoms"

import { BrightnessOptionsPanel, SaturationOptionsPanel } from "./RangePanel"

/** A categorical field mapped to saturation / brightness gets a PER-CATEGORY
 *  level editor (one 0–1 input per category, spread shown as the default),
 *  not the quantitative min/max range — which hid the per-category levels
 *  the user actually wants to set. Quantitative fields keep min/max. */

const DATASET_ID = "ds-modulation-levels"

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "scores",
		filename: "scores.csv",
		fields: [
			{ name: "score", inferredType: "quantitative" },
			{ name: "group", inferredType: "categorical" },
		],
		rows: Array.from({ length: 12 }, (_, i) => ({
			score: String(i + 1),
			group: ["A", "B", "C"][i % 3],
		})),
	})

const seed = (brightnessField: string) => {
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
			brightness: { field: brightnessField },
			saturation: { field: brightnessField },
		})
	)
	/* eslint-enable @th/use-wrapped-json-functions */
}

/** Surfaces the live channel configs so assertions can read them. */
const ConfigsProbe = () => {
	const configs = useAtomValue(currentChannelConfigsAtom)
	return (
		<div data-testid="configs">
			{/* eslint-disable-next-line @th/use-wrapped-json-functions */}
			{JSON.stringify({ brightness: configs.brightness })}
		</div>
	)
}

afterEach(cleanup)

describe("BrightnessOptionsPanel — categorical field", () => {
	it("shows one level input per category (no min/max range)", () => {
		seed("group")
		const { getByLabelText, queryByLabelText } = render(
			<TestProvider>
				<BrightnessOptionsPanel />
			</TestProvider>
		)
		expect(getByLabelText("A")).toBeTruthy()
		expect(getByLabelText("B")).toBeTruthy()
		expect(getByLabelText("C")).toBeTruthy()
		expect(queryByLabelText("Min")).toBeNull()
		expect(queryByLabelText("Max")).toBeNull()
	})

	it("un-overridden rows show the even min→max spread the renderer applies", () => {
		seed("group")
		const { getByLabelText } = render(
			<TestProvider>
				<BrightnessOptionsPanel />
			</TestProvider>
		)
		// Theme default brightness range 0.25–0.85, 3 categories → 0.25/0.55/0.85.
		expect((getByLabelText("A") as HTMLInputElement).value).toBe("0.25")
		expect((getByLabelText("B") as HTMLInputElement).value).toBe("0.55")
		expect((getByLabelText("C") as HTMLInputElement).value).toBe("0.85")
	})

	it("editing a row stores a per-value override in configs.brightness.overrides", () => {
		seed("group")
		const { getByLabelText, getByTestId } = render(
			<TestProvider>
				<BrightnessOptionsPanel />
				<ConfigsProbe />
			</TestProvider>
		)
		fireEvent.change(getByLabelText("B"), { target: { value: "0.4" } })
		expect(getByTestId("configs").textContent).toContain('"overrides":{"B":0.4}')
	})

	it("a quantitative field keeps the min/max range editor", () => {
		seed("score")
		const { getByLabelText, queryByLabelText } = render(
			<TestProvider>
				<BrightnessOptionsPanel />
			</TestProvider>
		)
		expect(getByLabelText("Min")).toBeTruthy()
		expect(getByLabelText("Max")).toBeTruthy()
		expect(queryByLabelText("A")).toBeNull()
	})
})

describe("SaturationOptionsPanel — categorical field", () => {
	it("shows the per-category editor too", () => {
		seed("group")
		const { getByLabelText, queryByLabelText } = render(
			<TestProvider>
				<SaturationOptionsPanel />
			</TestProvider>
		)
		expect(getByLabelText("A")).toBeTruthy()
		expect(queryByLabelText("Min")).toBeNull()
	})
})
