import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { newImageAnnotation } from "../../../lib/annotationsConfig"
import { AnnotationRects } from "./annotations"

/** The image annotation paints as an SVG `<image>` with both href forms,
 *  sized by the layout, exposed to assistive tech only when described. */

const inner = { x: 100, y: 50, width: 400, height: 200 }
const PNG = "data:image/png;base64,iVBORw0KGgo="

const mount = (over: Partial<ReturnType<typeof newImageAnnotation>>) =>
	render(
		<svg>
			<AnnotationRects
				rectangles={[]}
				circles={[]}
				lineSegments={[]}
				texts={[]}
				images={[
					{ ...newImageAnnotation("m1"), href: PNG, aspect: 2, naturalWidth: 400, width: 100, ...over },
				]}
				inner={inner}
				layer="front"
				xScaleRows={[]}
				yScaleRows={[]}
				axisFields={{ xField: null, yField: null, xType: null, yType: null }}
				levelOrders={{}}
			/>
		</svg>
	)

afterEach(cleanup)

describe("AnnotationRects — image", () => {
	it("draws the picture centered on its anchor with both href attributes", () => {
		const { container } = mount({})
		const img = container.querySelector("image[data-annotation-image='m1']")
		expect(img).not.toBeNull()
		expect(img!.getAttribute("href")).toBe(PNG)
		expect(img!.getAttribute("xlink:href")).toBe(PNG)
		// 100 × 50 centered on the plot center (300, 150).
		expect(img!.getAttribute("x")).toBe("250")
		expect(img!.getAttribute("y")).toBe("125")
		expect(img!.getAttribute("width")).toBe("100")
		expect(img!.getAttribute("height")).toBe("50")
		// Undescribed = decorative.
		expect(img!.getAttribute("aria-hidden")).toBe("true")
		expect(img!.getAttribute("role")).toBeNull()
	})

	it("exposes a described picture as an img and applies opacity", () => {
		const { container } = mount({ alt: "Company logo", opacity: 0.4 })
		const img = container.querySelector("image[data-annotation-image='m1']")!
		expect(img.getAttribute("role")).toBe("img")
		expect(img.getAttribute("aria-label")).toBe("Company logo")
		expect(img.getAttribute("aria-hidden")).toBeNull()
		expect(img.getAttribute("opacity")).toBe("0.4")
	})

	it("stays on its own layer", () => {
		const { container } = mount({ zOrder: "behind" })
		expect(container.querySelector("image")).toBeNull()
	})
})
