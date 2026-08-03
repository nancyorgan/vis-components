import { describe, expect, it } from "vitest"

import { PLOT_SVG_ID, serializeEmbedCapture } from "./captureThumbnail"

/** Give an element a concrete layout rect — happy-dom has no layout engine,
 * so `getBoundingClientRect` returns zeros unless stubbed. */
const stubRect = (
	el: Element,
	rect: { left: number; top: number; width: number; height: number }
) => {
	Object.defineProperty(el, "getBoundingClientRect", {
		value: () => ({
			...rect,
			right: rect.left + rect.width,
			bottom: rect.top + rect.height,
			x: rect.left,
			y: rect.top,
			toJSON: () => ({}),
		}),
		configurable: true,
	})
}

describe("serializeEmbedCapture", () => {
	it("emits each facet label exactly once (regression: labels were re-injected on top of the cloned SVG's own <text>)", () => {
		// Facet labels live INSIDE the chart SVG as <g data-facet-label><text>
		// (PlotCanvas). The exporter clones that SVG wholesale, so recreating
		// the labels from a [data-facet-label] query duplicated every one.
		document.body.innerHTML = `
			<div data-export-root>
				<svg id="${PLOT_SVG_ID}" width="400" height="300">
					<g data-facet-label><text x="10" y="10">Group A</text></g>
					<g data-facet-label><text x="10" y="120">Group B</text></g>
				</svg>
			</div>`
		const root = document.querySelector<HTMLElement>("[data-export-root]")!
		stubRect(root, { left: 0, top: 0, width: 400, height: 300 })
		stubRect(root.querySelector(`#${PLOT_SVG_ID}`)!, {
			left: 0,
			top: 0,
			width: 400,
			height: 300,
		})

		const out = serializeEmbedCapture(document)
		expect(out).not.toBeNull()
		expect((out!.match(/Group A/g) ?? []).length).toBe(1)
		expect((out!.match(/Group B/g) ?? []).length).toBe(1)
	})
})
