import { render } from "@testing-library/react"
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
import { OpacityOptionsPanel } from "./OpacityOptionsPanel"
import { PatternOptionsPanel } from "./PatternOptionsPanel"
import { BrightnessOptionsPanel, SaturationOptionsPanel } from "./RangePanel"

/** In polygon mode (radar) every aesthetic menu — Color, Opacity,
 *  Saturation, Brightness and Pattern — offers the same four targets under
 *  the same names, in the same order: Point fill, Point outline, Connection
 *  line (the polygon outline) and Polygon fill. The plain "Fill" / "Outline"
 *  / "Line" names never appear there, and Polygon fill needs a filled
 *  polygon (an unfilled one has no body to style). */

const ID = "ds-radar-part-titles"

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: ID,
		name: "radar",
		filename: "radar.csv",
		fields: [
			{ name: "metric", inferredType: "categorical" },
			{ name: "score", inferredType: "quantitative" },
			{ name: "team", inferredType: "categorical" },
		],
		rows: ["north", "south"].flatMap((team) =>
			["A", "B", "C"].map((metric, i) => ({ metric, score: String(i + 1), team }))
		),
	})

const enc = {
	...emptyEncodings(),
	r: { field: "score" },
	angle: { field: "metric" },
	connection: { field: "team" },
}
const FILLED: ChannelConfigs = {
	...EMPTY_CHANNEL_CONFIGS,
	connection: { ...DEFAULT_CONNECTION_CONFIG, fillPolygon: true },
}
const UNFILLED: ChannelConfigs = {
	...EMPTY_CHANNEL_CONFIGS,
	connection: { ...DEFAULT_CONNECTION_CONFIG },
}

const mount = (panel: React.ReactNode, cfg: ChannelConfigs) => {
	const store = installInMemoryLocalStorage()
	/* eslint-disable @vc/use-wrapped-json-functions */
	const set = (k: string, v: unknown) => store.set(k, JSON.stringify(v))
	set("vis-components:datasets", { [ID]: buildDataset() })
	set("vis-components:currentDatasetId", ID)
	set("vis-components:previewVersionId", null)
	set("vis-components:currentEncodings", enc)
	set("vis-components:currentChannelConfigs", cfg)
	/* eslint-enable @vc/use-wrapped-json-functions */
	const init = (snap: TestStore) => {
		snap.set(loadedDatasetsAtom, { [ID]: buildDataset() })
		snap.set(currentDatasetIdAtom, ID)
		snap.set(previewVersionIdAtom, null)
		snap.set(currentEncodingsAtom, enc)
		snap.set(currentChannelConfigsAtom, cfg)
		snap.set(currentFieldOverridesAtom, {})
		snap.set(currentFieldLevelOrdersAtom, {})
	}
	return render(<TestProvider initializeState={init}>{panel}</TestProvider>)
}

const subheaders = (c: HTMLElement): string[] =>
	[...c.querySelectorAll("button[aria-expanded]")].map(
		(b) => b.textContent?.trim() ?? ""
	)

const TARGETS = ["Point fill", "Point outline", "Connection line", "Polygon fill"]

const PANELS: Array<[string, React.ReactNode]> = [
	["Color", <ColorPanel key="c" />],
	["Opacity", <OpacityOptionsPanel key="o" />],
	["Saturation", <SaturationOptionsPanel key="s" />],
	["Brightness", <BrightnessOptionsPanel key="b" />],
	["Pattern", <PatternOptionsPanel key="p" />],
]

describe.each(PANELS)("%s menu — radar targets", (_name, panel) => {
	it("has no Radar spine section (it lives under R position)", () => {
		expect(subheaders(mount(panel, FILLED).container)).not.toContain(
			"Radar spine"
		)
	})

	it("offers Point fill, Point outline, Connection line and Polygon fill, in that order, on a filled radar", () => {
		const headers = subheaders(mount(panel, FILLED).container)
		expect(headers.filter((h) => TARGETS.includes(h))).toEqual(TARGETS)
		expect(headers).not.toContain("Fill")
		expect(headers).not.toContain("Outline")
		expect(headers).not.toContain("Line")
		expect(headers).not.toContain("Line dash")
	})

	it("drops Polygon fill on an unfilled radar (no body) and keeps the other three", () => {
		const headers = subheaders(mount(panel, UNFILLED).container)
		expect(headers.filter((h) => TARGETS.includes(h))).toEqual([
			"Point fill",
			"Point outline",
			"Connection line",
		])
	})
})

describe("Color menu — radar", () => {
	it("offers a Vary by under Point fill", () => {
		const { queryAllByText } = mount(<ColorPanel />, FILLED)
		// Point fill is open by default; its in-panel field selector is the
		// scatter-style one (the points are per-row marks), not hidden as the
		// area modes hide theirs.
		expect(queryAllByText("Vary by").length).toBeGreaterThan(0)
	})
})
