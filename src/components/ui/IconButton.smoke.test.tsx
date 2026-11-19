import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { IconButton } from "./IconButton"
import { Radio } from "./RadioGroup"

afterEach(cleanup)

describe("IconButton", () => {
	it("is a plain button that carries the icon-button class and its own layout classes", () => {
		render(
			<IconButton title="Remove" className="px-1">
				×
			</IconButton>
		)
		const button = screen.getByTitle("Remove")
		expect(button.getAttribute("type")).toBe("button")
		expect(button.className).toBe("vc-icon-button px-1")
	})

	it("takes the quiet class instead when quiet", () => {
		render(<IconButton quiet aria-label="Rename" />)
		expect(screen.getByRole("button", { name: "Rename" }).className).toBe("vc-icon-button-quiet")
	})

	it("fires onClick, and not while disabled", () => {
		const onClick = vi.fn()
		const { rerender } = render(<IconButton title="Move up" onClick={onClick} />)
		fireEvent.click(screen.getByRole("button", { name: "Move up" }))
		expect(onClick).toHaveBeenCalledTimes(1)
		rerender(<IconButton title="Move up" onClick={onClick} disabled />)
		fireEvent.click(screen.getByRole("button", { name: "Move up" }))
		expect(onClick).toHaveBeenCalledTimes(1)
	})
})

describe("Radio", () => {
	it("links its label to the radio, so clicking the label selects it", () => {
		const onChange = vi.fn()
		render(<Radio label="Custom color" checked={false} onChange={onChange} />)
		const radio = screen.getByRole("radio", { name: "Custom color" })
		expect((radio as HTMLInputElement).checked).toBe(false)
		fireEvent.click(screen.getByText("Custom color"))
		expect(onChange).toHaveBeenCalledTimes(1)
	})

	it("reflects checked, name and value", () => {
		render(<Radio label="Treemap" name="layout" value="treemap" checked onChange={() => {}} />)
		const radio = screen.getByRole("radio", { name: "Treemap" }) as HTMLInputElement
		expect(radio.checked).toBe(true)
		expect(radio.name).toBe("layout")
		expect(radio.value).toBe("treemap")
	})

	it("holds a stacked label beside a top-aligned button", () => {
		render(
			<Radio
				align="start"
				checked={false}
				onChange={() => {}}
				label={
					<>
						<div>Start a new visualization</div>
						<div>Keeps the current one as it is.</div>
					</>
				}
			/>
		)
		const radio = screen.getByRole("radio", { name: /Start a new visualization/ })
		expect(radio.closest("div")?.className).toContain("items-start")
	})

	it("does not fire while disabled", () => {
		const onChange = vi.fn()
		render(<Radio label="Pin to current version" checked={false} disabled onChange={onChange} />)
		expect((screen.getByRole("radio") as HTMLInputElement).disabled).toBe(true)
	})
})
