import { render } from "@testing-library/react"
import { TestProvider } from "../../../../testSupport/TestProvider"
import { describe, expect, it } from "vitest"
import {
	DEFAULT_AXIS_CONFIG,
	DEFAULT_REGRESSION_CONFIG,
	type ChannelConfigs,
	type RegressionConfig,
} from "../../lib/channelConfig"
import { DEFAULT_LABELS_CONFIG } from "../../lib/labelsConfig"
import { emptyEncodings, type Dataset, type Encodings } from "../../lib/types"

import { ChartCanvas } from "./ChartCanvas"

/** Regression overlay on a two-quantitative scatter: pooled line, CI band,
 *  per-group fits colored via the regressionStroke slot, and the
 *  stale-config guard (non-quantitative axis → no line). */

const DATASET_ID = "ds-regression-smoke"

const LINE_STROKE = DEFAULT_REGRESSION_CONFIG.color
const BAND_FILL = DEFAULT_REGRESSION_CONFIG.ciFillColor
const PALETTE = ["#e11d48", "#2563eb"]

const buildDataset = (): Dataset => ({
	id: DATASET_ID,
	name: "measurements",
	fields: [
		{ name: "xval", inferredType: "quantitative" },
		{ name: "yval", inferredType: "quantitative" },
		{ name: "region", inferredType: "categorical" },
	],
	versions: [
		{
			id: "v1",
			filename: "measurements.csv",
			rows: [
				// East: y ≈ 2x + 1 with a small deterministic wiggle (so the CI
				// has nonzero width); West: y ≈ -x + 20.
				...Array.from({ length: 10 }, (_, i) => ({
					xval: String(i),
					yval: String(2 * i + 1 + (i % 2 === 0 ? 0.2 : -0.2)),
					region: "East",
				})),
				...Array.from({ length: 10 }, (_, i) => ({
					xval: String(i),
					yval: String(20 - i + (i % 2 === 0 ? 0.2 : -0.2)),
					region: "West",
				})),
			],
			createdAt: 0,
		},
	],
	latestVersionId: "v1",
	createdAt: 0,
})

const installInMemoryLocalStorage = (): Map<string, string> => {
	const store = new Map<string, string>()
	const fakeStorage: Storage = {
		get length() {
			return store.size
		},
		clear: () => store.clear(),
		getItem: (k) => (store.has(k) ? store.get(k)! : null),
		key: (i) => [...store.keys()][i] ?? null,
		removeItem: (k) => {
			store.delete(k)
		},
		setItem: (k, v) => {
			store.set(k, String(v))
		},
	}
	Object.defineProperty(window, "localStorage", {
		value: fakeStorage,
		writable: true,
		configurable: true,
	})
	Object.defineProperty(globalThis, "localStorage", {
		value: fakeStorage,
		writable: true,
		configurable: true,
	})
	return store
}

const seed = (
	encodings: Encodings,
	regression: Partial<RegressionConfig>,
	extraConfigs: Partial<ChannelConfigs> = {}
) => {
	installInMemoryLocalStorage()
	/* eslint-disable no-restricted-globals, @th/no-storage-outside-try, @th/use-wrapped-json-functions */
	const set = (k: string, v: unknown) => localStorage.setItem(k, JSON.stringify(v))
	set("vis-components:datasets", { [DATASET_ID]: buildDataset() })
	set("vis-components:currentDatasetId", DATASET_ID)
	set("vis-components:previewVersionId", null)
	set("vis-components:currentEncodings", encodings)
	set("vis-components:currentChannelConfigs", {
		x: {
			...DEFAULT_AXIS_CONFIG,
			regression: { ...DEFAULT_REGRESSION_CONFIG, enabled: true, ...regression },
		},
		...extraConfigs,
	})
	set("vis-components:currentLabels", { _v: 1, data: DEFAULT_LABELS_CONFIG })
	/* eslint-enable no-restricted-globals, @th/no-storage-outside-try, @th/use-wrapped-json-functions */
}

const mount = () =>
	render(
		<TestProvider>
			<div style={{ width: 800, height: 600 }}>
				<ChartCanvas />
			</div>
		</TestProvider>
	)

const linePaths = (container: HTMLElement, stroke: string): SVGPathElement[] =>
	[...container.querySelectorAll<SVGPathElement>("path")].filter(
		(p) => p.getAttribute("stroke") === stroke && p.getAttribute("fill") === "none"
	)

const bandPaths = (container: HTMLElement): SVGPathElement[] =>
	[...container.querySelectorAll<SVGPathElement>("path")].filter(
		(p) => p.getAttribute("fill") === BAND_FILL && p.getAttribute("stroke") === "none"
	)

