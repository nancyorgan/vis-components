import { act, cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { TitleTooltipLayer } from "./TitleTooltipLayer"

const pointerOver = (
	el: Element,
	pointerType = "mouse",
	at: { clientX: number; clientY: number } = { clientX: 0, clientY: 0 }
) =>
	act(() => {
		el.dispatchEvent(
			new PointerEvent("pointerover", { bubbles: true, pointerType, ...at })
		)
	})

const tipText = () => screen.queryByTestId("title-tooltip")?.textContent ?? null

afterEach(cleanup)

describe("TitleTooltipLayer", () => {
	it("shows a title instantly on mouse hover and restores it on leave", () => {
		render(
			<div data-testid="outside">
				<button type="button" title="Black-and-white preview">
					<svg />
				</button>
				<TitleTooltipLayer />
			</div>
		)
		const btn = screen.getByRole("button")
		pointerOver(btn)
		expect(tipText()).toBe("Black-and-white preview")
		// Stashed so the browser's slow gray box can't also appear…
		expect(btn.hasAttribute("title")).toBe(false)
		// …while the icon-only button keeps its accessible name.
		expect(btn.getAttribute("aria-label")).toBe("Black-and-white preview")

		pointerOver(screen.getByTestId("outside"))
		expect(tipText()).toBeNull()
		expect(btn.getAttribute("title")).toBe("Black-and-white preview")
		expect(btn.hasAttribute("aria-label")).toBe(false)
	})

	it("keeps the same label while moving over the control's children", () => {
		render(
			<>
				<button type="button" title="Settings">
					<span data-testid="inner">⚙</span>
				</button>
				<TitleTooltipLayer />
			</>
		)
		pointerOver(screen.getByRole("button"))
		pointerOver(screen.getByTestId("inner"))
		expect(tipText()).toBe("Settings")
		// Has visible text, so no aria-label is added.
		expect(screen.getByRole("button").hasAttribute("aria-label")).toBe(false)
	})

	it("stashes a titled ancestor too, and ignores touch", () => {
		render(
			<>
				<div title="Outer" data-testid="outer">
					<button type="button" title="Inner">
						x
					</button>
				</div>
				<TitleTooltipLayer />
			</>
		)
		const btn = screen.getByRole("button")
		pointerOver(btn, "touch")
		expect(tipText()).toBeNull()
		expect(btn.getAttribute("title")).toBe("Inner")

		pointerOver(btn)
		expect(tipText()).toBe("Inner")
		expect(screen.getByTestId("outer").hasAttribute("title")).toBe(false)
	})

	it("sits just below the pointer, not centered under a wide control", () => {
		render(
			<>
				<button type="button" title="Rename" style={{ width: 600 }}>
					<svg />
				</button>
				<TitleTooltipLayer />
			</>
		)
		pointerOver(screen.getByRole("button"), "mouse", { clientX: 300, clientY: 100 })
		const tip = screen.getByTestId("title-tooltip")
		// happy-dom has no layout (the tip measures 0 wide), so its left edge
		// is the pointer's x and its top clears the cursor below the pointer.
		expect(tip.style.left).toBe("300px")
		expect(tip.style.top).toBe("120px")
	})

	it("doesn't echo a title that repeats the visible text", () => {
		render(
			<>
				<span title="Apples">Apples</span>
				<TitleTooltipLayer />
			</>
		)
		const span = screen.getByText("Apples")
		pointerOver(span)
		expect(tipText()).toBeNull()
		// Still stashed, so the browser's box doesn't show it either.
		expect(span.hasAttribute("title")).toBe(false)
	})

	it("hides on press but keeps the title stashed until the pointer leaves", () => {
		render(
			<>
				<button type="button" title="Undo">
					x
				</button>
				<TitleTooltipLayer />
			</>
		)
		const btn = screen.getByRole("button")
		pointerOver(btn)
		act(() => {
			btn.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))
		})
		expect(tipText()).toBeNull()
		expect(btn.hasAttribute("title")).toBe(false)
	})
})
