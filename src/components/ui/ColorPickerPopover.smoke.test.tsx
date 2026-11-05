import { useState } from "react"
import { act, cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ColorInput } from "./ColorInput"

/** The swatch's popover, driven through `ColorInput` the way the app
 *  mounts it. The popover renders into a portal at `document.body`, so the
 *  queries below go through `document.body` rather than `container`. */

const swatchOf = (container: HTMLElement) =>
	container.querySelector<HTMLButtonElement>("button[data-color]")!
const dialog = () =>
	document.body.querySelector<HTMLElement>('[role="dialog"]')
const svSlider = () =>
	document.body.querySelector<HTMLElement>(
		'[role="slider"][aria-label="Saturation and brightness"]'
	)!
const hueSlider = () =>
	document.body.querySelector<HTMLElement>('[role="slider"][aria-label="Hue"]')!
const hexField = () =>
	document.body.querySelector<HTMLInputElement>('input[aria-label="Hex code"]')!

/** Stateful host: echoes every pick back down as `value`, like the app's
 *  atoms do, so the popover's "is this my own echo?" logic is exercised. */
const Host = ({
	initial,
	onChange,
}: {
	initial: string
	onChange?: (hex: string) => void
}) => {
	const [v, setV] = useState(initial)
	return (
		<>
			<ColorInput
				label="Fill"
				value={v}
				onChange={(hex) => {
					setV(hex)
					onChange?.(hex)
				}}
			/>
			<button type="button" onClick={() => setV("#0000FF")}>
				set blue
			</button>
			<button type="button">elsewhere</button>
		</>
	)
}

