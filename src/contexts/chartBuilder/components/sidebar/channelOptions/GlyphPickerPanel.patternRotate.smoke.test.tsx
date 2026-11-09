import { cleanup, fireEvent, render, within } from "@testing-library/react"
import { TestProvider } from "../../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../../testSupport/fixtures"
import { afterEach, describe, expect, it } from "vitest"

import {
	DEFAULT_PATTERN_CONFIG,
	type ChannelConfigs,
	type PatternConfig,
} from "../../../lib/channelConfig"
import { DEFAULT_LABELS_CONFIG } from "../../../lib/labelsConfig"
import { emptyEncodings, type Dataset, type Encodings } from "../../../lib/types"

import { PatternOptionsPanel } from "./GlyphPickerPanel"


/** The Pattern panel's "Rotate" box — the row under each category's Scale
 *  box, turning the category's pattern tile grid (−180° to 180° by 1°).
 *  With a pattern variable mapped it writes `pattern.rotations[category]`;
 *  with none mapped it sits under the default pattern's Scale box and
 *  writes `pattern.defaultRotation`. Blank = 0° (no entry stored). Each of
 *  the two rows carries its own reset link once a value is set. */

const DATASET_ID = "ds-pattern-rotate-panel"
const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "scores",
		filename: "scores.csv",
		fields: [
			{ name: "metric", inferredType: "categorical" },
			{ name: "score", inferredType: "quantitative" },
			{ name: "team", inferredType: "categorical" },
		],
		rows: ["A", "B", "C", "D"].flatMap((metric, i) => [
			{ metric, score: String(10 + i), team: "north" },
			{ metric, score: String(20 - i), team: "south" },
		]),
	})

/** Fill-form encodings (no connection → SVG fill patterns on the marks). */
const FILL: Encodings = {
	...emptyEncodings(),
	x: { field: "metric" },
	y: { field: "score" },
}

const seed = (encodings: Encodings, configs: Partial<ChannelConfigs>) => {
	const store = installInMemoryLocalStorage()
	/* eslint-disable no-restricted-globals, @vc/no-storage-outside-try, @vc/use-wrapped-json-functions */
	const set = (k: string, v: unknown) => localStorage.setItem(k, JSON.stringify(v))
	set("vis-components:datasets", { [DATASET_ID]: buildDataset() })
	set("vis-components:currentDatasetId", DATASET_ID)
	set("vis-components:previewVersionId", null)
	set("vis-components:currentEncodings", encodings)
	set("vis-components:currentChannelConfigs", configs)
	set("vis-components:currentLabels", { _v: 1, data: DEFAULT_LABELS_CONFIG })
	/* eslint-enable no-restricted-globals, @vc/no-storage-outside-try, @vc/use-wrapped-json-functions */
	return store
}

// Datasets hydrate asynchronously — settle a tick before asserting.
const mount = async () => {
	const { container } = render(
		<TestProvider>
			<PatternOptionsPanel />
		</TestProvider>
	)
	await new Promise((r) => setTimeout(r, 50))
	return within(container)
}

afterEach(cleanup)

type SavedConfigs = { defaultPattern?: number | null; pattern?: Partial<PatternConfig> }
const readSavedConfigs = (store: Map<string, string>): SavedConfigs => {
	const parsed = JSON.parse(
		store.get("vis-components:currentChannelConfigs") ?? "{}"
	) as { _v?: number; data?: SavedConfigs }
	return parsed.data ?? (parsed as SavedConfigs)
}

const type = (input: HTMLElement, value: string) =>
	fireEvent.change(input, { target: { value } })

