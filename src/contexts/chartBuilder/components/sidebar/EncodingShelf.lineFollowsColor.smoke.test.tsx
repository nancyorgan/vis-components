import { cleanup, fireEvent, render, within } from "@testing-library/react"
import { TestProvider, type TestStore } from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import { afterEach, describe, expect, it } from "vitest"

import {
	DEFAULT_CONNECTION_CONFIG,
	DEFAULT_DATA_LABELS_CONFIG,
	type ChannelConfigs,
} from "../../lib/channelConfig"
import { DEFAULT_LABELS_CONFIG } from "../../lib/labelsConfig"
import { LIGHT_THEME_BASE } from "../../lib/systemThemes"
import { configsFromTheme } from "../../lib/themeConfig"
import {
	emptyDataLabelsEncodings,
	emptyEncodings,
	type Dataset,
	type Encodings,
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
import { ScatterPlot } from "../viz/ScatterPlot"

import { EncodingShelf } from "./EncodingShelf"

/** Lines follow Color, through the editor's own path: picking a Color
 *  variable on a line chart (or a Connection while Color is mapped) sets
 *  Color > Line > Vary by to it, and each line then draws in its own
 *  color. */

const DATASET_ID = "ds-line-follows-color"

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "lines",
		fields: [
			{ name: "x", inferredType: "quantitative" },
			{ name: "y", inferredType: "quantitative" },
			{ name: "g", inferredType: "categorical" },
			{ name: "k", inferredType: "categorical" },
		],
		rows: ["north", "south", "east"].flatMap((g, gi) =>
			[1, 2, 3, 4].map((x) => ({ x: String(x), y: String(x * 10 + gi), g, k: gi === 0 ? "a" : "b" }))
		),
	})

const LINE: Encodings = {
	...emptyEncodings(),
	x: { field: "x" },
	y: { field: "y" },
	connection: { field: "g" },
}

const mount = (encodings: Encodings, configs: ChannelConfigs) => {
	installInMemoryLocalStorage()
	let store: TestStore | null = null
	const init = (snap: TestStore) => {
		store = snap
		snap.set(loadedDatasetsAtom, { [DATASET_ID]: buildDataset() })
		snap.set(currentDatasetIdAtom, DATASET_ID)
		snap.set(previewVersionIdAtom, null)
		snap.set(currentEncodingsAtom, encodings)
		snap.set(currentChannelConfigsAtom, configs)
		snap.set(currentLabelsAtom, DEFAULT_LABELS_CONFIG)
		snap.set(currentDataLabelsConfigAtom, DEFAULT_DATA_LABELS_CONFIG)
		snap.set(currentDataLabelsEncodingsAtom, emptyDataLabelsEncodings())
		snap.set(currentFieldOverridesAtom, {})
		snap.set(currentFieldLevelOrdersAtom, {})
	}
	const { container } = render(
		<TestProvider initializeState={init}>
			<EncodingShelf channel="hue" />
			<EncodingShelf channel="connection" />
			<div style={{ width: 600, height: 400 }}>
				<ScatterPlot />
			</div>
		</TestProvider>
	)
	return { container, configs: () => store!.get(currentChannelConfigsAtom) }
}

const lineStrokes = (container: HTMLElement) =>
	new Set(
		[...container.querySelectorAll("polyline:not(.vc-line-hit)")].map((p) =>
			p.getAttribute("stroke")
		)
	)

const themed = configsFromTheme(LIGHT_THEME_BASE)

afterEach(cleanup)

describe("EncodingShelf — lines follow Color", () => {
	it("before Color, every line draws the one theme line color", () => {
		const { container } = mount(LINE, themed)
		expect(lineStrokes(container).size).toBe(1)
	})

	it("mapping Color on a line chart sets Line > Vary by, and the lines take several colors", () => {
		const { container, configs } = mount(LINE, themed)
		fireEvent.change(within(container).getByLabelText("Color"), { target: { value: "g" } })
		const line = configs().colorSlots?.line
		expect(line?.field).toBe("g")
		expect(line?.palette).toEqual(themed.categoricalPalette)
		const strokes = lineStrokes(container)
		expect(strokes.size).toBe(3)
		// Each line draws in a color of the Color palette, like its points.
		const palette = (themed.categoricalPalette ?? []).map((c) => c.toLowerCase())
		for (const s of strokes) expect(palette).toContain(s?.toLowerCase())
	})

	it("mapping Connection while Color is mapped does the same", () => {
		const { container, configs } = mount(
			{ ...LINE, connection: { field: null }, hue: { field: "g" } },
			themed
		)
		fireEvent.change(within(container).getByLabelText("Connection"), {
			target: { value: "g" },
		})
		expect(configs().colorSlots?.line?.field).toBe("g")
		expect(lineStrokes(container).size).toBe(3)
	})

	it("moving Color to another variable moves lines that followed the old one", () => {
		const { container, configs } = mount(LINE, themed)
		const color = within(container).getByLabelText("Color")
		fireEvent.change(color, { target: { value: "g" } })
		fireEvent.change(color, { target: { value: "k" } })
		expect(configs().colorSlots?.line?.field).toBe("k")
		// Unmapping Color leaves the slot as it is.
		fireEvent.change(color, { target: { value: "" } })
		expect(configs().colorSlots?.line?.field).toBe("k")
	})

	it("a line color someone chose stays", () => {
		const { container, configs } = mount(LINE, {
			...themed,
			connection: { ...DEFAULT_CONNECTION_CONFIG, strokeColor: "#ff0000" },
		})
		fireEvent.change(within(container).getByLabelText("Color"), { target: { value: "g" } })
		expect(configs().colorSlots?.line).toBeUndefined()
		expect(lineStrokes(container)).toEqual(new Set(["#ff0000"]))
	})
})
