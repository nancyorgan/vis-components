import { cleanup, fireEvent, render } from "@testing-library/react"
import { TestProvider, type TestStore } from "../../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../../testSupport/fixtures"
import { afterEach, describe, expect, it } from "vitest"
import {
	DEFAULT_AXIS_CONFIG,
	DEFAULT_CATEGORICAL_HUE_CONFIG,
	DEFAULT_HISTOGRAM_CONFIG,
	DEFAULT_PATTERN_CONFIG,
	EMPTY_CHANNEL_CONFIGS,
	type ChannelConfigs,
} from "../../../lib/channelConfig"
import { emptyEncodings, type Dataset, type Encodings } from "../../../lib/types"
import {
	currentChannelConfigsAtom,
	currentDatasetIdAtom,
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
	loadedDatasetsAtom,
	previewVersionIdAtom,
} from "../../../store/atoms"

import { StackModeRow } from "./StackModeRow"

/** Component-level coverage for the per-channel Layout toggle: the row label
 *  ("Layout" with 2+ mapped stack channels, "Stacking" with one), the config
 *  write on click, and the chart-mode gate — which MUST resolve config-gated
 *  modes (histograms) via `useChartModeDef`, not bare `getChartModeDef`. */

// Explicit cleanup: this file imports vitest APIs directly (no globals), so
// testing-library's automatic afterEach unmount never registers and earlier
// mounts would leak into later queries.
afterEach(cleanup)

const ID = "ds-stackmode-row"

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: ID,
		name: "stackrow",
		filename: "stackrow.csv",
		fields: [
			{ name: "cat", inferredType: "categorical" },
			{ name: "val", inferredType: "quantitative" },
			{ name: "grp", inferredType: "categorical" },
			{ name: "pat", inferredType: "categorical" },
		],
		rows: [
			{ cat: "A", val: "2", grp: "g1", pat: "p1" },
			{ cat: "A", val: "3", grp: "g1", pat: "p2" },
			{ cat: "A", val: "4", grp: "g2", pat: "p1" },
			{ cat: "B", val: "1", grp: "g2", pat: "p2" },
		],
	})

const barsEncodings = (overrides: Partial<Encodings>): Encodings => ({
	...emptyEncodings(),
	x: { field: "cat" },
	length: { field: "val" },
	...overrides,
})

const baseConfigs: Partial<ChannelConfigs> = {
	...EMPTY_CHANNEL_CONFIGS,
	hue: { ...DEFAULT_CATEGORICAL_HUE_CONFIG },
	pattern: { ...DEFAULT_PATTERN_CONFIG },
}

const mount = (
	encodings: Encodings,
	configs: Partial<ChannelConfigs>,
	children: React.ReactNode
) => {
	// Atom storage effects re-load from localStorage on init and would reset a
	// snapshot-only seed to defaults, so the fixture goes into BOTH.
	const store = installInMemoryLocalStorage()
	/* eslint-disable @th/use-wrapped-json-functions */
	const set = (k: string, v: unknown) => store.set(k, JSON.stringify(v))
	set("vis-components:datasets", { [ID]: buildDataset() })
	set("vis-components:currentDatasetId", ID)
	set("vis-components:previewVersionId", null)
	set("vis-components:currentEncodings", encodings)
	set("vis-components:currentChannelConfigs", configs)
	/* eslint-enable @th/use-wrapped-json-functions */
	const init = (snap: TestStore) => {
		snap.set(loadedDatasetsAtom, { [ID]: buildDataset() })
		snap.set(currentDatasetIdAtom, ID)
		snap.set(previewVersionIdAtom, null)
		snap.set(currentEncodingsAtom, encodings)
		snap.set(currentChannelConfigsAtom, configs)
		snap.set(currentFieldOverridesAtom, {})
		snap.set(currentFieldLevelOrdersAtom, {})
	}
	return render(<TestProvider initializeState={init}>{children}</TestProvider>)
}

describe("StackModeRow — labels and config writes", () => {
	it("labels the row 'Layout' on both panels when 2+ stack channels are mapped", () => {
		const { getAllByRole } = mount(
			barsEncodings({ hue: { field: "grp" }, pattern: { field: "pat" } }),
			baseConfigs,
			<>
				<StackModeRow channel="hue" />
				<StackModeRow channel="pattern" />
			</>
		)
		const groups = getAllByRole("group", { name: "Layout" })
		expect(groups).toHaveLength(2)
		// Each row offers all three modes, defaulting to Stack.
		for (const group of groups) {
			const buttons = [...group.querySelectorAll("button")]
			expect(buttons.map((b) => b.textContent)).toEqual([
				"Stack",
				"Group",
				"Overlay",
			])
			expect(
				buttons.map((b) => b.getAttribute("aria-pressed"))
			).toEqual(["true", "false", "false"])
		}
	})

	it("labels the row 'Stacking' when a single stack channel is mapped", () => {
		const { getAllByRole, queryAllByRole } = mount(
			barsEncodings({ hue: { field: "grp" } }),
			baseConfigs,
			<>
				<StackModeRow channel="hue" />
				<StackModeRow channel="pattern" />
			</>
		)
		expect(getAllByRole("group", { name: "Stacking" })).toHaveLength(1)
		expect(queryAllByRole("group", { name: "Layout" })).toHaveLength(0)
	})

	it("clicking a mode writes only that channel's stackMode", () => {
		const { getAllByRole } = mount(
			barsEncodings({ hue: { field: "grp" }, pattern: { field: "pat" } }),
			baseConfigs,
			<>
				<StackModeRow channel="hue" />
				<StackModeRow channel="pattern" />
			</>
		)
		const [hueGroup, patternGroup] = getAllByRole("group", { name: "Layout" })
		const groupBtn = [...hueGroup!.querySelectorAll("button")].find(
			(b) => b.textContent === "Group"
		)!
		fireEvent.click(groupBtn)
		// Hue row flips to Group; pattern row stays on Stack.
		expect(groupBtn.getAttribute("aria-pressed")).toBe("true")
		const patternPressed = [...patternGroup!.querySelectorAll("button")].map(
			(b) => b.getAttribute("aria-pressed")
		)
		expect(patternPressed).toEqual(["true", "false", "false"])
	})
})

describe("StackModeRow — chart-mode gate", () => {
	it("renders nothing on scatter (no shared measure max)", () => {
		const { container } = mount(
			{
				...emptyEncodings(),
				x: { field: "val" },
				y: { field: "val" },
				hue: { field: "grp" },
			},
			baseConfigs,
			<StackModeRow channel="hue" />
		)
		expect(container.textContent).toBe("")
	})

	it("renders on a HISTOGRAM (config-gated bars variant)", () => {
		// Histograms only resolve as bars when detection sees channelConfigs +
		// field types — exactly what `useChartModeDef` supplies. A bare
		// `getChartModeDef(encodings)` misreads this chart as scatter and the
		// toggle vanishes; this test pins the hook wiring.
		const { getAllByRole } = mount(
			{
				...emptyEncodings(),
				x: { field: "val" },
				hue: { field: "grp" },
			},
			{
				...baseConfigs,
				x: {
					...DEFAULT_AXIS_CONFIG,
					histogram: { ...DEFAULT_HISTOGRAM_CONFIG, enabled: true },
				},
			},
			<StackModeRow channel="hue" />
		)
		expect(getAllByRole("group", { name: "Stacking" })).toHaveLength(1)
	})
})
