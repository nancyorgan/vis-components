import { cleanup, fireEvent, render, within } from "@testing-library/react"
import { TestProvider, type TestStore } from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import { afterEach, describe, expect, it } from "vitest"
import { emptyEncodings, type Dataset } from "../../lib/types"
import { currentLegendConfigAtom } from "../../store/atoms"

import { LegendPanel } from "./LegendPanel"

/** In the tree modes (sunburst / treemap / packed circles) Fill color can
 *  vary by the DERIVED "Top-level group" / "Nesting depth" source, which has
 *  no backing field. The legend renders a Color section for it, so the
 *  "Legends shown" group must offer the Color toggle — otherwise there is no
 *  way to turn that legend off (or back on). */

const DATASET_ID = "ds-legendpanel-derived-hue"

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

const seed = (opts: { source: "rootGroup" | "depth" | null; connection: boolean }) => {
	const store = installInMemoryLocalStorage()
	/* eslint-disable @th/use-wrapped-json-functions */
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
	/* eslint-enable @th/use-wrapped-json-functions */
}

afterEach(cleanup)

const mount = () => {
	let snap: TestStore | null = null
	const utils = render(
		<TestProvider initializeState={(s) => (snap = s)}>
			<LegendPanel />
		</TestProvider>
	)
	const cfg = () => (snap as TestStore | null)?.get(currentLegendConfigAtom)
	return { ...utils, cfg }
}

const openShown = (container: HTMLElement) => {
	// Subsections start collapsed.
	fireEvent.click(within(container).getByText("Legends shown"))
}

describe("LegendPanel — hierarchy-derived Color (Top-level group / Nesting depth)", () => {
	it("offers the Color toggle for a sunburst colored by Top-level group, checked by default", () => {
		seed({ source: "rootGroup", connection: true })
		const { container, getByLabelText } = mount()
		openShown(container)
		const color = getByLabelText("Color") as HTMLInputElement
		expect(color.checked).toBe(true)
	})

	it("unchecking Color hides the derived legend; re-checking drops the key (back to the default)", () => {
		seed({ source: "depth", connection: true })
		const { container, getByLabelText, cfg } = mount()
		openShown(container)
		const color = getByLabelText("Color") as HTMLInputElement
		fireEvent.click(color)
		expect(cfg()?.hidden.hue).toBe(true)
		fireEvent.click(getByLabelText("Color"))
		expect(cfg()?.hidden.hue).toBeUndefined()
	})

	it("does not offer Color when the derived source has no connection to derive from", () => {
		seed({ source: "rootGroup", connection: false })
		const { container } = mount()
		// Size is still mapped, so the group renders — but Color is absent.
		if (within(container).queryByText("Legends shown")) openShown(container)
		expect(within(container).queryByLabelText("Color")).toBeNull()
	})

	it("does not offer Color when Fill color is unmapped", () => {
		seed({ source: null, connection: true })
		const { container } = mount()
		openShown(container)
		expect(within(container).queryByLabelText("Color")).toBeNull()
	})
})
