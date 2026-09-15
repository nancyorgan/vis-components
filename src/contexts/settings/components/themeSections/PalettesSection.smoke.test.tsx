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

/** Three palettes per list, for the card-level reorder tests. */
const MULTI_THEME: Theme = {
	...THEME,
	categoricalPalettes: [
		{ id: "cat-a", name: "Alpha", colors: ["#a00000", "#0a0000"] },
		{ id: "cat-b", name: "Beta", colors: ["#b00000", "#0b0000"] },
		{ id: "cat-c", name: "Gamma", colors: ["#c00000", "#0c0000"] },
	],
	defaultCategoricalPaletteId: "cat-b",
	ordinalPalettes: [
		{ id: "ord-a", name: "Ramp A", colors: ["#eeeeee", "#111111"] },
		{ id: "ord-b", name: "Ramp B", colors: ["#dddddd", "#222222"] },
	],
	defaultOrdinalPaletteId: "ord-a",
}

const mount = (isReadOnly = false, theme: Theme = THEME) => {
	const set = vi.fn() as unknown as ThemeSetter & ReturnType<typeof vi.fn>
	render(<PalettesSection theme={theme} set={set} isReadOnly={isReadOnly} />)
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

/** The card wrapper (drop target) and grip (drag source) of the palette
 *  whose name input holds `name`. */
const cardOf = (name: string) => {
	const nameInput = screen.getByDisplayValue(name)
	const card = nameInput.closest("[data-testid='palette-card']") as HTMLElement
	return { card, grip: within(card).getByTestId("palette-drag-handle") }
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

/** Drag a card's grip onto another card, landing in its top or bottom
 *  half — the half picks the insertion gap. */
const dragCardTo = (
	grip: HTMLElement,
	target: HTMLElement,
	half: "top" | "bottom"
) => {
	const dataTransfer = makeFakeDataTransfer()
	const top = 200
	const height = 80
	target.getBoundingClientRect = () =>
		({
			top,
			height,
			bottom: top + height,
			left: 0,
			right: 300,
			width: 300,
			x: 0,
			y: top,
		}) as DOMRect
	const clientY = half === "top" ? top + 1 : top + height - 1
	const dragEvent = (kind: "dragOver" | "drop", node: HTMLElement) => {
		const event = createEvent[kind](node, { dataTransfer })
		Object.defineProperty(event, "clientY", { value: clientY })
		fireEvent(node, event)
	}
	fireEvent.dragStart(grip, { dataTransfer })
	dragEvent("dragOver", target)
	dragEvent("drop", target)
	fireEvent.dragEnd(grip, { dataTransfer })
}

describe("PalettesSection — drag to reorder whole palettes", () => {
	it("tells the user palettes can be dragged by the handle", () => {
		mount(false, MULTI_THEME)
		expect(screen.getAllByText(/drag the ⠿ handle to reorder palettes/)).toHaveLength(2)
	})

	it("moves a categorical palette to the end without touching the default", () => {
		const { set } = mount(false, MULTI_THEME)
		// Drag Alpha onto the bottom half of Gamma → Beta, Gamma, Alpha.
		dragCardTo(cardOf("Alpha").grip, cardOf("Gamma").card, "bottom")

		expect(set).toHaveBeenCalledTimes(1)
		expect(set).toHaveBeenCalledWith("categoricalPalettes", [
			MULTI_THEME.categoricalPalettes[1],
			MULTI_THEME.categoricalPalettes[2],
			MULTI_THEME.categoricalPalettes[0],
		])
	})

	it("moves an ordinal palette backward when dropped on a top half", () => {
		const { set } = mount(false, MULTI_THEME)
		dragCardTo(cardOf("Ramp B").grip, cardOf("Ramp A").card, "top")

		expect(set).toHaveBeenCalledWith("ordinalPalettes", [
			MULTI_THEME.ordinalPalettes![1],
			MULTI_THEME.ordinalPalettes![0],
		])
	})

	it("reorders palettes when the drop lands on a swatch inside a card", () => {
		const { set } = mount(false, MULTI_THEME)
		// The swatch's own drag handlers bail (no swatch drag in flight), so
		// the event bubbles to the card wrapper.
		const target = swatchesOf("Gamma")[0]!
		dragCardTo(cardOf("Alpha").grip, target, "bottom")
		// The wrapper measures ITSELF for the half, and happy-dom's wrapper
		// rect is all zeros, so any clientY reads as "below" → trailing gap.
		expect(set).toHaveBeenCalledWith("categoricalPalettes", [
			MULTI_THEME.categoricalPalettes[1],
			MULTI_THEME.categoricalPalettes[2],
			MULTI_THEME.categoricalPalettes[0],
		])
	})

	it("ignores a categorical card dropped on the ordinal list", () => {
		const { set } = mount(false, MULTI_THEME)
		dragCardTo(cardOf("Alpha").grip, cardOf("Ramp B").card, "bottom")
		expect(set).not.toHaveBeenCalled()
	})

	it("draws a horizontal line in the target gap while dragging", () => {
		mount(false, MULTI_THEME)
		const dataTransfer = makeFakeDataTransfer()
		const { grip } = cardOf("Alpha")
		const { card: target } = cardOf("Gamma")
		target.getBoundingClientRect = () =>
			({ top: 200, height: 80, bottom: 280 }) as DOMRect
		expect(screen.queryByTestId("palette-card-drop-indicator")).toBeNull()

		fireEvent.dragStart(grip, { dataTransfer })
		// Bottom half of the last card → trailing gap, line on its bottom edge.
		const over = createEvent.dragOver(target, { dataTransfer })
		Object.defineProperty(over, "clientY", { value: 279 })
		fireEvent(target, over)
		let line = screen.getByTestId("palette-card-drop-indicator")
		expect(target.contains(line)).toBe(true)
		expect(line.className).toContain("-bottom-")

		// Top half → the gap above it.
		const overTop = createEvent.dragOver(target, { dataTransfer })
		Object.defineProperty(overTop, "clientY", { value: 201 })
		fireEvent(target, overTop)
		line = screen.getByTestId("palette-card-drop-indicator")
		expect(line.className).toContain("-top-")

		// The dragged card dims while in flight.
		expect(cardOf("Alpha").card.querySelector(".rounded-lg")!.className).toContain("opacity-50")

		fireEvent.dragEnd(grip, { dataTransfer })
		expect(screen.queryByTestId("palette-card-drop-indicator")).toBeNull()
	})

	it("writes nothing when a card is dropped back where it was", () => {
		const { set } = mount(false, MULTI_THEME)
		dragCardTo(cardOf("Beta").grip, cardOf("Beta").card, "top")
		dragCardTo(cardOf("Beta").grip, cardOf("Gamma").card, "top")
		expect(set).not.toHaveBeenCalled()
	})

	it("is not draggable on a read-only theme", () => {
		const { set } = mount(true, MULTI_THEME)
		const { grip } = cardOf("Alpha")
		expect(grip.getAttribute("draggable")).toBe("false")
		dragCardTo(grip, cardOf("Gamma").card, "bottom")
		expect(set).not.toHaveBeenCalled()
	})

	it("leaves swatch drags working inside a reorderable list", () => {
		const { set } = mount(false, MULTI_THEME)
		const swatches = swatchesOf("Beta")
		dragTo(swatches[0]!, swatches[1]!, "right")
		expect(set).toHaveBeenCalledWith("categoricalPalettes", [
			MULTI_THEME.categoricalPalettes[0],
			{ ...MULTI_THEME.categoricalPalettes[1], colors: ["#0b0000", "#b00000"] },
			MULTI_THEME.categoricalPalettes[2],
		])
	})
})

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
