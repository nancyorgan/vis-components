import { fireEvent, render } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { buildDataset as buildDatasetFixture } from "../../../../../testSupport/fixtures"
import { installInMemoryLocalStorage } from "../../../../../testSupport/localStorageShim"
import { TestProvider, type TestStore } from "../../../../../testSupport/TestProvider"
import {
	DEFAULT_AXIS_CONFIG,
	DEFAULT_DISTRIBUTION_OVERLAY_CONFIG,
	DEFAULT_REGRESSION_CONFIG,
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

import { PatternOptionsPanel } from "./PatternOptionsPanel"

/** Which sections the Pattern options show, and in what order.
 *
 *  - The regression line's dash sits where the other menus list the
 *    regression line — before the violin / box — with its own reset beside
 *    its swatches, like every other setting here.
 *  - "Violin / box fill" shows exactly when the chart draws a violin or a
 *    box: not on a bar chart that still remembers a box switched on while it
 *    was a scatter, and also on a scatter drawn as line segments. */

const ID = "ds-pattern-sections"

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: ID,
		name: "scores",
		filename: "scores.csv",
		fields: [
			{ name: "group", inferredType: "categorical" },
			{ name: "score", inferredType: "quantitative" },
			{ name: "weight", inferredType: "quantitative" },
			{ name: "span", inferredType: "quantitative" },
		],
		rows: ["A", "B"].flatMap((group) =>
			Array.from({ length: 4 }, (_, i) => ({
				group,
				score: String(i + 1),
				weight: String(10 + i),
				span: String(20 + i),
			}))
		),
	})

const BOX_ON_Y: ChannelConfigs["y"] = {
	...DEFAULT_AXIS_CONFIG,
	distributionOverlay: { ...DEFAULT_DISTRIBUTION_OVERLAY_CONFIG, showBoxPlot: true },
}
const regression = (more: Record<string, unknown> = {}): ChannelConfigs["x"] => ({
	...DEFAULT_AXIS_CONFIG,
	regression: { ...DEFAULT_REGRESSION_CONFIG, enabled: true, ...more },
})

const SCATTER: Encodings = { ...emptyEncodings(), x: { field: "group" }, y: { field: "score" } }
const BARS: Encodings = { ...emptyEncodings(), x: { field: "group" }, length: { field: "score" } }
/** A scatter whose marks are line segments: a variable on Length. */
const SEGMENTS: Encodings = {
	...emptyEncodings(),
	x: { field: "weight" },
	y: { field: "score" },
	length: { field: "span" },
}

const mount = (encodings: Encodings, configs: Partial<ChannelConfigs>) => {
	installInMemoryLocalStorage()
	const cfg = { ...EMPTY_CHANNEL_CONFIGS, ...configs } as ChannelConfigs
	let store: TestStore | null = null
	const init = (snap: TestStore) => {
		store = snap
		snap.set(loadedDatasetsAtom, { [ID]: buildDataset() })
		snap.set(currentDatasetIdAtom, ID)
		snap.set(previewVersionIdAtom, null)
		snap.set(currentEncodingsAtom, encodings)
		snap.set(currentChannelConfigsAtom, cfg)
		snap.set(currentFieldOverridesAtom, {})
		snap.set(currentFieldLevelOrdersAtom, {})
	}
	const view = render(
		<TestProvider initializeState={init}>
			<PatternOptionsPanel />
		</TestProvider>
	)
	return {
		container: view.container,
		configs: (): ChannelConfigs => (store as unknown as TestStore).get(currentChannelConfigsAtom),
	}
}

/** The titles of the panel's sections, in display order. */
const sections = (c: HTMLElement): string[] =>
	[...c.querySelectorAll("button[aria-expanded]")].map((b) => b.textContent?.trim() ?? "")

const resetLinks = (c: HTMLElement): HTMLElement[] =>
	[...c.querySelectorAll<HTMLElement>('button[data-tip="reset-link"]')]

describe("Pattern options — where the regression line sits", () => {
	it("is listed before the violin / box, as in the other menus", () => {
		const { container } = mount(SCATTER, { x: regression(), y: BOX_ON_Y })
		const titles = sections(container).filter((t) =>
			["Point fill", "Regression line", "Violin / box fill"].includes(t)
		)
		expect(titles).toEqual(["Point fill", "Regression line", "Violin / box fill"])
	})

	it("a changed dash has its reset beside its swatches, in the swatch row", () => {
		const { container, configs } = mount(SCATTER, { x: regression({ lineStyle: "dashed" }) })
		// The section opens on its header.
		const header = [...container.querySelectorAll<HTMLElement>("button[aria-expanded]")].find(
			(b) => b.textContent?.trim() === "Regression line"
		)
		fireEvent.click(header as HTMLElement)
		const resets = resetLinks(container)
		// Only the regression dash was changed: one reset, for it.
		expect(resets.map((r) => r.getAttribute("aria-label"))).toEqual(["Reset regression line dash"])
		const reset = resets[0] as HTMLElement
		// It is the last thing in the row of swatches it resets.
		const row = reset.parentElement as HTMLElement
		expect(row.querySelector('button[aria-label="No dash for regression line"]')).not.toBeNull()
		expect(row.lastElementChild).toBe(reset)
		fireEvent.click(reset)
		expect(configs().x?.regression?.lineStyle).toBe(DEFAULT_REGRESSION_CONFIG.lineStyle)
		// The regression itself stays on; only its dash went back.
		expect(configs().x?.regression?.enabled).toBe(true)
		expect(resetLinks(container)).toEqual([])
	})

	it("an untouched panel offers nothing to reset", () => {
		expect(resetLinks(mount(SCATTER, { x: regression() }).container)).toEqual([])
	})
})

describe("Pattern options — Violin / box fill shows exactly when one is drawn", () => {
	it("a scatter with a box plot lists it", () => {
		expect(sections(mount(SCATTER, { y: BOX_ON_Y }).container)).toContain("Violin / box fill")
	})

	it("a bar chart that still remembers a box switched on does not", () => {
		const titles = sections(mount(BARS, { y: BOX_ON_Y }).container)
		expect(titles).not.toContain("Violin / box fill")
		// …and with one kind of control left, the bars' picks need no header.
		expect(titles).not.toContain("Bar fill")
	})

	it("a scatter drawn as line segments lists it with no Pattern variable too", () => {
		const { container } = mount(SEGMENTS, {
			y: BOX_ON_Y,
			// Thin segments: Pattern is their dash.
			pattern: { ...EMPTY_CHANNEL_CONFIGS.pattern, segmentPattern: "dash" } as never,
		})
		// The segments' dash is the menu's own control here, listed bare…
		expect(container.textContent).toContain("Line dash")
		// …and the violin / box body is still there to pattern.
		expect(sections(container)).toContain("Violin / box fill")
	})
})