describe("Pattern panel — Rotate (pattern variable mapped)", () => {
	it("shows one Rotate box per category under its Scale box, blank at 0°", async () => {
		seed({ ...FILL, pattern: { field: "team" } }, {})
		const q = await mount()
		const north = q.getByLabelText("Rotate for north") as HTMLInputElement
		expect(north.value).toBe("")
		expect(north.placeholder).toBe("0")
		expect(q.getByLabelText("Rotate for south")).toBeTruthy()
		// Its own row, directly after the Scale row.
		const rowOf = (input: HTMLElement) => input.closest("div.flex-wrap")
		const scaleRow = rowOf(q.getByLabelText("Scale for north"))
		expect(rowOf(north)).toBeTruthy()
		expect(rowOf(north)).not.toBe(scaleRow)
		expect(scaleRow?.nextElementSibling).toBe(rowOf(north))
		// Nothing set: no per-row reset links yet.
		expect(q.queryByLabelText("Reset rotate for north")).toBeNull()
		expect(q.queryByLabelText("Reset scale for north")).toBeNull()
	})

	it("each row's own reset link clears only that value", async () => {
		const store = seed(
			{ ...FILL, pattern: { field: "team" } },
			{
				pattern: {
					...DEFAULT_PATTERN_CONFIG,
					scales: { north: 2 },
					rotations: { north: 45 },
				},
			}
		)
		const q = await mount()
		fireEvent.click(q.getByLabelText("Reset rotate for north"))
		expect(readSavedConfigs(store).pattern?.rotations ?? {}).toEqual({})
		expect(readSavedConfigs(store).pattern?.scales).toEqual({ north: 2 })
		expect(q.queryByLabelText("Reset rotate for north")).toBeNull()
		fireEvent.click(q.getByLabelText("Reset scale for north"))
		expect(readSavedConfigs(store).pattern?.scales ?? {}).toEqual({})
	})

	it("typing writes pattern.rotations[category] and leaves scales alone", async () => {
		const store = seed({ ...FILL, pattern: { field: "team" } }, {})
		const q = await mount()
		type(q.getByLabelText("Rotate for north"), "45")
		expect(readSavedConfigs(store).pattern?.rotations).toEqual({ north: 45 })
		expect(readSavedConfigs(store).pattern?.scales ?? {}).toEqual({})
		type(q.getByLabelText("Rotate for south"), "-30")
		expect(readSavedConfigs(store).pattern?.rotations).toEqual({
			north: 45,
			south: -30,
		})
	})

	it("clamps typed values into −180°–180°", async () => {
		const store = seed({ ...FILL, pattern: { field: "team" } }, {})
		const q = await mount()
		type(q.getByLabelText("Rotate for north"), "400")
		expect(readSavedConfigs(store).pattern?.rotations).toEqual({ north: 180 })
		type(q.getByLabelText("Rotate for north"), "-400")
		expect(readSavedConfigs(store).pattern?.rotations).toEqual({ north: -180 })
	})

	it("emptying the box drops the entry, and the category Reset clears it too", async () => {
		const store = seed(
			{ ...FILL, pattern: { field: "team" } },
			{
				pattern: {
					...DEFAULT_PATTERN_CONFIG,
					rotations: { north: 45, south: 90 },
				},
			}
		)
		const q = await mount()
		const north = q.getByLabelText("Rotate for north") as HTMLInputElement
		expect(north.value).toBe("45")
		type(north, "")
		expect(readSavedConfigs(store).pattern?.rotations).toEqual({ south: 90 })
		// A rotation alone lights the category's Reset link (the "reset"
		// beside the category name); clicking it drops the entry like the
		// pattern / ink / scale picks. North has nothing left, so only
		// south's row carries one.
		const southRow = q.getByTitle("south").parentElement
		expect(southRow).toBeTruthy()
		expect(q.getByTitle("north").parentElement?.textContent).not.toContain("reset")
		fireEvent.click(within(southRow!).getByText("reset"))
		expect(readSavedConfigs(store).pattern?.rotations ?? {}).toEqual({})
	})
})

describe("Pattern panel — Rotate (no pattern variable)", () => {
	it("appears beside the default pattern's Scale box once a pattern is picked", async () => {
		seed(FILL, {})
		let q = await mount()
		expect(q.queryByLabelText("Rotate")).toBeNull()
		cleanup()
		seed(FILL, { defaultPattern: 0 })
		q = await mount()
		expect(q.getByLabelText("Rotate")).toBeTruthy()
		expect(q.getByLabelText("Scale")).toBeTruthy()
	})

	it("writes pattern.defaultRotation, and the bottom Reset clears it", async () => {
		const store = seed(FILL, { defaultPattern: 0 })
		const q = await mount()
		type(q.getByLabelText("Rotate"), "60")
		expect(readSavedConfigs(store).pattern?.defaultRotation).toBe(60)
		const panelReset = q
			.getAllByText("reset")
			.find((el) => el.className.includes("underline"))
		expect(panelReset).toBeTruthy()
		fireEvent.click(panelReset!)
		expect(readSavedConfigs(store).pattern?.defaultRotation ?? null).toBeNull()
	})
})
