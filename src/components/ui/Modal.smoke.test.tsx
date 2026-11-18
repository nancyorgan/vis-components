import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { afterEach, describe, expect, it } from "vitest"

import { Modal } from "./Modal"

afterEach(() => {
	cleanup()
	delete document.documentElement.dataset.vcModality
})

const nextFrame = () =>
	new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))

const Harness = ({ title }: { title?: string }) => {
	const [open, setOpen] = useState(false)
	return (
		<>
			<button type="button" onClick={() => setOpen(true)}>
				Open
			</button>
			<Modal
				open={open}
				onClose={() => setOpen(false)}
				title={title}
				aria-label={title ? undefined : "Unnamed dialog"}
			>
				<button type="button">First</button>
				<button type="button" onClick={() => setOpen(false)}>
					Last
				</button>
			</Modal>
		</>
	)
}

describe("Modal accessibility", () => {
	it("is named by its title", () => {
		render(<Harness title="Export this visualization" />)
		fireEvent.click(screen.getByText("Open"))
		expect(
			screen.getByRole("dialog", { name: "Export this visualization" })
		).toBeTruthy()
	})

	it("takes an aria-label when there's no title", () => {
		render(<Harness />)
		fireEvent.click(screen.getByText("Open"))
		expect(screen.getByRole("dialog", { name: "Unnamed dialog" })).toBeTruthy()
	})

	it("focuses the panel for a pointer user, the first control for a keyboard user", async () => {
		render(<Harness title="T" />)
		fireEvent.click(screen.getByText("Open"))
		await nextFrame()
		expect(document.activeElement).toBe(screen.getByRole("dialog"))
		fireEvent.click(screen.getByText("Last"))

		document.documentElement.dataset.vcModality = "keyboard"
		fireEvent.click(screen.getByText("Open"))
		await nextFrame()
		expect(document.activeElement).toBe(screen.getByText("First"))
	})

	it("traps Tab inside the panel and restores focus on close", async () => {
		render(<Harness title="T" />)
		const opener = screen.getByText("Open")
		opener.focus()
		fireEvent.click(opener)
		await nextFrame()
		const last = screen.getByText("Last")
		last.focus()
		fireEvent.keyDown(last, { key: "Tab" })
		expect(document.activeElement).toBe(screen.getByText("First"))
		fireEvent.keyDown(screen.getByText("First"), { key: "Tab", shiftKey: true })
		expect(document.activeElement).toBe(last)
		fireEvent.click(last)
		expect(document.activeElement).toBe(opener)
	})
})

describe("Modal close button", () => {
	const Closable = () => {
		const [open, setOpen] = useState(true)
		return (
			<Modal open={open} onClose={() => setOpen(false)} title="Export" closeButton>
				<p>Body</p>
			</Modal>
		)
	}

	it("is absent by default", () => {
		render(<Harness title="Export" />)
		fireEvent.click(screen.getByText("Open"))
		expect(screen.queryByRole("button", { name: "Close" })).toBeNull()
	})

	it("renders an × in the title bar that closes the dialog", () => {
		render(<Closable />)
		const close = screen.getByRole("button", { name: "Close" })
		expect(screen.getByRole("dialog").contains(close)).toBe(true)
		fireEvent.click(close)
		expect(screen.queryByRole("dialog")).toBeNull()
	})
})

/** A fit-width dialog (the export modal) sits in an invisible slot that can
 *  span the viewport, so the empty space beside the panel is the slot, not
 *  the backdrop element. Clicking there still closes; a drag that began
 *  inside the panel does not. */
describe("Modal click-away with a fit-width slot", () => {
	const Fit = () => {
		const [open, setOpen] = useState(true)
		return (
			<Modal open={open} onClose={() => setOpen(false)} title="T" fitWidth maxWidthPx={2000}>
				<p>Body</p>
			</Modal>
		)
	}

	it("closes on a click in the slot beside the panel", () => {
		render(<Fit />)
		const slot = screen.getByRole("dialog").parentElement!
		fireEvent.mouseDown(slot)
		fireEvent.click(slot)
		expect(screen.queryByRole("dialog")).toBeNull()
	})

	it("stays open when the press began inside the panel", () => {
		render(<Fit />)
		const slot = screen.getByRole("dialog").parentElement!
		fireEvent.mouseDown(screen.getByText("Body"))
		fireEvent.click(slot)
		expect(screen.getByRole("dialog")).toBeTruthy()
	})
})
