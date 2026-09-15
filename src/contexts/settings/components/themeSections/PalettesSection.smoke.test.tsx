import {
	cleanup,
	createEvent,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SYSTEM_LIGHT_THEME } from "../../../chartBuilder/lib/systemThemes"
import type { Theme } from "../../../chartBuilder/lib/types"

import { PalettesSection } from "./PalettesSection"
import type { ThemeSetter } from "./types"

afterEach(cleanup)

const THEME: Theme = {
	...SYSTEM_LIGHT_THEME,
	categoricalPalettes: [
		{
			id: "cat-1",
			name: "Primary",
			colors: ["#aa0000", "#00bb00", "#0000cc"],
			patternInks: ["#110000", null, "#000011"],
		},
	],
	defaultCategoricalPaletteId: "cat-1",
	ordinalPalettes: [
		{ id: "ord-1", name: "Ramp", colors: ["#eeeeee", "#999999", "#111111"] },
	],
	defaultOrdinalPaletteId: "ord-1",
}

const mount = (isReadOnly = false) => {
	const set = vi.fn() as unknown as ThemeSetter & ReturnType<typeof vi.fn>
	render(<PalettesSection theme={THEME} set={set} isReadOnly={isReadOnly} />)
	// The group is a CollapsibleSubsection that starts closed.
	fireEvent.click(screen.getByText("Color palettes"))
	return { set }
}

/** The draggable swatch wrappers of the card whose name input holds `name`. */
const swatchesOf = (name: string): HTMLElement[] => {
	const nameInput = screen.getByDisplayValue(name)
	const card = nameInput.closest(".rounded-lg") as HTMLElement
	return within(card).getAllByTestId("palette-swatch")
}

/** happy-dom's DataTransfer has no usable setData and its DragEvent drops
 *  clientX, so both are supplied by hand — same shape as the FieldList and
 *  FolderTree drag tests. */
const makeFakeDataTransfer = () => {
	const data = new Map<string, string>()
	return {
		setData: (type: string, value: string) => {
			data.set(type, value)
		},
		getData: (type: string) => data.get(type) ?? "",
		setDragImage: () => {},
	}
}

/** Drag `source` onto `target`, landing in its left or right half — the
 *  half picks the insertion gap, so happy-dom's all-zero rect is replaced. */
const dragTo = (
	source: HTMLElement,
	target: HTMLElement,
	half: "left" | "right"
) => {
	const dataTransfer = makeFakeDataTransfer()
	const left = 100
	const width = 40
	target.getBoundingClientRect = () =>
		({
			left,
			width,
			right: left + width,
			top: 0,
			bottom: 20,
			height: 20,
			x: left,
			y: 0,
		}) as DOMRect
	const clientX = half === "left" ? left + 1 : left + width - 1
	const dragEvent = (kind: "dragOver" | "drop", node: HTMLElement) => {
		const event = createEvent[kind](node, { dataTransfer })
		Object.defineProperty(event, "clientX", { value: clientX })
		fireEvent(node, event)
	}
	fireEvent.dragStart(source, { dataTransfer })
	dragEvent("dragOver", target)
	dragEvent("drop", target)
	fireEvent.dragEnd(source, { dataTransfer })
}

describe("PalettesSection — drag to reorder swatches", () => {
	it("tells the user swatches can be dragged", () => {
		mount()
		expect(screen.getAllByText(/Drag swatches to reorder/)).toHaveLength(2)
	})

	it("moves a categorical swatch and its pattern ink together", () => {
		const { set } = mount()
		const swatches = swatchesOf("Primary")
		expect(swatches).toHaveLength(3)
		// Drag the first swatch onto the right half of the last → B, C, A.
		dragTo(swatches[0]!, swatches[2]!, "right")

		expect(set).toHaveBeenCalledTimes(1)
		expect(set).toHaveBeenCalledWith("categoricalPalettes", [
			{
				id: "cat-1",
				name: "Primary",
				colors: ["#00bb00", "#0000cc", "#aa0000"],
				patternInks: [null, "#000011", "#110000"],
			},
		])
	})

	it("moves an ordinal swatch backward when dropped on a left half", () => {
		const { set } = mount()
		const swatches = swatchesOf("Ramp")
		// Drag the last swatch onto the left half of the first → C, A, B.
		dragTo(swatches[2]!, swatches[0]!, "left")

		expect(set).toHaveBeenCalledWith("ordinalPalettes", [
			{
				id: "ord-1",
				name: "Ramp",
				colors: ["#111111", "#eeeeee", "#999999"],
			},
		])
	})

	it("draws a vertical line in the target gap while dragging", () => {
		mount()
		const swatches = swatchesOf("Primary")
		const dataTransfer = makeFakeDataTransfer()
		const target = swatches[2]!
		target.getBoundingClientRect = () =>
			({ left: 100, width: 40, right: 140 }) as DOMRect
		expect(screen.queryByTestId("palette-drop-indicator")).toBeNull()

		fireEvent.dragStart(swatches[0]!, { dataTransfer })
		// Hover the RIGHT half of the last swatch → trailing gap, so the
		// line hangs off that swatch's right edge.
		const over = createEvent.dragOver(target, { dataTransfer })
		Object.defineProperty(over, "clientX", { value: 139 })
		fireEvent(target, over)
		const line = screen.getByTestId("palette-drop-indicator")
		expect(target.contains(line)).toBe(true)
		expect(line.className).toContain("-right-")

		// Hover the LEFT half instead → the gap before it.
		const overLeft = createEvent.dragOver(target, { dataTransfer })
		Object.defineProperty(overLeft, "clientX", { value: 101 })
		fireEvent(target, overLeft)
		expect(screen.getByTestId("palette-drop-indicator").className).toContain(
			"-left-"
		)

		// Ending the drag clears it.
		fireEvent.dragEnd(swatches[0]!, { dataTransfer })
		expect(screen.queryByTestId("palette-drop-indicator")).toBeNull()
	})

	it("writes nothing when a swatch is dropped back where it was", () => {
		const { set } = mount()
		const swatches = swatchesOf("Primary")
		dragTo(swatches[1]!, swatches[1]!, "left")
		dragTo(swatches[1]!, swatches[2]!, "left")
		expect(set).not.toHaveBeenCalled()
	})

	it("is not draggable on a read-only theme", () => {
		const { set } = mount(true)
		const swatches = swatchesOf("Primary")
		expect(swatches[0]!.getAttribute("draggable")).toBe("false")
		dragTo(swatches[0]!, swatches[2]!, "right")
		expect(set).not.toHaveBeenCalled()
	})
})
