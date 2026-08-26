import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { PLOT_SVG_ID } from "../../lib/captureThumbnail"
import {
	currentDatasetIdAtom,
	datasetLoadStatesAtom,
} from "../../store/atoms"
import { TestProvider, type TestStore } from "../../../../testSupport/TestProvider"
import { ChartBody } from "./ChartCanvas"

const mount = (seed: (store: TestStore) => void) =>
	render(
		<TestProvider initializeState={seed}>
			<ChartBody />
		</TestProvider>
	)

describe("ChartBody — dataset load states", () => {
	it("says the rows are loading rather than inviting an upload", () => {
		const { container } = mount((s) => {
			s.set(currentDatasetIdAtom, "ds-1")
			s.set(datasetLoadStatesAtom, { "ds-1": "loading" })
		})
		expect(container.textContent).toContain("Loading data")
		expect(container.textContent).not.toContain("Upload a CSV")
	})

	// The constraint that makes this a correctness matter rather than a
	// nicety: `chartLayoutReady` accepts any non-zero-sized #PLOT_SVG_ID as a
	// finished chart, so mounting one while rows are still in flight would let
	// the thumbnail pipeline capture it as stable and store a blank preview.
	it("mounts no plot SVG while rows are in flight", () => {
		const { container } = mount((s) => {
			s.set(currentDatasetIdAtom, "ds-1")
			s.set(datasetLoadStatesAtom, { "ds-1": "loading" })
		})
		expect(container.querySelector(`#${PLOT_SVG_ID}`)).toBeNull()
	})

	it("distinguishes a dataset that could not be loaded at all", () => {
		const { container } = mount((s) => {
			s.set(currentDatasetIdAtom, "ds-gone")
			s.set(datasetLoadStatesAtom, { "ds-gone": "missing" })
		})
		expect(container.textContent).toContain("could not be loaded")
	})

	it("still invites an upload when no dataset is bound at all", () => {
		const { container } = mount((s) => {
			s.set(currentDatasetIdAtom, null)
		})
		expect(container.textContent).toContain("Upload a CSV")
	})
})
