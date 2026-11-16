import { act, cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { buildDataset as buildDatasetFixture } from "../../../../../testSupport/fixtures"
import { installInMemoryLocalStorage } from "../../../../../testSupport/localStorageShim"
import { expandSubsections } from "../../../../../testSupport/scanControls"
import { TestProvider, type TestStore } from "../../../../../testSupport/TestProvider"
import { EMPTY_CHANNEL_CONFIGS, type ChannelConfigs } from "../../../lib/channelConfig"
import { emptyEncodings, type Dataset, type EncodingChannel, type Encodings } from "../../../lib/types"
import {
	currentChannelConfigsAtom,
	currentDatasetIdAtom,
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
	loadedDatasetsAtom,
	previewVersionIdAtom,
} from "../../../store/atoms"

import { CHANNEL_PANELS } from "./channelPanels"

/** A reset link sits beside the setting it resets: in the setting's own
 *  row, after its control — never in a row of its own under it, and never
 *  one link at the bottom of the panel.
 *
 *  This checks the markup (the link shares its row with the control and
 *  ends it). Where the link lands on the page is measured in the browser by
 *  `e2e/sweep/resets.sweep.ts`, on every panel of every chart type. */

const ID = "ds-reset-placement"

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: ID,
		name: "scores",
		filename: "scores.csv",
		fields: [
			{ name: "group", inferredType: "categorical" },
			{ name: "score", inferredType: "quantitative" },
			{ name: "weight", inferredType: "quantitative" },
		],
		rows: ["A", "B"].flatMap((group) =>
			Array.from({ length: 3 }, (_, i) => ({
				group,
				score: String(i + 1),
				weight: String(10 + i),
			}))
		),
	})

const SCATTER: Encodings = { ...emptyEncodings(), x: { field: "weight" }, y: { field: "score" } }
const LINE: Encodings = { ...SCATTER, connection: { field: "group" } }

/** The reset links a panel shows, each with the row it sits in. */
const resetsIn = (
	channel: EncodingChannel,
	encodings: Encodings,
	configs: Record<string, unknown>
): Array<{ label: string; row: HTMLElement; link: HTMLElement }> => {
	installInMemoryLocalStorage()
	const init = (snap: TestStore) => {
		snap.set(loadedDatasetsAtom, { [ID]: buildDataset() })
		snap.set(currentDatasetIdAtom, ID)
		snap.set(previewVersionIdAtom, null)
		snap.set(currentEncodingsAtom, encodings)
		snap.set(currentChannelConfigsAtom, { ...EMPTY_CHANNEL_CONFIGS, ...configs } as ChannelConfigs)
		snap.set(currentFieldOverridesAtom, {})
		snap.set(currentFieldLevelOrdersAtom, {})
	}
	const Panel = CHANNEL_PANELS[channel]
	const { container } = render(
		<TestProvider initializeState={init}>
			<div data-reset-root>
				<Panel />
			</div>
		</TestProvider>
	)
	for (let pass = 0; pass < 8; pass++) {
		let opened = 0
		act(() => {
			opened = expandSubsections("[data-reset-root]")
		})
		if (opened === 0) break
	}
	return [...container.querySelectorAll<HTMLElement>('[data-tip="reset-link"]')].map((link) => ({
		label: link.getAttribute("aria-label") ?? link.textContent ?? "",
		row: link.parentElement as HTMLElement,
		link,
	}))
}

const CONTROL = 'input, select, button[aria-pressed], [role="switch"]'

const CASES: Array<{
	name: string
	channel: EncodingChannel
	encodings: Encodings
	configs: Record<string, unknown>
	/** The reset this change must bring up. */
	expects: string
}> = [
	{
		name: "Size → Point → Size",
		channel: "area",
		encodings: SCATTER,
		configs: { defaultRadius: 14 },
		expects: "Reset point size",
	},
	{
		name: "Opacity → Point outline → Opacity",
		channel: "opacity",
		encodings: SCATTER,
		configs: { opacitySlots: { border: { field: null, level: 0.5 } } },
		expects: "Reset opacity",
	},
	{
		name: "Saturation → Point outline → Saturation",
		channel: "saturation",
		encodings: SCATTER,
		configs: { saturationSlots: { outline: { field: null, level: 0.9 } } },
		expects: "Reset to the palette color",
	},
	{
		name: "Length → Length",
		channel: "length",
		encodings: SCATTER,
		configs: { defaultLength: 12 },
		expects: "Reset length",
	},
	{
		name: "Shape → Default shape",
		channel: "shape",
		encodings: SCATTER,
		configs: { defaultShape: 2 },
		expects: "Reset default shape",
	},
	{
		name: "Pattern → Default pattern",
		channel: "pattern",
		encodings: SCATTER,
		configs: { defaultPattern: 1 },
		expects: "Reset pattern option",
	},
	{
		name: "Connection → Smooth line → Amount",
		channel: "connection",
		encodings: LINE,
		configs: { connection: { ...EMPTY_CHANNEL_CONFIGS.connection, smoothing: 0.3 } },
		expects: "Reset smoothing amount",
	},
	{
		name: "Pattern → Line → dash",
		channel: "pattern",
		encodings: LINE,
		configs: {
			connection: { ...EMPTY_CHANNEL_CONFIGS.connection, defaultDashPattern: "dashed" },
		},
		expects: "Reset line dash",
	},
]

describe("reset links sit in their setting's row", () => {
	afterEach(cleanup)

	it.each(CASES)("$name", ({ channel, encodings, configs, expects }) => {
		const resets = resetsIn(channel, encodings, configs)
		expect(resets.map((r) => r.label)).toContain(expects)
		for (const { label, row, link } of resets) {
			// The row holds the control the link resets…
			expect(row.querySelector(CONTROL), `${label}: shares a row with a control`).not.toBeNull()
			// …and the link comes after it, ending the row.
			expect(row.lastElementChild, `${label}: ends its row`).toBe(link)
		}
	})

	it.each(CASES)("$name: untouched, the setting shows no reset", ({ channel, encodings, expects }) => {
		expect(resetsIn(channel, encodings, {}).map((r) => r.label)).not.toContain(expects)
	})
})