const XY: Encodings = {
	...emptyEncodings(),
	x: { field: "xval" },
	y: { field: "yval" },
}

describe("scatter regression overlay", () => {
	it("draws a pooled fitted line over a two-quantitative scatter", () => {
		seed(XY, {})
		const { container } = mount()
		expect(linePaths(container, LINE_STROKE)).toHaveLength(1)
		// No CI requested → no band.
		expect(bandPaths(container)).toHaveLength(0)
	})

	it("draws a confidence band under the line when enabled", () => {
		seed(XY, { showCi: true })
		const { container } = mount()
		expect(linePaths(container, LINE_STROKE)).toHaveLength(1)
		expect(bandPaths(container)).toHaveLength(1)
	})

	it("fits one line per group, colored via the regressionStroke slot", () => {
		seed(
			XY,
			{ perGroup: true, groupField: "region" },
			{
				colorSlots: {
					regressionStroke: {
						field: "region",
						singleColor: "#000000",
						palette: PALETTE,
					},
				},
			}
		)
		const { container } = mount()
		const strokes = new Set(
			PALETTE.flatMap((c) => linePaths(container, c).map(() => c))
		)
		expect(strokes).toEqual(new Set(PALETTE))
	})

	it("inherits per-group line colors from a hue mapped to the group field", () => {
		seed(
			{ ...XY, hue: { field: "region" } },
			{ perGroup: true, groupField: "region" }
		)
		const { container } = mount()
		// Two per-group lines, neither using the single-color fallback (they
		// inherit their group's hue color instead).
		expect(linePaths(container, LINE_STROKE)).toHaveLength(0)
		const inherited = [
			...container.querySelectorAll<SVGPathElement>("path"),
		].filter(
			(p) =>
				p.getAttribute("fill") === "none" &&
				p.getAttribute("stroke") !== null &&
				p.getAttribute("stroke-linejoin") === "round"
		)
		expect(inherited).toHaveLength(2)
		expect(new Set(inherited.map((p) => p.getAttribute("stroke"))).size).toBe(2)
	})

	it("falls back to the pooled line when per-group has no field chosen", () => {
		seed(XY, { perGroup: true, groupField: null })
		const { container } = mount()
		expect(linePaths(container, LINE_STROKE)).toHaveLength(1)
	})

	it("draws nothing when an axis is not quantitative (stale config)", () => {
		seed({ ...emptyEncodings(), x: { field: "region" }, y: { field: "yval" } }, {})
		const { container } = mount()
		expect(linePaths(container, LINE_STROKE)).toHaveLength(0)
	})

	it("applies the shared dash recipe for a picked line style", () => {
		seed(XY, { lineStyle: "dotted" })
		const { container } = mount()
		const [line] = linePaths(container, LINE_STROKE)
		// "dotted" recipe from lib/dashPatterns.ts — panel and renderer agree.
		expect(line?.getAttribute("stroke-dasharray")).toBe("2,3")
	})

	it("custom dasharray wins over the picked line style", () => {
		seed(XY, { lineStyle: "dashed", customDasharray: "2, 2" })
		const { container } = mount()
		const [line] = linePaths(container, LINE_STROKE)
		// Sanitized (space/comma-separated input normalizes to commas).
		expect(line?.getAttribute("stroke-dasharray")).toBe("2,2")
	})

	it("unparseable custom dasharray falls back to the picked style", () => {
		seed(XY, { lineStyle: "dashed", customDasharray: "abc" })
		const { container } = mount()
		const [line] = linePaths(container, LINE_STROKE)
		expect(line?.getAttribute("stroke-dasharray")).toBe("8,4")
	})

	it("'Apply pattern to range' splits the line: solid before From, dashed after", () => {
		seed(XY, {
			lineStyle: "dashed",
			dashRange: { enabled: true, min: "4", max: null },
		})
		const { container } = mount()
		const lines = linePaths(container, LINE_STROKE)
		expect(lines).toHaveLength(2)
		const dashes = lines.map((p) => p.getAttribute("stroke-dasharray"))
		expect(dashes.filter((d) => d === "8,4")).toHaveLength(1)
		expect(dashes.filter((d) => d === null)).toHaveLength(1)
	})

	it("range on a solid line is a no-op (nothing to gate)", () => {
		seed(XY, {
			lineStyle: "solid",
			dashRange: { enabled: true, min: "4", max: null },
		})
		const { container } = mount()
		expect(linePaths(container, LINE_STROKE)).toHaveLength(1)
	})
})
