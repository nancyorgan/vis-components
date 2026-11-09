import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { createStore, Provider } from "jotai"
import { afterEach, describe, expect, it, vi } from "vitest"

import { newImageAnnotation, type ImageAnnotation } from "../../../lib/annotationsConfig"
import type { AxisInfo } from "./axisInfo"
import { ImageAnnotationEditor } from "./ImageAnnotationEditor"

/** The image annotation editor's layout: the picker sits at the top of the
 *  body OUTSIDE any subsection (the picture is the annotation), the Image
 *  subsection holds description / width / opacity, and the anchor picker
 *  lives inside Position. */

const AXIS: AxisInfo = {
	field: "val",
	type: "quantitative",
	categories: null,
	dataMin: 0,
	dataMax: 100,
}
const PNG = "data:image/png;base64,iVBORw0KGgo="

const mount = (onChange = vi.fn(), over: Partial<ImageAnnotation> = {}) => {
	render(
		<Provider store={createStore()}>
			<ImageAnnotationEditor
				anno={{ ...newImageAnnotation("m1"), name: "Image 1", ...over }}
				onChange={onChange}
				onRemove={() => {}}
				open
				onToggle={() => {}}
				xAxis={AXIS}
				yAxis={AXIS}
				fallbackName="Image 1"
			/>
		</Provider>
	)
	return onChange
}

afterEach(cleanup)

describe("ImageAnnotationEditor layout", () => {
	it("offers the file picker without opening any subsection, and no preview before a pick", () => {
		mount()
		for (const title of ["Image", "Position"]) {
			expect(
				screen.getByRole("button", { name: title }).getAttribute("aria-expanded")
			).toBe("false")
		}
		expect(screen.getByRole("button", { name: "Choose image…" })).toBeTruthy()
		const input = screen.getByLabelText<HTMLInputElement>("Choose image")
		expect(input.type).toBe("file")
		expect(input.accept).toBe("image/*")
		expect(screen.queryByAltText("Chosen image")).toBeNull()
	})

	it("previews the chosen picture and relabels the button to Replace", () => {
		mount(vi.fn(), { href: PNG, alt: "Company logo" })
		expect(screen.getByRole("button", { name: "Replace image…" })).toBeTruthy()
		expect(screen.getByAltText<HTMLImageElement>("Company logo").src).toBe(PNG)
	})

	it("writes the description and opacity from the Image subsection", () => {
		const onChange = mount(vi.fn(), { href: PNG })
		fireEvent.click(screen.getByRole("button", { name: "Image" }))
		fireEvent.change(screen.getByLabelText("Description"), {
			target: { value: "Logo" },
		})
		expect(onChange).toHaveBeenCalledWith({ alt: "Logo" })
		fireEvent.change(screen.getByLabelText("Opacity"), { target: { value: "0.5" } })
		expect(onChange).toHaveBeenCalledWith({ opacity: 0.5 })
	})

	/** A 400 × 200 picture (aspect 2) shown at 100 × 50 px. */
	const PIC = { href: PNG, aspect: 2, naturalWidth: 400, width: 100, height: 50 } as const

	it("with the ratio locked, editing width recomputes height and vice versa", () => {
		const onChange = mount(vi.fn(), PIC)
		fireEvent.click(screen.getByRole("button", { name: "Image" }))
		expect(screen.getByLabelText<HTMLInputElement>("Height").value).toBe("50")
		fireEvent.change(screen.getByLabelText("Width"), { target: { value: "240" } })
		expect(onChange).toHaveBeenCalledWith({ width: 240, height: 120 })
		fireEvent.change(screen.getByLabelText("Height"), { target: { value: "20" } })
		expect(onChange).toHaveBeenCalledWith({ height: 20, width: 40 })
	})

	it("unlocked, width and height are independent", () => {
		const onChange = mount(vi.fn(), { ...PIC, lockAspect: false, height: 80 })
		fireEvent.click(screen.getByRole("button", { name: "Image" }))
		expect(screen.getByLabelText<HTMLInputElement>("Height").value).toBe("80")
		fireEvent.change(screen.getByLabelText("Width"), { target: { value: "240" } })
		expect(onChange).toHaveBeenCalledWith({ width: 240 })
		fireEvent.click(screen.getByRole("checkbox", { name: "Lock aspect ratio" }))
		// Re-locking snaps the height back to the width's proportion.
		expect(onChange).toHaveBeenCalledWith({ lockAspect: true, height: 50 })
	})

	it("switching the unit converts both numbers so the on-screen size holds", () => {
		const onChange = mount(vi.fn(), PIC)
		fireEvent.click(screen.getByRole("button", { name: "Image" }))
		fireEvent.click(screen.getByRole("radio", { name: "in" }))
		// 100 px = 1.04 in, 50 px = 0.52 in at 96 dpi.
		expect(onChange).toHaveBeenCalledWith({ sizeUnit: "in", width: 1.04, height: 0.52 })
		fireEvent.click(screen.getByRole("radio", { name: "% of image" }))
		expect(onChange).toHaveBeenCalledWith({ sizeUnit: "percent", width: 25, height: 25 })
	})

	it("offers a natural-size link only while the picture is scaled", () => {
		const onChange = mount(vi.fn(), PIC)
		fireEvent.click(screen.getByRole("button", { name: "Image" }))
		fireEvent.click(screen.getByRole("button", { name: "natural size" }))
		expect(onChange).toHaveBeenCalledWith({ width: 400, height: 200 })
		cleanup()
		mount(vi.fn(), { ...PIC, width: 400, height: 200 })
		fireEvent.click(screen.getByRole("button", { name: "Image" }))
		expect(screen.queryByRole("button", { name: "natural size" })).toBeNull()
	})

	it("picks the anchor inside Position", () => {
		const onChange = mount(vi.fn(), { href: PNG })
		fireEvent.click(screen.getByRole("button", { name: "Position" }))
		fireEvent.click(screen.getByRole("radio", { name: "Right" }))
		expect(onChange).toHaveBeenCalledWith({ anchorH: "right" })
		fireEvent.click(screen.getByRole("radio", { name: "Bottom" }))
		expect(onChange).toHaveBeenCalledWith({ anchorV: "bottom" })
	})
})
