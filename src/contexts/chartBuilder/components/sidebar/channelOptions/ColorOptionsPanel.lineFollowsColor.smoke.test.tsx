import { cleanup, fireEvent, render, within } from "@testing-library/react"
import { TestProvider, type TestStore } from "../../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../../testSupport/fixtures"
import { afterEach, describe, expect, it } from "vitest"

import { DEFAULT_DATA_LABELS_CONFIG, type ChannelConfigs } from "../../../lib/channelConfig"
import { colorSlotEdited } from "../../../lib/colorSlots"
import { DEFAULT_LABELS_CONFIG } from "../../../lib/labelsConfig"
import { withLineFollowingColor } from "../../../lib/lineFollowsColor"
import { LIGHT_THEME_BASE as theme } from "../../../lib/systemThemes"
import { configsFromTheme } from "../../../lib/themeConfig"
import {
	emptyDataLabelsEncodings,
	emptyEncodings,
	type Dataset,
	type Encodings,
} from "../../../lib/types"
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
} from "../../../store/atoms"

import { ColorOptionsPanel } from "./ColorOptionsPanel"

/** Lines follow Color through the Color panel itself: a new Color palette
 *  carries lines that were following Color along, and the panel's own
 *  "Vary by" pick does what the Color shelf pick does. */

const DATASET_ID = "ds-color-panel-line-follow"

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
			<ColorOptionsPanel />
		</TestProvider>
	)
	return {
		container,
		configs: () => store!.get(currentChannelConfigsAtom),
		encodings: () => store!.get(currentEncodingsAtom),
	}
}

const themed = configsFromTheme(theme)
const other = theme.categoricalPalettes.find((p) => p.id !== theme.defaultCategoricalPaletteId)!

afterEach(cleanup)

describe("ColorOptionsPanel: lines follow Color", () => {
	it("a new Color palette carries lines that were following Color, with no changed dot", () => {
		const colored = { ...LINE, hue: { field: "g" } }
		const following = withLineFollowingColor(themed, colored, "categorical", theme)
		const { container, configs } = mount(colored, following)
		fireEvent.change(within(container).getByLabelText("Palette"), { target: { value: other.id } })
		const after = configs()
		expect(after.categoricalPalette).toEqual(other.colors)
		expect(after.colorSlots?.line?.field).toBe("g")
		expect(after.colorSlots?.line?.palette).toEqual(other.colors)
		expect(colorSlotEdited("line", after.colorSlots?.line, after, theme, "g")).toBe(false)
	})

	it("a line color someone picked stays when the Color palette changes", () => {
		const colored = { ...LINE, hue: { field: "g" } }
		const picked: ChannelConfigs = {
			...themed,
			colorSlots: { ...themed.colorSlots, line: { field: null, singleColor: "#123456" } },
		}
		const { container, configs } = mount(colored, picked)
		fireEvent.change(within(container).getByLabelText("Palette"), { target: { value: other.id } })
		expect(configs().colorSlots?.line).toEqual({ field: null, singleColor: "#123456" })
	})

	it("the panel's Vary by pick on a line chart makes the lines follow Color", () => {
		const { container, configs, encodings } = mount(LINE, themed)
		fireEvent.change(within(container).getByLabelText("Vary by"), { target: { value: "g" } })
		expect(encodings().hue?.field).toBe("g")
		expect(configs().colorSlots?.line?.field).toBe("g")
	})
})
