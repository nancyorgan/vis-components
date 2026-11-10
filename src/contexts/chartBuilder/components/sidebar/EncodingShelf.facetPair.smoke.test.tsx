import { cleanup, fireEvent, render, within } from "@testing-library/react"
import { TestProvider } from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import { afterEach, describe, expect, it } from "vitest"
import { useAtomValue } from "jotai"
import { emptyEncodings, type Dataset, type Encodings } from "../../lib/types"
import { currentEncodingsAtom, facetPairOpenAtom } from "../../store/atoms"

import { EncodingShelf } from "./EncodingShelf"

/** The Facet row is ONE encoding over three stored channels. A field maps
 *  the wrap channel; "Two variables…" opens the row's options panel, whose
 *  first block is the Row / Column pickers over facetRow /
 *  facetCol; the wrap channel and the pair never coexist. */

const DATASET_ID = "ds-facet-pair"

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "sales",
		filename: "sales.csv",
		fields: [
			{ name: "amount", inferredType: "quantitative" },
			{ name: "region", inferredType: "categorical" },
			{ name: "year", inferredType: "ordinal" },
		],
		rows: Array.from({ length: 8 }, (_, i) => ({
			amount: String(i + 1),
			region: i % 2 === 0 ? "East" : "West",
			year: i % 4 < 2 ? "2024" : "2025",
		})),
	})

const seed = (encodings: Partial<Encodings> = {}) => {
	const store = installInMemoryLocalStorage()
	/* eslint-disable @vc/use-wrapped-json-functions */
	store.set("vis-components:datasets", JSON.stringify({ [DATASET_ID]: buildDataset() }))
	store.set("vis-components:currentDatasetId", JSON.stringify(DATASET_ID))
	store.set("vis-components:previewVersionId", JSON.stringify(null))
	store.set(
		"vis-components:currentEncodings",
		JSON.stringify({ ...emptyEncodings(), ...encodings })
	)
	/* eslint-enable @vc/use-wrapped-json-functions */
}

const Probe = () => {
	const enc = useAtomValue(currentEncodingsAtom)
	const pairOpen = useAtomValue(facetPairOpenAtom)
	return (
		<>
			<div data-testid="enc">
				{[enc.facet?.field ?? "", enc.facetRow?.field ?? "", enc.facetCol?.field ?? ""].join(
					"/"
				)}
			</div>
			<div data-testid="pair-open">{String(pairOpen)}</div>
		</>
	)
}

const mount = () =>
	render(
		<TestProvider>
			<EncodingShelf channel="facet" />
			<Probe />
		</TestProvider>
	)

afterEach(cleanup)

/** "facet/facetRow/facetCol" fields as the store holds them. */
const stored = (container: HTMLElement) =>
	within(container).getByTestId("enc").textContent

describe("EncodingShelf — the Facet row", () => {
	it("lists the discrete fields plus Two variables…, and a field maps the wrap channel", () => {
		seed()
		const { container } = mount()
		const select = within(container).getByLabelText("Facet") as HTMLSelectElement
		const labels = Array.from(select.options).map((o) => o.textContent)
		expect(labels).toEqual(["— none —", "region", "year", "Two variables…"])
		fireEvent.change(select, { target: { value: "region" } })
		expect(stored(container)).toBe("region//")
	})

	it("Two variables… moves the mapped variable to Rows, keeps the dropdown on it, and opens the options panel", () => {
		seed({ facet: { field: "region" } })
		const { container } = mount()
		const select = within(container).getByLabelText("Facet") as HTMLSelectElement
		fireEvent.change(select, { target: { value: "__facet_pair__" } })
		expect(stored(container)).toBe("/region/")
		expect(select.value).toBe("__facet_pair__")
		// The pickers are the panel's first block — the row opens the panel
		// (the jump-target path a sidebar link takes), and they show inside it.
		expect(
			within(container)
				.getByRole("button", { name: "Toggle options for Facet" })
				.getAttribute("aria-expanded"),
		).toBe("true")
		expect(within(container).getByLabelText("Row")).toBeTruthy()
	})

	it("Two variables… with nothing mapped stays selected until a side is picked", () => {
		seed()
		const { container } = mount()
		const select = within(container).getByLabelText("Facet") as HTMLSelectElement
		fireEvent.change(select, { target: { value: "__facet_pair__" } })
		expect(stored(container)).toBe("//")
		expect(select.value).toBe("__facet_pair__")
		expect(within(container).getByTestId("pair-open").textContent).toBe("true")
		const rows = within(container).getByLabelText("Row") as HTMLSelectElement
		fireEvent.change(rows, { target: { value: "year" } })
		expect(stored(container)).toBe("/year/")
		expect(select.value).toBe("__facet_pair__")
	})

	it("a saved pair opens in two-variable mode", () => {
		seed({ facetRow: { field: "region" }, facetCol: { field: "year" } })
		const { container } = mount()
		const select = within(container).getByLabelText("Facet") as HTMLSelectElement
		expect(select.value).toBe("__facet_pair__")
	})

	it("picking a field from the Facet dropdown leaves the pair and clears both sides", () => {
		seed({ facetRow: { field: "region" }, facetCol: { field: "year" } })
		const { container } = mount()
		const select = within(container).getByLabelText("Facet") as HTMLSelectElement
		fireEvent.change(select, { target: { value: "year" } })
		expect(stored(container)).toBe("year//")
		expect(within(container).getByTestId("pair-open").textContent).toBe("false")
		// The row never dims as "shadowed": the pair is its own, not a rival.
		expect(within(container).getByLabelText("Facet").closest("[title]")).toBeNull()
	})
})
