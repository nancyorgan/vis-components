/** Visuals composed from chart specs, rendered through the real chart
 *  pipeline (the published-embed runtime, which loads them exactly as the
 *  editor does): every Trends chart must draw its bars and data labels
 *  without tripping an error boundary. */

import { render, waitFor } from "@testing-library/react"
import { Provider } from "jotai"
import { afterEach, describe, expect, it } from "vitest"

import { ErrorBoundary } from "../contexts/chartBuilder/components/ErrorBoundary"
import { clearExampleOverlay } from "../contexts/chartBuilder/lib/exampleOverlay"
import { composeVisual } from "../contexts/chartBuilder/lib/visualSpec/composeVisual"
import {
	ALL_DATASETS,
	contextFor,
	THEME,
	TRENDS,
	type TrendsFixture,
} from "../testSupport/chartSpecFixtures"
import { installInMemoryLocalStorage } from "../testSupport/localStorageShim"
import { bootEmbedRuntime } from "./boot"
import { EmbedRoot } from "./EmbedRoot"

const mount = (t: TrendsFixture, caught: Error[]) => {
	const result = composeVisual(t.spec, contextFor(ALL_DATASETS, t.spec.datasetId))
	if (!result.ok) throw new Error(`${t.key} did not compose`)
	const store = bootEmbedRuntime({
		visual: result.visual,
		dataset: t.dataset,
		theme: THEME,
		fonts: [],
	})
	return render(
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
}

/** Mark rects carry a stroke (outline); background rects don't. */
const markRects = (container: HTMLElement) =>
	[...container.querySelectorAll("rect")].filter(
		(r) => r.getAttribute("stroke") !== null
	)

const labelTexts = (container: HTMLElement) =>
	[
		...container.querySelectorAll('g[aria-hidden="true"][pointer-events="none"]'),
	].flatMap((g) => [...g.querySelectorAll("text")])

afterEach(() => {
	clearExampleOverlay()
})

describe("chart-spec visuals render", () => {
	it.each(TRENDS.map((t) => [t.key, t] as const))(
		"%s draws its bars and labels",
		async (_key, t) => {
			installInMemoryLocalStorage()
			const caught: Error[] = []
			const { container } = mount(t, caught)
			await waitFor(() => {
				expect(markRects(container).length).toBe(t.bars)
			})
			expect(caught).toEqual([])
			expect(container.querySelector('[data-testid="crashed"]')).toBeNull()
			expect(labelTexts(container).length).toBeGreaterThan(0)
		}
	)
})