describe("ColorPickerPopover", () => {
	afterEach(() => {
		cleanup()
		document.documentElement.dataset.vcModality = "pointer"
	})

	it("opens from the swatch as a labelled dialog with both sliders and a hex field", () => {
		const { container } = render(<Host initial="#FF0000" />)
		expect(dialog()).toBeNull()
		const swatch = swatchOf(container)
		expect(swatch.getAttribute("aria-expanded")).toBe("false")
		fireEvent.click(swatch)
		expect(dialog()?.getAttribute("aria-label")).toBe("Fill color picker")
		expect(swatch.getAttribute("aria-expanded")).toBe("true")
		expect(svSlider().getAttribute("aria-valuetext")).toBe(
			"Saturation 100%, brightness 100%"
		)
		expect(hueSlider().getAttribute("aria-valuenow")).toBe("0")
		expect(hexField().value).toBe("#FF0000")
		// Clicking the swatch again toggles it shut.
		fireEvent.click(swatch)
		expect(dialog()).toBeNull()
	})

	it("arrow keys on the swatch square move saturation / brightness and commit live", () => {
		const onChange = vi.fn()
		const { container } = render(<Host initial="#808080" onChange={onChange} />)
		fireEvent.click(swatchOf(container))
		const sv = svSlider()
		fireEvent.keyDown(sv, { key: "ArrowRight" })
		expect(sv.getAttribute("aria-valuetext")).toBe(
			"Saturation 1%, brightness 50%"
		)
		expect(onChange).toHaveBeenCalledTimes(1)
		expect(onChange.mock.calls[0][0]).toMatch(/^#[0-9A-F]{6}$/)
		fireEvent.keyDown(sv, { key: "ArrowUp", shiftKey: true })
		expect(sv.getAttribute("aria-valuenow")).toBe("60")
		// Clamped at the edges.
		for (let i = 0; i < 6; i++)
			fireEvent.keyDown(sv, { key: "ArrowUp", shiftKey: true })
		expect(sv.getAttribute("aria-valuenow")).toBe("100")
	})

	it("the hue strip keeps its hue through white, so a tint stays on-hue", () => {
		const onChange = vi.fn()
		const { container } = render(<Host initial="#FF0000" onChange={onChange} />)
		fireEvent.click(swatchOf(container))
		const hue = hueSlider()
		for (let i = 0; i < 12; i++)
			fireEvent.keyDown(hue, { key: "ArrowRight", shiftKey: true })
		expect(hue.getAttribute("aria-valuenow")).toBe("120")
		expect(onChange).toHaveBeenLastCalledWith("#00FF00")
		const sv = svSlider()
		for (let i = 0; i < 10; i++)
			fireEvent.keyDown(sv, { key: "ArrowLeft", shiftKey: true })
		expect(onChange).toHaveBeenLastCalledWith("#FFFFFF")
		// A hex of white carries no hue; re-deriving it would snap to red and
		// this step would produce a pink (#FFE6E6) instead of the green tint.
		fireEvent.keyDown(sv, { key: "ArrowRight", shiftKey: true })
		expect(onChange).toHaveBeenLastCalledWith("#E6FFE6")
		expect(hue.getAttribute("aria-valuenow")).toBe("120")
		// Home / End pin the strip's ends; 360 folds back onto red.
		fireEvent.keyDown(hue, { key: "End" })
		expect(hue.getAttribute("aria-valuenow")).toBe("360")
		fireEvent.keyDown(hue, { key: "Home" })
		expect(hue.getAttribute("aria-valuenow")).toBe("0")
	})

	it("the popover's hex field commits once it parses and leaves partial text alone", () => {
		const onChange = vi.fn()
		const { container } = render(<Host initial="#000000" onChange={onChange} />)
		fireEvent.click(swatchOf(container))
		const field = hexField()
		fireEvent.change(field, { target: { value: "#ab" } })
		expect(onChange).not.toHaveBeenCalled()
		expect(field.className).toContain("border-amber-400")
		fireEvent.change(field, { target: { value: "#abc" } })
		expect(onChange).toHaveBeenLastCalledWith("#AABBCC")
		// Typed text is NOT expanded under the caret…
		expect(field.value).toBe("#ABC")
		// …so it can keep growing into a six-digit code.
		fireEvent.change(field, { target: { value: "#abcdef" } })
		expect(onChange).toHaveBeenLastCalledWith("#ABCDEF")
		expect(hueSlider().getAttribute("aria-valuenow")).toBe("210")
		// Invalid leftovers snap back to the current color when focus moves
		// on (to a sibling control here; leaving the popover would close it).
		fireEvent.change(field, { target: { value: "#zz" } })
		fireEvent.blur(field, { relatedTarget: svSlider() })
		expect(dialog()).not.toBeNull()
		expect(field.value).toBe("#ABCDEF")
	})

	it("an outside change to the value re-syncs the sliders", () => {
		const { container, getByText } = render(<Host initial="#FF0000" />)
		fireEvent.click(swatchOf(container))
		fireEvent.click(getByText("set blue"))
		expect(hueSlider().getAttribute("aria-valuenow")).toBe("240")
		expect(hexField().value).toBe("#0000FF")
	})

	it("dragging on the swatch square picks by position", () => {
		const onChange = vi.fn()
		const { container } = render(<Host initial="#FF0000" onChange={onChange} />)
		fireEvent.click(swatchOf(container))
		const sv = svSlider()
		// happy-dom lays nothing out; give the square a 200×100 box.
		vi.spyOn(sv, "getBoundingClientRect").mockReturnValue({
			left: 0,
			top: 0,
			right: 200,
			bottom: 100,
			width: 200,
			height: 100,
			x: 0,
			y: 0,
			toJSON: () => ({}),
		})
		fireEvent.pointerDown(sv, { clientX: 100, clientY: 50, button: 0 })
		// Half saturation, half brightness under red.
		expect(onChange).toHaveBeenLastCalledWith("#804040")
		fireEvent.pointerMove(sv, { clientX: 400, clientY: -20 })
		expect(onChange).toHaveBeenLastCalledWith("#FF0000")
		fireEvent.pointerUp(sv)
		// After release, moves no longer pick.
		fireEvent.pointerMove(sv, { clientX: 0, clientY: 100 })
		expect(onChange).toHaveBeenLastCalledWith("#FF0000")
	})

	it("Escape closes the popover and returns focus to the swatch", () => {
		const { container } = render(<Host initial="#FF0000" />)
		const swatch = swatchOf(container)
		fireEvent.click(swatch)
		svSlider().focus()
		fireEvent.keyDown(document, { key: "Escape" })
		expect(dialog()).toBeNull()
		expect(document.activeElement).toBe(swatch)
	})

	it("a press outside closes it; a press inside or on the swatch does not", () => {
		const { container, getByText } = render(<Host initial="#FF0000" />)
		const swatch = swatchOf(container)
		fireEvent.click(swatch)
		fireEvent.pointerDown(hueSlider())
		expect(dialog()).not.toBeNull()
		fireEvent.pointerDown(swatch)
		expect(dialog()).not.toBeNull()
		fireEvent.pointerDown(getByText("elsewhere"))
		expect(dialog()).toBeNull()
	})

	it("Tab past the hex field hands focus back to the swatch and closes", () => {
		const { container } = render(<Host initial="#FF0000" />)
		const swatch = swatchOf(container)
		fireEvent.click(swatch)
		const field = hexField()
		field.focus()
		fireEvent.keyDown(field, { key: "Tab" })
		expect(dialog()).toBeNull()
		expect(document.activeElement).toBe(swatch)
	})

	it("focus leaving the popover closes it", () => {
		const { container, getByText } = render(<Host initial="#FF0000" />)
		fireEvent.click(swatchOf(container))
		const sv = svSlider()
		sv.focus()
		fireEvent.blur(sv, { relatedTarget: getByText("elsewhere") })
		expect(dialog()).toBeNull()
	})

	it("a keyboard user lands on the swatch square when the popover opens", () => {
		document.documentElement.dataset.vcModality = "keyboard"
		const { container } = render(<Host initial="#FF0000" />)
		fireEvent.click(swatchOf(container))
		expect(document.activeElement).toBe(svSlider())
	})

	it("a disabled swatch does not open", () => {
		const { container } = render(
			<ColorInput label="Fill" value="#FF0000" onChange={() => {}} disabled />
		)
		fireEvent.click(swatchOf(container))
		expect(dialog()).toBeNull()
	})

	it("hides the eyedropper where the browser has no EyeDropper", () => {
		const { container } = render(<Host initial="#FF0000" />)
		fireEvent.click(swatchOf(container))
		expect(
			document.body.querySelector('[aria-label="Pick a color from the screen"]')
		).toBeNull()
	})

	it("the eyedropper commits the picked color and stays open while picking", async () => {
		let resolve!: (r: { sRGBHex: string }) => void
		const w = window as unknown as { EyeDropper?: unknown }
		w.EyeDropper = class {
			open() {
				return new Promise<{ sRGBHex: string }>((r) => (resolve = r))
			}
		}
		try {
			const onChange = vi.fn()
			const { container, getByText } = render(
				<Host initial="#FF0000" onChange={onChange} />
			)
			fireEvent.click(swatchOf(container))
			const dropper = document.body.querySelector<HTMLButtonElement>(
				'[aria-label="Pick a color from the screen"]'
			)!
			fireEvent.click(dropper)
			// The dropper's own click-away / focus loss mustn't close us.
			fireEvent.pointerDown(getByText("elsewhere"))
			fireEvent.blur(dropper, { relatedTarget: null })
			expect(dialog()).not.toBeNull()
			await act(async () => resolve({ sRGBHex: "#1a2b3c" }))
			expect(onChange).toHaveBeenLastCalledWith("#1A2B3C")
			expect(hexField().value).toBe("#1A2B3C")
		} finally {
			delete w.EyeDropper
		}
	})
})
