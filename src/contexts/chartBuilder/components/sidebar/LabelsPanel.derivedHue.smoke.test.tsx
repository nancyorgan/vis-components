import { cleanup, fireEvent, render } from "@testing-library/react"
import { TestProvider, type TestStore } from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import { afterEach, describe, expect, it } from "vitest"
import { DEFAULT_LEGEND_CONFIG, type LegendChannel } from "../../lib/labelsConfig"
import { LEGEND_VERSION } from "../../lib/storage/migrations"
import { emptyEncodings, type Dataset } from "../../lib/types"
import { currentLabelsAtom } from "../../store/atoms"

import { LabelsPanel } from "./LabelsPanel"

/** In the tree modes (sunburst / treemap / packed circles) Fill color can
 *  vary by the DERIVED "Top-level group" / "Nesting depth" source, which has
 *  no backing field. The legend draws a Color section for it, titled through
 *  `legendTitles.hue` like any field-backed Color legend — so the "Legend
 *  titles" subsection must offer a Color row for it. Before this, a sunburst
 *  showed only a "Size legend" row (for the Size legend the mode hides by
 *  default), and typing there changed nothing on the chart. */

const DATASET_ID = "ds-labelspanel-derived-hue"

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "fruit",
		filename: "fruit.csv",
		fields: [
			{ name: "Parent", inferredType: "categorical" },
			{ name: "Child", inferredType: "categorical" },
			{ name: "Value", inferredType: "quantitative" },
		],
		rows: [
			{ Parent: "Pome", Child: "Apple", Value: "7" },
			{ Parent: "Citrus", Child: "Lemon", Value: "8" },
		],
	})

const seed = (opts: {
	source: "rootGroup" | "depth" | null
	connection: boolean
	hidden?: Partial<Record<LegendChannel, boolean>>
}) => {
	const store = installInMemoryLocalStorage()
	/* eslint-disable @vc/use-wrapped-json-functions */
	store.set("vis-components:datasets", JSON.stringify({ [DATASET_ID]: buildDataset() }))
	store.set("vis-components:currentDatasetId", JSON.stringify(DATASET_ID))
	store.set("vis-components:previewVersionId", JSON.stringify(null))
	store.set(
		"vis-components:currentEncodings",
		JSON.stringify({
			...emptyEncodings(),
			...(opts.connection ? { connection: { field: "Parent" } } : {}),
			area: { field: "Value" },
			...(opts.source ? { hue: { field: null, measureSource: opts.source } } : {}),
		})
	)
	store.set(
		"vis-components:currentChannelConfigs",
		JSON.stringify({ connection: { hierarchyLayout: "sunburst" } })
	)
	if (opts.hidden) {
		store.set(
			"vis-components:currentLegend",
			JSON.stringify({
				_v: LEGEND_VERSION,
				data: { ...DEFAULT_LEGEND_CONFIG, hidden: opts.hidden },
			})
		)
	}
	/* eslint-enable @vc/use-wrapped-json-functions */
}

afterEach(cleanup)

const mount = () => {
	let snap: TestStore | null = null
	const utils = render(
		<TestProvider initializeState={(s) => (snap = s)}>
			<LabelsPanel />
		</TestProvider>
	)
	const labels = () => (snap as TestStore | null)?.get(currentLabelsAtom)
	return { ...utils, labels }
}

// Subsection header button: CollapsibleSubsection renders the title text as
// the button's only text content (chevron svg + changed-dot span are both
// aria-hidden and textless), so trimmed textContent identifies it uniquely.
const sectionHeader = (container: HTMLElement, title: string) =>
	[...container.querySelectorAll<HTMLButtonElement>("button")].find(
		(b) =>
			b.getAttribute("aria-expanded") !== null &&
			b.textContent?.trim() === title
	) ?? null

const openLegendTitles = (container: HTMLElement) => {
	const header = sectionHeader(container, "Legend titles")
	expect(header, 'subsection header "Legend titles"').not.toBeNull()
	fireEvent.click(header!)
}

// Row presence is probed via the disclosure button's aria-label — it's the
// one element every LabelRow renders regardless of its text.
const rowToggle = (container: HTMLElement, label: string) =>
	container.querySelector(
		`button[aria-label="Toggle font settings for ${label}"]`
	)

describe("LabelsPanel — legend titles for a hierarchy-derived Color legend", () => {
	it("sunburst colored by Top-level group: offers a Color legend row whose box shows the derived label; typing titles the Color legend", () => {
		seed({ source: "rootGroup", connection: true })
		const { container, labels } = mount()
		openLegendTitles(container)

		expect(rowToggle(container, "Color legend")).not.toBeNull()
		const box = [...container.querySelectorAll("textarea")].find(
			(t) => t.value === "Top-level group"
		)
		expect(box).toBeDefined()

		fireEvent.change(box!, { target: { value: "Fruit family" } })
		// The legend's Color section reads `legendTitles.hue` — the same key a
		// field-backed Color legend uses — so this is the write that retitles it.
		expect(labels()?.legendTitles.hue).toBe("Fruit family")
	})

	it("Nesting depth: the box shows that source as its value", () => {
		seed({ source: "depth", connection: true })
		const { container } = mount()
		openLegendTitles(container)

		expect(
			[...container.querySelectorAll("textarea")].some(
				(t) => t.value === "Nesting depth"
			)
		).toBe(true)
	})

	it("omits the Size legend row while the mode hides the Size legend by default, and offers it once the user turns that legend back on", () => {
		seed({ source: "rootGroup", connection: true })
		const first = mount()
		openLegendTitles(first.container)
		// The sunburst's arc sweep IS the size encoding, so its Size legend
		// starts off — a title for a legend that isn't drawn can't show up.
		expect(rowToggle(first.container, "Size legend")).toBeNull()
		cleanup()

		seed({ source: "rootGroup", connection: true, hidden: { area: false } })
		const second = mount()
		openLegendTitles(second.container)
		expect(rowToggle(second.container, "Size legend")).not.toBeNull()
	})

	it("hiding the Color legend under 'Legends shown' drops its title row too", () => {
		seed({ source: "rootGroup", connection: true, hidden: { hue: true } })
		const { container } = mount()
		// Color hidden + Size hidden by default → nothing to title; the whole
		// subsection goes away rather than offering dead rows.
		expect(sectionHeader(container, "Legend titles")).toBeNull()
	})

	it("does not offer a Color row when the derived source has no connection to derive from", () => {
		seed({ source: "rootGroup", connection: false })
		const { container } = mount()
		// Without a parent field there is no tree, so neither the derived Color
		// legend nor (in this non-tree mode) a default-hidden Size legend apply
		// — probe whichever rows exist.
		if (sectionHeader(container, "Legend titles")) openLegendTitles(container)
		expect(rowToggle(container, "Color legend")).toBeNull()
	})
})
