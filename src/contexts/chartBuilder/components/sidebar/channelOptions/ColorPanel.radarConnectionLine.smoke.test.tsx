import { fireEvent, render, within } from "@testing-library/react"
import { TestProvider, type TestStore } from "../../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../../testSupport/fixtures"
import { describe, expect, it } from "vitest"
import {
	DEFAULT_CONNECTION_CONFIG,
	EMPTY_CHANNEL_CONFIGS,
	type ChannelConfigs,
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

import { ColorPanel } from "./ColorPanel"

/** Color → Connection line on a radar: the polygon outline takes a Vary by
 *  like every other part — "Match fill" (untouched), "— none —" (one color)
 *  or any variable — writing the Line color slot. An older radar's outline
 *  palette / per-series colors (the connection config) show until the first
 *  edit, which clears them. */

const ID = "ds-radar-connection-line"

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: ID,
		name: "radar",
		filename: "radar.csv",
		fields: [
			{ name: "metric", inferredType: "categorical" },
			{ name: "score", inferredType: "quantitative" },
			{ name: "team", inferredType: "categorical" },
			{ name: "league", inferredType: "categorical" },
		],
		rows: ["north", "south"].flatMap((team) =>
			["A", "B", "C"].map((metric, i) => ({
				metric,
				score: String(i + 1),
				team,
				league: team === "north" ? "east" : "west",
			}))
		),
	})

const enc = {
	...emptyEncodings(),
	r: { field: "score" },
	angle: { field: "metric" },
	connection: { field: "team" },
}

const mount = (cfg: ChannelConfigs) => {
	const store = installInMemoryLocalStorage()
	/* eslint-disable @vc/use-wrapped-json-functions */
	const set = (k: string, v: unknown) => store.set(k, JSON.stringify(v))
	set("vis-components:datasets", { [ID]: buildDataset() })
	set("vis-components:currentDatasetId", ID)
	set("vis-components:previewVersionId", null)
	set("vis-components:currentEncodings", enc)
	set("vis-components:currentChannelConfigs", cfg)
	/* eslint-enable @vc/use-wrapped-json-functions */
	let snapshot: TestStore | null = null
	const init = (snap: TestStore) => {
		snapshot = snap
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
			<ColorPanel />
		</TestProvider>
	)
	const header = [...utils.container.querySelectorAll("button[aria-expanded]")].find(
		(b) => b.textContent?.trim() === "Connection line"
	)!
	fireEvent.click(header)
	// The subsection body follows its header row.
	const section = header.closest("div")!.parentElement!
	const varyBy = within(section).getByLabelText("Vary by") as HTMLSelectElement
	return {
		...utils,
		section,
		varyBy,
		configs: () => (snapshot as TestStore | null)?.get(currentChannelConfigsAtom),
	}
}

const BASE: ChannelConfigs = {
	...EMPTY_CHANNEL_CONFIGS,
	connection: { ...DEFAULT_CONNECTION_CONFIG },
}

describe("Color → Connection line (radar)", () => {
	it("offers Match fill, — none — and every variable, defaulting to Match fill", () => {
		const { varyBy } = mount(BASE)
		const labels = [...varyBy.options].map((o) => o.textContent)
		expect(labels.slice(0, 2)).toEqual(["Match fill", "— none —"])
		expect(labels).toContain("team")
		expect(labels).toContain("league")
		expect(varyBy.selectedOptions[0]?.textContent).toBe("Match fill")
	})

	it("picking a variable writes the Line color slot", () => {
		const { varyBy, configs } = mount(BASE)
		fireEvent.change(varyBy, { target: { value: "league" } })
		expect(configs()?.colorSlots?.line?.field).toBe("league")
	})

	it("shows an older outline palette as varying by the series, and the first edit clears it", () => {
		const legacy: ChannelConfigs = {
			...BASE,
			connection: {
				...DEFAULT_CONNECTION_CONFIG,
				linePaletteId: "p1",
				linePalette: ["#111111", "#222222"],
				lineColors: { north: "#abcdef" },
			},
		}
		const { varyBy, configs } = mount(legacy)
		expect(varyBy.value).toBe("team")
		fireEvent.change(varyBy, { target: { value: "" } })
		const c = configs()
		expect(c?.colorSlots?.line?.field).toBeNull()
		expect(c?.connection?.linePalette ?? null).toBeNull()
		expect(c?.connection?.lineColors).toEqual({})
	})

	it("Match fill clears both the slot and any older outline state", () => {
		const { varyBy, configs } = mount({
			...BASE,
			connection: { ...DEFAULT_CONNECTION_CONFIG, strokeColor: "#ff0000" },
		})
		expect(varyBy.value).toBe("")
		fireEvent.change(varyBy, { target: { value: varyBy.options[0]!.value } })
		const c = configs()
		expect(c?.colorSlots?.line).toBeUndefined()
		expect(c?.connection?.strokeColor ?? null).toBeNull()
	})
})
