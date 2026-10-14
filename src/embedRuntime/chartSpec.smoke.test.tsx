/** Visuals composed from chart specs, rendered through the real chart
 *  pipeline (the published-embed runtime, which loads them exactly as the
 *  editor does): every Trends chart must draw its bars and data labels
 *  without tripping an error boundary. */

import { render, waitFor } from "@testing-library/react"
import { Provider } from "jotai"
import { afterEach, describe, expect, it } from "vitest"

import { ErrorBoundary } from "../contexts/chartBuilder/components/ErrorBoundary"
import { clearExampleOverlay } from "../contexts/chartBuilder/lib/exampleOverlay"
import {
	composeChartEdit,
	composeVisual,
} from "../contexts/chartBuilder/lib/visualSpec/composeVisual"
import {
	ALL_DATASETS,
	contextFor,
	RATIOS,
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

describe("an edited chart renders", () => {
	it("the step-by-step lollipop draws points, stems and annotations", async () => {
		installInMemoryLocalStorage()
		const ctx = contextFor(ALL_DATASETS, RATIOS.id)
		const created = composeVisual(
			{
				datasetId: RATIOS.id,
				folderId: null,
				encodings: { x: "Ratio", y: "Country", hue: "Country" },
			},
			ctx
		)
		if (!created.ok) throw new Error("did not compose")
		let visual = created.visual
		for (const step of [
			{ sort: { Country: { by: "Ratio", decreasing: true } } },
			{ colorThreshold: { field: "Ratio", at: 1, below: "#ff8a00", above: "#8e81ee" } },
			{ stems: { axis: "x", at: 1 } },
			{
				annotations: [
					{ kind: "line", x: [1, 1], y: ["Colombia", "Greece"] },
					{ kind: "band", x: [0, 1], y: ["Colombia", "Portugal"], color: "#eeeeee" },
				],
			},
		]) {
			const next = composeChartEdit(visual, step, ctx)
			if (!next.ok) throw new Error(next.errors.map((e) => `${e.path}: ${e.message}`).join("; "))
			visual = next.visual
		}
		const store = bootEmbedRuntime({ visual, dataset: RATIOS, theme: THEME, fonts: [] })
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
						<EmbedRoot part="full" visualId={visual.id} />
					</div>
				</Provider>
			</ErrorBoundary>
		)
		await waitFor(() => {
			expect(container.querySelectorAll("path, circle").length).toBeGreaterThanOrEqual(18)
		})
		// Stems: horizontal lines that start or end at x = 1, where the
		// spine annotation sits.
		const spine = container.querySelector("line[data-annotation-line]")
		expect(spine).not.toBeNull()
		const at = spine?.getAttribute("x1")
		const stems = [...container.querySelectorAll("line:not([data-annotation-line])")].filter(
			(l) =>
				l.getAttribute("y1") === l.getAttribute("y2") &&
				l.getAttribute("x1") !== l.getAttribute("x2") &&
				(l.getAttribute("x1") === at || l.getAttribute("x2") === at)
		)
		expect(stems.length).toBeGreaterThanOrEqual(18)
		expect(caught).toEqual([])
		expect(container.querySelector('[data-testid="crashed"]')).toBeNull()
		const fills = [...container.querySelectorAll("[fill]")].map((e) => e.getAttribute("fill")?.toLowerCase())
		expect(fills).toContain("#ff8a00")
		expect(fills).toContain("#8e81ee")
		expect(fills).toContain("#eeeeee")
	})
})
