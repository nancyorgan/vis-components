import { render } from "@testing-library/react"
import { rgb as d3Rgb } from "d3-color"
import { TestProvider } from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import { describe, expect, it } from "vitest"
import { DEFAULT_AXIS_CONFIG } from "../../lib/channelConfig"
import { DEFAULT_LABELS_CONFIG } from "../../lib/labelsConfig"
import { emptyEncodings, type Dataset } from "../../lib/types"

import { ChartCanvas } from "./ChartCanvas"

/** FACETED histogram with Fill color by Count: every panel's bars and the
 *  single legend gradient must share ONE global [0, max] domain, where max is
 *  the largest PER-PANEL bin (the tallest bar actually drawn) — never the
 *  pooled full-dataset count, and never a panel-local max. Historically the
 *  bars colored over each panel's own [0, panelMax] while the legend ramp
 *  spanned the pooled count, so equal colors meant different counts across
 *  panels and no bar matched its spot on the ramp. */

const DATASET_ID = "ds-bar-hist-measure-facet"

/** Two panels over the same 0–20 range; two bins (0–10 / 10–20):
 *    panel A: scores 1..5 and 15,16,17     → counts [5, 3] (its max: 5)
 *    panel B: scores 1..4 and 11..16       → counts [4, 6] (its max: 6)
 *  Pooled counts are [9, 9]; the shared color domain must be [0, 6]. */
const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "scores",
		filename: "scores.csv",
		fields: [
			{ name: "score", inferredType: "quantitative" },
			{ name: "panel", inferredType: "categorical" },
		],
		rows: [
			...[1, 2, 3, 4, 5, 15, 16, 17].map((v) => ({
				score: String(v),
				panel: "A",
			})),
			...[1, 2, 3, 4, 11, 12, 13, 14, 15, 16].map((v) => ({
				score: String(v),
				panel: "B",
			})),
		],
	})

/** White→black linear gradient so a higher count maps to a darker color. */
const WHITE_BLACK_HUE = {
	kind: "quantitative",
	palette: "customLinear",
	lowColor: "#ffffff",
	highColor: "#000000",
	midColor: null,
	lowValue: null,
	midValue: null,
	highValue: null,
}

const seed = () => {
	const store = installInMemoryLocalStorage()
	/* eslint-disable @th/use-wrapped-json-functions */
	store.set(
		"vis-components:datasets",
		JSON.stringify({ [DATASET_ID]: buildDataset() })
	)
	store.set("vis-components:currentDatasetId", JSON.stringify(DATASET_ID))
	store.set("vis-components:previewVersionId", JSON.stringify(null))
	store.set(
		"vis-components:currentEncodings",
		JSON.stringify({
			...emptyEncodings(),
			x: { field: "score" },
			hue: { field: null, measureSource: "count" },
			facet: { field: "panel" },
		})
	)
	store.set(
		"vis-components:currentChannelConfigs",
		JSON.stringify({
			x: {
				...DEFAULT_AXIS_CONFIG,
				histogram: { enabled: true, binCount: 2, mode: "count" },
			},
			hue: WHITE_BLACK_HUE,
			// Independent measure axes: the OLD behavior colored each panel
			// over its own [0, panelMax], making panel A's 5-count bin as
			// black as panel B's 6-count bin — exactly what must not happen.
			facet: { shareX: "none", shareY: "none" },
		})
	)
	store.set(
		"vis-components:currentLabels",
		JSON.stringify({ _v: 1, data: DEFAULT_LABELS_CONFIG })
	)
	/* eslint-enable @th/use-wrapped-json-functions */
}

const mount = () =>
	render(
		<TestProvider>
			<div style={{ width: 800, height: 600 }}>
				<ChartCanvas />
			</div>
		</TestProvider>
	)

/** Mark-rect fills (stroked rects are the bars; legend swatches are HTML). */
const markFills = (container: HTMLElement) =>
	[...container.querySelectorAll("rect")]
		.filter((r) => r.getAttribute("stroke") !== null)
		.map((r) => r.getAttribute("fill") ?? "")

/** Perceived lightness (0 = black, 255 = white) of a CSS color string. */
const lightness = (color: string): number => {
	const c = d3Rgb(color)
	return (c.r + c.g + c.b) / 3
}

describe("BarPlot — faceted histogram Fill color by Count", () => {
	it("bars in every panel share one global color domain topping out at the tallest bar anywhere", () => {
		seed()
		const fills = markFills(mount().container)
		expect(fills).toHaveLength(4)

		// On the shared white→black [0, 6] ramp the four bins (counts 6, 5,
		// 4, 3 across the two panels) map to lightness 255·(1 − count/6):
		// exactly one black bar (the global-max bin) and three distinct
		// lighter ones. Under the old per-panel domains each panel's own max
		// bin went full black (two black bars: A's 5-count AND B's 6-count)
		// and A's 3-count landed at 255·(1 − 3/5) = 102 instead of 127.5.
		const got = fills.map(lightness).sort((a, b) => a - b)
		const want = [0, 255 * (1 - 5 / 6), 255 * (1 - 4 / 6), 255 * (1 - 3 / 6)]
		// ±1.5: sRGB channels round to integers (42.5 → 43).
		want.forEach((w, i) => expect(Math.abs(got[i]! - w)).toBeLessThan(1.5))
	})

	it("legend ramp spans the same global [0, 6] — not the pooled full-dataset count (9)", () => {
		seed()
		const { container } = mount()
		const spans = [...container.querySelectorAll("span")].map(
			(s) => s.textContent
		)
		// Largest per-panel bin (panel B's 6) is the ramp's high break…
		expect(spans).toContain("6.00")
		// …and the pooled bin count (9 = 5+4 or 3+6) must NOT be.
		expect(spans).not.toContain("9.00")
	})
})
