import { render } from "@testing-library/react"
import { TestProvider } from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import { describe, expect, it } from "vitest"
import { DEFAULT_AXIS_CONFIG } from "../../lib/channelConfig"
import { DEFAULT_LABELS_CONFIG } from "../../lib/labelsConfig"
import { newRectangle } from "../../lib/annotationsConfig"
import { emptyEncodings, type Dataset } from "../../lib/types"

import { ChartCanvas } from "./ChartCanvas"

/** Rectangle annotations can carry a text label drawn inside the box. This
 *  exercises the renderer path: a rectangle with text yields a `<text>`
 *  element tagged `data-annotation-text` whose styling follows the rectangle's
 *  text fields, and a rectangle WITHOUT text draws no such element. */

const DATASET_ID = "ds-anno-text"

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "anno-text",
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

const seed = (withText: boolean) => {
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
	const rect = {
		...newRectangle("rect-1"),
		zOrder: "front" as const,
		text: withText ? "Hello\nWorld" : "",
		textColor: "#ff0000",
		textFontSize: 15,
		textAlign: "right" as const,
	}
	set("vis-components:currentAnnotations", {
		_v: 3,
		data: { rectangles: [rect], circles: [], lineSegments: [] },
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

describe("rectangle annotation text", () => {
	it("renders the label inside the rectangle with its text styling", () => {
		seed(true)
		const { container } = mount()
		const text = container.querySelector<SVGTextElement>(
			"[data-annotation-text='rect-1']"
		)
		expect(text).not.toBeNull()
		expect(text!.getAttribute("fill")).toBe("#ff0000")
		expect(text!.getAttribute("font-size")).toBe("20") // 15pt → 20px
		// "right" align maps to an end text-anchor.
		expect(text!.getAttribute("text-anchor")).toBe("end")
		// Two lines from the literal `\n` → two tspans.
		expect(text!.querySelectorAll("tspan").length).toBe(2)
	})

	it("draws no text element when the rectangle has no text", () => {
		seed(false)
		const { container } = mount()
		expect(
			container.querySelector("[data-annotation-text='rect-1']")
		).toBeNull()
		// The rectangle itself still renders.
		expect(container.querySelector("[data-annotation='rect-1']")).not.toBeNull()
	})
})
