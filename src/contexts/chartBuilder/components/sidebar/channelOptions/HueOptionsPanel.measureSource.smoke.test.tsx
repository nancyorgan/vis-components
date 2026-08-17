import { cleanup, fireEvent, render, within } from "@testing-library/react"
import { TestProvider } from "../../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../../testSupport/fixtures"
import { afterEach, describe, expect, it } from "vitest"
import { useAtomValue } from "jotai"
import { DEFAULT_AXIS_CONFIG } from "../../../lib/channelConfig"
import { MEASURE_OPTION_VALUE } from "../../../lib/histogramMeasure"
import { emptyEncodings, type Dataset } from "../../../lib/types"
import { currentEncodingsAtom } from "../../../store/atoms"

import { HueOptionsPanel } from "./HueOptionsPanel"

/** The Fill "Vary by" dropdown offers Count/Density ONLY for an active
 *  histogram, and picking the measure is mutually exclusive with a field
 *  mapping (and vice-versa). */

const DATASET_ID = "ds-hue-measure"

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
			group: i % 2 === 0 ? "A" : "B",
		})),
	})

const seed = (encodings: Record<string, unknown>, histogram: boolean) => {
	const store = installInMemoryLocalStorage()
	/* eslint-disable @th/use-wrapped-json-functions */
	store.set("vis-components:datasets", JSON.stringify({ [DATASET_ID]: buildDataset() }))
	store.set("vis-components:currentDatasetId", JSON.stringify(DATASET_ID))
	store.set("vis-components:previewVersionId", JSON.stringify(null))
	store.set(
		"vis-components:currentEncodings",
		JSON.stringify({ ...emptyEncodings(), x: { field: "score" }, ...encodings })
	)
	store.set(
		"vis-components:currentChannelConfigs",
		JSON.stringify({
			x: {
				...DEFAULT_AXIS_CONFIG,
				histogram: { enabled: histogram, binCount: 4, mode: "count" },
			},
		})
	)
	/* eslint-enable @th/use-wrapped-json-functions */
}

/** Surfaces the live hue encoding so assertions can read it after a change. */
const HueProbe = () => {
	const enc = useAtomValue(currentEncodingsAtom)
	return (
		<div data-testid="hue">
			{/* eslint-disable-next-line @th/use-wrapped-json-functions */}
			{JSON.stringify(enc.hue)}
		</div>
	)
}

const mount = () =>
	render(
		<TestProvider>
			<HueOptionsPanel />
			<HueProbe />
		</TestProvider>
	)

afterEach(cleanup)

const hueState = (container: HTMLElement) =>
	JSON.parse(within(container).getByTestId("hue").textContent ?? "{}")

describe("HueOptionsPanel — Count/Density vary-by", () => {
	it("omits Count when the histogram is off", () => {
		seed({}, false)
		const { container } = mount()
		expect(
			within(container).queryByRole("option", { name: "Count" })
		).toBeNull()
	})

	it("offers Count when the histogram is active", () => {
		seed({}, true)
		const { container } = mount()
		expect(
			within(container).getByRole("option", { name: "Count" })
		).toBeTruthy()
	})

	it("picking Count sets measureSource and clears any field", () => {
		// Start with a categorical field mapped to hue.
		seed({ hue: { field: "group" } }, true)
		const { container } = mount()
		expect(hueState(container)).toMatchObject({ field: "group" })
		fireEvent.change(within(container).getByLabelText("Vary by"), {
			target: { value: MEASURE_OPTION_VALUE.count },
		})
		expect(hueState(container)).toMatchObject({
			field: null,
			measureSource: "count",
		})
	})

	it("picking a field clears a prior measure source", () => {
		seed({ hue: { field: null, measureSource: "count" } }, true)
		const { container } = mount()
		expect(hueState(container)).toMatchObject({ measureSource: "count" })
		fireEvent.change(within(container).getByLabelText("Vary by"), {
			target: { value: "group" },
		})
		const next = hueState(container)
		expect(next.field).toBe("group")
		expect(next.measureSource ?? null).toBeNull()
	})
})
