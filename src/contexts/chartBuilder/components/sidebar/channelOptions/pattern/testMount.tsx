import { render } from "@testing-library/react"
import type { ReactNode } from "react"

import { buildDataset as buildDatasetFixture } from "../../../../../../testSupport/fixtures"
import { installInMemoryLocalStorage } from "../../../../../../testSupport/localStorageShim"
import { TestProvider, type TestStore } from "../../../../../../testSupport/TestProvider"
import { EMPTY_CHANNEL_CONFIGS, type ChannelConfigs } from "../../../../lib/channelConfig"
import { emptyEncodings, type Encodings } from "../../../../lib/types"
import {
	currentChannelConfigsAtom,
	currentDatasetIdAtom,
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
	loadedDatasetsAtom,
	previewVersionIdAtom,
} from "../../../../store/atoms"

import { usePatternPanel, type PatternPanel } from "./usePatternPanel"

/** Shared mount for the Pattern section smoke tests: a small dataset (three
 *  groups × two series), the chart's encodings and configs seeded straight
 *  into the store, and ONE piece of the panel rendered with the panel state
 *  `usePatternPanel` hands every section. */

const ID = "ds-pattern-pieces"

const E = emptyEncodings()
export const SCATTER: Encodings = { ...E, x: { field: "group" }, y: { field: "score" } }
export const BARS: Encodings = { ...E, x: { field: "group" }, length: { field: "score" } }
/** A scatter whose marks are line segments: a variable on Length. */
export const SEGMENTS: Encodings = {
	...E,
	x: { field: "weight" },
	y: { field: "score" },
	length: { field: "span" },
}
export const LINE: Encodings = {
	...E,
	x: { field: "weight" },
	y: { field: "score" },
	connection: { field: "series" },
}
export const RADAR: Encodings = {
	...E,
	r: { field: "score" },
	angle: { field: "group" },
	connection: { field: "series" },
}
export const AREA: Encodings = {
	...E,
	x: { field: "group" },
	length: { field: "score" },
	connection: { field: "series" },
}
export const withPattern = (e: Encodings, field: string): Encodings => ({
	...e,
	pattern: { field },
})

const Piece = ({ children }: { children: (p: PatternPanel) => ReactNode }) => (
	<>{children(usePatternPanel())}</>
)

export const mountPiece = (
	encodings: Encodings,
	configs: Partial<ChannelConfigs>,
	piece: (p: PatternPanel) => ReactNode
) => {
	installInMemoryLocalStorage()
	const cfg = { ...EMPTY_CHANNEL_CONFIGS, ...configs } as ChannelConfigs
	let store: TestStore | null = null
	const dataset = buildDatasetFixture({
		id: ID,
		name: "scores",
		filename: "scores.csv",
		fields: [
			{ name: "group", inferredType: "categorical" },
			{ name: "series", inferredType: "categorical" },
			{ name: "score", inferredType: "quantitative" },
			{ name: "weight", inferredType: "quantitative" },
			{ name: "span", inferredType: "quantitative" },
		],
		rows: ["A", "B", "C"].flatMap((group) =>
			["s1", "s2"].flatMap((series) =>
				Array.from({ length: 3 }, (_, i) => ({
					group,
					series,
					score: String(i + 1),
					weight: String(10 + i),
					span: String(20 + i),
				}))
			)
		),
	})
	const init = (snap: TestStore) => {
		store = snap
		snap.set(loadedDatasetsAtom, { [ID]: dataset })
		snap.set(currentDatasetIdAtom, ID)
		snap.set(previewVersionIdAtom, null)
		snap.set(currentEncodingsAtom, encodings)
		snap.set(currentChannelConfigsAtom, cfg)
		snap.set(currentFieldOverridesAtom, {})
		snap.set(currentFieldLevelOrdersAtom, {})
	}
	const view = render(
		<TestProvider initializeState={init}>
			<Piece>{piece}</Piece>
		</TestProvider>
	)
	const s = () => store as unknown as TestStore
	return {
		container: view.container,
		configs: (): ChannelConfigs => s().get(currentChannelConfigsAtom),
		encodings: (): Encodings => s().get(currentEncodingsAtom),
	}
}

/** The titles of the rendered section cards, in display order. */
export const sectionTitles = (c: HTMLElement): string[] =>
	[...c.querySelectorAll("button[aria-expanded]")]
		.map((b) => b.textContent?.trim() ?? "")
		.filter((t) => t !== "")
