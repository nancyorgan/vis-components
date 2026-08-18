import { cleanup, fireEvent, render, within } from "@testing-library/react"
import { TestProvider } from "../../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../../testSupport/fixtures"
import { afterEach, describe, expect, it } from "vitest"

import type { CustomGlyph, ShapeConfig } from "../../../lib/channelConfig"
import { CUSTOM_GLYPH_BASE } from "../../../lib/customGlyphs"
import { DEFAULT_LABELS_CONFIG } from "../../../lib/labelsConfig"
import { emptyEncodings, type Dataset, type Encodings } from "../../../lib/types"

import { ShapeOptionsPanel } from "./GlyphPickerPanel"

/** The Shape panel's Custom option: the "+" chip opens an inline editor
 *  where the user types a short text glyph (or uploads an image); creating
 *  one appends it to `shape.customGlyphs` and selects it for the row that
 *  opened the editor (default shape OR a per-category override). Deleting
 *  tombstones the slot so other rows' indices stay stable. */

const DATASET_ID = "ds-custom-glyph-panel"

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "sales",
		filename: "sales.csv",
		fields: [
			{ name: "month", inferredType: "quantitative" },
			{ name: "sales", inferredType: "quantitative" },
			{ name: "region", inferredType: "categorical" },
		],
		rows: Array.from({ length: 4 }, (_, i) => ({
			month: String(i),
			sales: String(2 * i),
			region: i % 2 === 0 ? "East" : "West",
		})),
	})

const seed = (
	encodings: Encodings,
	configs?: { defaultShape?: number; shape?: Partial<ShapeConfig> }
) => {
	const store = installInMemoryLocalStorage()
	/* eslint-disable no-restricted-globals, @th/no-storage-outside-try, @th/use-wrapped-json-functions */
	const set = (k: string, v: unknown) => localStorage.setItem(k, JSON.stringify(v))
	set("vis-components:datasets", { [DATASET_ID]: buildDataset() })
	set("vis-components:currentDatasetId", DATASET_ID)
	set("vis-components:previewVersionId", null)
	set("vis-components:currentEncodings", encodings)
	set("vis-components:currentLabels", { _v: 1, data: DEFAULT_LABELS_CONFIG })
	if (configs) set("vis-components:currentChannelConfigs", { _v: 1, data: configs })
	/* eslint-enable no-restricted-globals, @th/no-storage-outside-try, @th/use-wrapped-json-functions */
	return store
}

// Datasets hydrate asynchronously (IndexedDB-backed persist effect) — settle
// a tick before asserting, and scope queries to this render's container.
const mount = async () => {
	const { container } = render(
		<TestProvider>
			<ShapeOptionsPanel />
		</TestProvider>
	)
	await new Promise((r) => setTimeout(r, 50))
	return within(container)
}

afterEach(cleanup)

/** Scatter encodings — the Default-shape row shows (no shape field). */
const SCATTER: Encodings = {
	...emptyEncodings(),
	x: { field: "month" },
	y: { field: "sales" },
}

/** Shape field mapped — per-category rows replace the default row. */
const SHAPED: Encodings = {
	...SCATTER,
	shape: { field: "region" },
}

type SavedConfigs = {
	defaultShape?: number
	shape?: { customGlyphs?: Array<CustomGlyph | null>; overrides?: Record<string, number> }
}
const readSavedConfigs = (store: Map<string, string>): SavedConfigs => {
	const parsed = JSON.parse(
		store.get("vis-components:currentChannelConfigs") ?? "{}"
	) as { _v?: number; data?: SavedConfigs }
	return parsed.data ?? (parsed as SavedConfigs)
}

