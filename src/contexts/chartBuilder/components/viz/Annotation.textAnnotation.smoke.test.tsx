import { render } from "@testing-library/react"
import { TestProvider } from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import { describe, expect, it } from "vitest"
import { DEFAULT_AXIS_CONFIG } from "../../lib/channelConfig"
import { DEFAULT_LABELS_CONFIG } from "../../lib/labelsConfig"
import { newTextAnnotation, type TextAnnotation } from "../../lib/annotationsConfig"
import { emptyEncodings, type Dataset } from "../../lib/types"

import { ChartCanvas } from "./ChartCanvas"

/** Free-standing text annotations: a point anchor plus an auto-sized
 *  background box. This exercises the renderer path — that the label and its
 *  box both draw, that the box hugs the text rather than spanning a region,
 *  and that a blank label draws nothing at all (not even the box, since the
 *  box is sized to the text). */

const DATASET_ID = "ds-text-anno"

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "text-anno",
		filename: "anno.csv",
		fields: [
			{ name: "x", inferredType: "quantitative" },
			{ name: "y", inferredType: "quantitative" },
		],
		rows: Array.from({ length: 10 }, (_, i) => ({
			x: String(i),
			y: String(i * 2),
		})),
	})

const seed = (patch: Partial<TextAnnotation>) => {
	installInMemoryLocalStorage()
	/* eslint-disable no-restricted-globals, @th/no-storage-outside-try, @th/use-wrapped-json-functions */
	const set = (k: string, v: unknown) => localStorage.setItem(k, JSON.stringify(v))
	set("vis-components:datasets", { [DATASET_ID]: buildDataset() })
	set("vis-components:currentDatasetId", DATASET_ID)
	set("vis-components:previewVersionId", null)
	set("vis-components:currentEncodings", {
		...emptyEncodings(),
		x: { field: "x" },
		y: { field: "y" },
	})
	set("vis-components:currentChannelConfigs", {
		x: { ...DEFAULT_AXIS_CONFIG },
		y: { ...DEFAULT_AXIS_CONFIG },
	})
	set("vis-components:currentLabels", { _v: 1, data: DEFAULT_LABELS_CONFIG })
	const anno: TextAnnotation = {
		...newTextAnnotation("text-1"),
		text: "Peak demand",
		textColor: "#ff0000",
		textFontSize: 15,
		...patch,
	}
	set("vis-components:currentAnnotations", {
		_v: 4,
		data: { rectangles: [], circles: [], lineSegments: [], texts: [anno] },
	})
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

const boxOf = (container: HTMLElement) =>
	container.querySelector<SVGRectElement>("[data-annotation-text-box='text-1']")

describe("text annotation", () => {
	it("renders the label and a background box sized to the text", () => {
		seed({ textAlign: "center", cornerRadius: 6, textPadding: 8 })
		const { container } = mount()
		const text = container.querySelector<SVGTextElement>(
			"[data-annotation-text='text-1']"
		)
		expect(text).not.toBeNull()
		expect(text!.getAttribute("fill")).toBe("#ff0000")
		expect(text!.getAttribute("font-size")).toBe("20") // 15pt → 20px
		expect(text!.getAttribute("text-anchor")).toBe("middle")

		const rect = boxOf(container)
		expect(rect).not.toBeNull()
		expect(rect!.getAttribute("rx")).toBe("6")
		// The box hugs the text: one 20px line + 8px padding top and bottom.
		expect(Number(rect!.getAttribute("height"))).toBeCloseTo(20 * 1.2 + 16)
		// …and is far narrower than the ~700px plot area a rectangle would span.
		expect(Number(rect!.getAttribute("width"))).toBeLessThan(300)
	})

	it("anchors the box's chosen edge on x and centers it on y", () => {
		seed({ textAlign: "left", x: 0.5, y: 0.5, textPadding: 0 })
		const left = boxOf(mount().container)!
		const leftX = Number(left.getAttribute("x"))
		const midY = Number(left.getAttribute("y")) + Number(left.getAttribute("height")) / 2

		seed({ textAlign: "right", x: 0.5, y: 0.5, textPadding: 0 })
		const right = boxOf(mount().container)!
		const rightEdge =
			Number(right.getAttribute("x")) + Number(right.getAttribute("width"))
		const rightMidY =
			Number(right.getAttribute("y")) + Number(right.getAttribute("height")) / 2

		// Left-aligned STARTS where right-aligned ENDS — both at the same
		// anchor x — and both sit at the same vertical center.
		expect(rightEdge).toBeCloseTo(leftX)
		expect(rightMidY).toBeCloseTo(midY)
	})

	it("grows the box for multi-line text and stacks the lines", () => {
		seed({ text: "Peak\ndemand", textPadding: 8 })
		const { container } = mount()
		const text = container.querySelector<SVGTextElement>(
			"[data-annotation-text='text-1']"
		)
		expect(text!.querySelectorAll("tspan").length).toBe(2)
		expect(Number(boxOf(container)!.getAttribute("height"))).toBeCloseTo(
			2 * 20 * 1.2 + 16
		)
	})

	it("draws nothing — not even the box — when the text is blank", () => {
		seed({ text: "   " })
		const { container } = mount()
		expect(container.querySelector("[data-annotation-text='text-1']")).toBeNull()
		expect(boxOf(container)).toBeNull()
	})
})
