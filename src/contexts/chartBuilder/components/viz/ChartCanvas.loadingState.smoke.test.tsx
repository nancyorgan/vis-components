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
	// A dataset is bound but no rows have arrived and no terminal state has
	// been recorded: that is the in-flight window.
	it("shows the loading indicator, CSS-delayed so a fast load never flashes it", () => {
		const { container } = mount((s) => {
			s.set(currentDatasetIdAtom, "ds-1")
		})
		const indicator = container.querySelector("[data-dataset-loading]")
		expect(indicator).not.toBeNull()
		// The delay lives in CSS (starts at opacity 0, revealed by a 500ms
		// animation), so the element is present but initially invisible.
		expect(indicator?.className).toContain("opacity-0")
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
		})
		expect(container.querySelector(`#${PLOT_SVG_ID}`)).toBeNull()
	})

	it("distinguishes a dataset that is not in the store", () => {
		const { container } = mount((s) => {
			s.set(currentDatasetIdAtom, "ds-gone")
			s.set(datasetLoadStatesAtom, { "ds-gone": "missing" })
		})
		expect(container.textContent).toContain("could not be loaded")
	})

	it("distinguishes a read that failed and may work on retry", () => {
		const { container } = mount((s) => {
			s.set(currentDatasetIdAtom, "ds-1")
			s.set(datasetLoadStatesAtom, { "ds-1": "error" })
		})
		expect(container.textContent).toContain("Couldn't load")
		expect(container.textContent).not.toContain("deleted")
	})

	it("still invites an upload when no dataset is bound at all", () => {
		const { container } = mount((s) => {
			s.set(currentDatasetIdAtom, null)
		})
		expect(container.textContent).toContain("Upload a CSV")
	})
})
