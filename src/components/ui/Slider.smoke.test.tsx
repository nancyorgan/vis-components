import { cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { Slider } from "./Slider"

/** One control for every bounded value: a slider to drag, and the number
 *  beside it in a box that can be typed into. */
describe("Slider", () => {
	afterEach(cleanup)

	const mount = (props: Partial<React.ComponentProps<typeof Slider>> = {}) => {
		const onChange = vi.fn()
		const utils = render(
			<Slider label="Opacity" value={0.4} min={0} max={1} step={0.05} onChange={onChange} {...props} />
		)
		return {
			onChange,
			range: utils.getByLabelText("Opacity") as HTMLInputElement,
			box: utils.getByLabelText("Opacity value") as HTMLInputElement,
			...utils,
		}
	}

	it("the label names the slider; the box beside it shows the value", () => {
		const { range, box } = mount()
		expect(range.type).toBe("range")
		expect(range.value).toBe("0.4")
		expect(box.value).toBe("0.4")
	})

	it("dragging the slider reports the new value", () => {
		const { range, onChange } = mount()
		fireEvent.change(range, { target: { value: "0.75" } })
		expect(onChange).toHaveBeenCalledWith(0.75)
	})

	it("typing in the box reports the new value, held to the range", () => {
		const { box, onChange } = mount()
		fireEvent.change(box, { target: { value: "0.9" } })
		expect(onChange).toHaveBeenLastCalledWith(0.9)
		fireEvent.change(box, { target: { value: "7" } })
		expect(onChange).toHaveBeenLastCalledWith(1)
	})

	it("percent: a 0–1 value reads and types as 0–100 %", () => {
		const { box, onChange, container } = mount({ value: 0.6, percent: true })
		expect(box.value).toBe("60")
		expect(container.textContent).toContain("%")
		fireEvent.change(box, { target: { value: "35" } })
		expect(onChange).toHaveBeenLastCalledWith(0.35)
	})

	it("a multiplier keeps its own unit and precision", () => {
		const { box, container } = mount({ value: 1.5, min: 0.1, max: 5, step: 0.1, suffix: "×" })
		expect(box.value).toBe("1.5")
		expect(container.textContent).toContain("×")
	})

	it("shows the value at the step's precision, without float noise", () => {
		const { box } = mount({ value: 0.30000000000000004 })
		expect(box.value).toBe("0.3")
	})

	it("disabled: both halves are off and the box shows a dash", () => {
		const { range, box } = mount({ disabled: true })
		expect(range.disabled).toBe(true)
		expect(box.disabled).toBe(true)
		expect(box.value).toBe("")
		expect(box.placeholder).toBe("—")
	})

	it("changed emphasizes the label", () => {
		const { container } = mount({ changed: true })
		expect(container.querySelector("label")?.className).toContain("font-semibold")
	})
})

/** A changed value's reset link ends the row: to the right of the setting,
 *  on its line. */
describe("Slider — reset", () => {
	afterEach(cleanup)

	const mount = (props: Partial<React.ComponentProps<typeof Slider>>) => {
		const onReset = vi.fn()
		const utils = render(
			<Slider
				label="Opacity"
				value={0.4}
				min={0}
				max={1}
				step={0.05}
				onChange={vi.fn()}
				onReset={onReset}
				resetLabel="Reset opacity"
				{...props}
			/>
		)
		return { onReset, ...utils }
	}

	it("shows no link while the value is the default", () => {
		const { queryByLabelText } = mount({ changed: false })
		expect(queryByLabelText("Reset opacity")).toBeNull()
	})

	it("a changed value has the link as the last thing in its row", () => {
		const { getByLabelText, onReset } = mount({ changed: true })
		const reset = getByLabelText("Reset opacity")
		const row = getByLabelText("Opacity").parentElement as HTMLElement
		expect(reset.parentElement).toBe(row)
		expect(row.lastElementChild).toBe(reset)
		fireEvent.click(reset)
		expect(onReset).toHaveBeenCalledTimes(1)
	})

	it("a slider given no way to reset shows none", () => {
		const { queryByText } = mount({ changed: true, onReset: undefined })
		expect(queryByText("reset")).toBeNull()
	})
})