describe("Shape panel — custom glyphs (no shape field: Default shape row)", () => {
	it("'+' opens the editor; typing text and Add creates the glyph AND selects it as the default shape", async () => {
		const store = seed(SCATTER)
		const q = await mount()
		fireEvent.click(q.getByLabelText("Add custom shape"))
		fireEvent.change(q.getByLabelText("Custom shape text"), {
			target: { value: "Rx" },
		})
		fireEvent.click(q.getByText("Add"))
		const saved = readSavedConfigs(store)
		expect(saved.shape?.customGlyphs).toEqual([{ kind: "text", text: "Rx" }])
		expect(saved.defaultShape).toBe(CUSTOM_GLYPH_BASE)
		// The editor closes and the new glyph shows as a selected chip.
		expect(q.queryByLabelText("Custom shape text")).toBeNull()
		expect(q.getByText("Rx").closest("button")?.getAttribute("aria-pressed")).toBe(
			"true"
		)
	})

	it("over-long text is never truncated while typing — Add disables instead; multi-code-point emoji count as ONE character", async () => {
		seed(SCATTER)
		const q = await mount()
		fireEvent.click(q.getByLabelText("Add custom shape"))
		const input = q.getByLabelText("Custom shape text") as HTMLInputElement
		fireEvent.change(input, { target: { value: "abcd" } })
		expect(input.value).toBe("abcd")
		expect((q.getByText("Add") as HTMLButtonElement).disabled).toBe(true)
		fireEvent.change(input, { target: { value: "👍🏽" } })
		expect((q.getByText("Add") as HTMLButtonElement).disabled).toBe(false)
	})

	it("emoji shortcodes expand: ':fire:' converts as typed; a bare ':joy' converts on Add", async () => {
		const store = seed(SCATTER)
		const q = await mount()
		fireEvent.click(q.getByLabelText("Add custom shape"))
		const input = q.getByLabelText("Custom shape text") as HTMLInputElement
		// Complete token converts on the keystroke that closes it.
		fireEvent.change(input, { target: { value: ":fire:" } })
		expect(input.value).toBe("🔥")
		// A bare shortcode (no closing colon) still enables Add and
		// converts at submit — the exact ':joy' report.
		fireEvent.change(input, { target: { value: ":joy" } })
		expect(input.value).toBe(":joy")
		const addBtn = q.getByText("Add") as HTMLButtonElement
		expect(addBtn.disabled).toBe(false)
		fireEvent.click(addBtn)
		expect(readSavedConfigs(store).shape?.customGlyphs).toEqual([
			{ kind: "text", text: "😂" },
		])
	})

	it("the create-only Adjust position nudge appears once text is typed and stores dx/dy (Y sign flips: UI positive = up)", async () => {
		const store = seed(SCATTER)
		const q = await mount()
		fireEvent.click(q.getByLabelText("Add custom shape"))
		// Hidden until there's a typed glyph to place.
		expect(q.queryByText("Adjust position")).toBeNull()
		fireEvent.change(q.getByLabelText("Custom shape text"), {
			target: { value: "_" },
		})
		expect(q.getByText("Adjust position")).toBeTruthy()
		fireEvent.change(q.getByLabelText("X"), { target: { value: "-60" } })
		fireEvent.change(q.getByLabelText("Y"), { target: { value: "25" } })
		fireEvent.click(q.getByText("Add"))
		// % of mark radius → stored as multiples of r; Y flips to screen
		// convention (positive = down) at the input boundary.
		expect(readSavedConfigs(store).shape?.customGlyphs).toEqual([
			{ kind: "text", text: "_", dx: -0.6, dy: -0.25 },
		])
	})

	it("deleting a glyph tombstones its slot (null, not spliced)", async () => {
		const store = seed(SCATTER, {
			defaultShape: CUSTOM_GLYPH_BASE + 1,
			shape: {
				customGlyphs: [
					{ kind: "text", text: "A" },
					{ kind: "text", text: "B" },
				],
			},
		})
		const q = await mount()
		fireEvent.click(q.getAllByLabelText("Delete custom shape")[0]!)
		const saved = readSavedConfigs(store)
		expect(saved.shape?.customGlyphs).toEqual([
			null,
			{ kind: "text", text: "B" },
		])
		// "B"'s index is untouched — still the selected default.
		expect(saved.defaultShape ?? CUSTOM_GLYPH_BASE + 1).toBe(
			CUSTOM_GLYPH_BASE + 1
		)
	})
})

describe("Shape panel — custom glyphs (shape field mapped: per-category rows)", () => {
	it("creating a glyph from a category row writes that category's override", async () => {
		const store = seed(SHAPED)
		const q = await mount()
		// One "+" chip per category row; open the FIRST row's editor (East —
		// categories list in data order).
		fireEvent.click(q.getAllByLabelText("Add custom shape")[0]!)
		fireEvent.change(q.getByLabelText("Custom shape text"), {
			target: { value: "★" },
		})
		fireEvent.click(q.getByText("Add"))
		const saved = readSavedConfigs(store)
		expect(saved.shape?.customGlyphs).toEqual([{ kind: "text", text: "★" }])
		expect(saved.shape?.overrides).toEqual({ East: CUSTOM_GLYPH_BASE })
	})

	it("a glyph created from one row is offered as a chip on every row", async () => {
		seed(SHAPED, {
			shape: { customGlyphs: [{ kind: "text", text: "★" }] },
		})
		const q = await mount()
		// Two category rows (East, West) → the shared glyph chips on each.
		expect(q.getAllByText("★").length).toBe(2)
	})
})
