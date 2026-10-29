/** Visuals composed from chart specs, rendered through the published-embed
 *  runtime, which loads them exactly as the editor does: each must draw
 *  its marks without tripping an error boundary. */

import { render, waitFor } from "@testing-library/react"
import { Provider } from "jotai"
import { afterEach, describe, expect, it } from "vitest"

import { ErrorBoundary } from "../contexts/chartBuilder/components/ErrorBoundary"
import { clearExampleOverlay } from "../contexts/chartBuilder/lib/exampleOverlay"
import type { Dataset } from "../contexts/chartBuilder/lib/types"
import { composeChartSpec } from "../contexts/chartBuilder/lib/visualSpec/composeVisual"
import { CAFE, contextFor, DATES, THEME } from "../testSupport/chartSpecFixtures"
import { installInMemoryLocalStorage } from "../testSupport/localStorageShim"
import { bootEmbedRuntime } from "./boot"
import { EmbedRoot } from "./EmbedRoot"

const mount = (dataset: Dataset, spec: Record<string, unknown>) => {
	const result = composeChartSpec(
		{ datasetId: dataset.id, folderId: null, ...spec },
		contextFor([dataset], dataset.id)
	)
	if (!result.ok) throw new Error(result.errors.map((e) => `${e.path}: ${e.message}`).join("; "))
	const store = bootEmbedRuntime({ visual: result.visual, dataset, theme: THEME, fonts: [] })
	const caught: Error[] = []
	const { container } = render(
		<ErrorBoundary
			fallback={(error) => {
				caught.push(error)
				return <div data-testid="crashed" />
			}}
		>
			<Provider store={store}>
				<div style={{ width: 800, height: 600 }}>
					<EmbedRoot part="full" visualId={result.visual.id} />
				</div>
			</Provider>
		</ErrorBoundary>
	)
	return { container, caught }
}

afterEach(() => {
	clearExampleOverlay()
})

describe("chart-spec visuals render", () => {
	it("a stacked bar chart draws one bar segment per row", async () => {
		installInMemoryLocalStorage()
		const { container, caught } = mount(CAFE, {
			family: "bar",
			encodings: { x: "month", length: "muffins", hue: "flavor" },
			stack: "stack",
			title: "Muffins",
		})
		// Mark rects carry a stroke (outline); background rects don't.
		await waitFor(() => {
			const marks = [...container.querySelectorAll("rect")].filter((r) => r.getAttribute("stroke") !== null)
			expect(marks).toHaveLength(9)
		})
		expect(caught).toEqual([])
		expect(container.textContent).toContain("Muffins")
	})

	it("a dated scatter with axis bounds draws its points", async () => {
		installInMemoryLocalStorage()
		const { container, caught } = mount(DATES, {
			encodings: { x: "day", y: "n" },
			axes: { x: { min: "2026-01-01", max: "2026-01-05" }, y: { min: 0 } },
		})
		await waitFor(() => {
			expect(container.querySelectorAll("path").length).toBeGreaterThanOrEqual(3)
		})
		expect(caught).toEqual([])
		expect(container.querySelector('[data-testid="crashed"]')).toBeNull()
	})
})
