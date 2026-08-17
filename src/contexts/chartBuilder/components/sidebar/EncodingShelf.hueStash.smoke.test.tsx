import { cleanup, fireEvent, render, within } from "@testing-library/react"
import { TestProvider } from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import { afterEach, describe, expect, it } from "vitest"
import { useAtomValue } from "jotai"
import type { HueConfig } from "../../lib/channelConfig"
import { emptyEncodings, type Dataset } from "../../lib/types"
import { currentChannelConfigsAtom } from "../../store/atoms"

import { EncodingShelf } from "./EncodingShelf"

/** A picked gradient must survive an encoding round-trip: switching the
 *  Color variable to a categorical field stashes the quantitative hue
 *  config, and switching back restores the stash instead of re-seeding the
 *  theme-default gradient. */

const DATASET_ID = "ds-hue-stash"

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

/** The user's hand-picked gradient — distinct from any theme default so a
 *  re-seed (the bug) can't accidentally pass the assertions. */
const PICKED_GRADIENT: Extract<HueConfig, { kind: "quantitative" }> = {
	kind: "quantitative",
	palette: "customLinear",
	lowColor: "#123456",
	lowValue: null,
	midColor: null,
	midValue: null,
	highColor: "#fedcba",
	highValue: null,
	stackMode: "stack",
}

const seed = () => {
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
		JSON.stringify({ ...emptyEncodings(), hue: { field: "score" } })
	)
	store.set(
		"vis-components:currentChannelConfigs",
		JSON.stringify({ hue: PICKED_GRADIENT })
	)
	/* eslint-enable @th/use-wrapped-json-functions */
}

/** Surfaces the live channel configs so assertions can read them. */
const ConfigsProbe = () => {
	const configs = useAtomValue(currentChannelConfigsAtom)
	return (
		<div data-testid="configs">
			{/* eslint-disable-next-line @th/use-wrapped-json-functions */}
			{JSON.stringify({ hue: configs.hue, stash: configs.hueQuantStash })}
		</div>
	)
}

const mount = () =>
	render(
		<TestProvider>
			<EncodingShelf channel="hue" />
			<ConfigsProbe />
		</TestProvider>
	)

afterEach(cleanup)

const configsState = (container: HTMLElement) =>
	JSON.parse(within(container).getByTestId("configs").textContent ?? "{}")

describe("EncodingShelf — hue gradient stash", () => {
	it("stashes the gradient when hue switches to a categorical field", () => {
		seed()
		const { container } = mount()
		const select = within(container).getByLabelText("Color")
		fireEvent.change(select, { target: { value: "group" } })
		const state = configsState(container)
		expect(state.hue?.kind).not.toBe("quantitative")
		expect(state.stash).toEqual(PICKED_GRADIENT)
	})

	it("restores the stashed gradient when hue goes quantitative again", () => {
		seed()
		const { container } = mount()
		const select = within(container).getByLabelText("Color")
		fireEvent.change(select, { target: { value: "group" } })
		fireEvent.change(select, { target: { value: "score" } })
		expect(configsState(container).hue).toEqual(PICKED_GRADIENT)
	})
})
