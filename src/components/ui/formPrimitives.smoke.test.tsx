import { useState } from "react"
import { cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { ColorInput } from "./ColorInput"
import { NumberInput } from "./NumberInput"
import { RadioGroup } from "./RadioGroup"
import { SelectInput } from "./SelectInput"
import { Toggle } from "./Toggle"

/** All four labeled primitives share three contract behaviors worth pinning
 *  centrally: (a) the `<label>` resolves to its control via `htmlFor`, (b)
 *  changes flow through `onChange`, (c) disabled state propagates. */
describe("form primitives — label / id association", () => {
	afterEach(cleanup)

	it("NumberInput links its label to the input via htmlFor", () => {
		const { container } = render(
			<NumberInput label="Width" value={5} onChange={() => {}} />
		)
		const label = container.querySelector("label")
		const input = container.querySelector("input")
		expect(label).not.toBeNull()
		expect(input).not.toBeNull()
		expect(label!.getAttribute("for")).toBe(input!.getAttribute("id"))
	})

	it("ColorInput links its label to the color swatch input", () => {
		const { container } = render(
			<ColorInput label="Fill" value="#abcdef" onChange={() => {}} />
		)
		const label = container.querySelector("label")
		const swatch = container.querySelector('input[type="color"]')
		expect(label!.getAttribute("for")).toBe(swatch!.getAttribute("id"))
	})

	it("SelectInput links its label to the select element", () => {
		const { container } = render(
			<SelectInput
				label="Mode"
				value="a"
				options={[
					{ value: "a", label: "A" },
					{ value: "b", label: "B" },
				]}
				onChange={() => {}}
			/>
		)
		const label = container.querySelector("label")
		const select = container.querySelector("select")
		expect(label!.getAttribute("for")).toBe(select!.getAttribute("id"))
	})

	it("Toggle links its label to the checkbox", () => {
		const { container } = render(
			<Toggle label="Show grid" checked={true} onChange={() => {}} />
		)
		const label = container.querySelector("label")
		const checkbox = container.querySelector('input[type="checkbox"]')
		expect(label!.getAttribute("for")).toBe(checkbox!.getAttribute("id"))
	})
})

describe("NumberInput", () => {
	afterEach(cleanup)

	it("fires onChange with the parsed numeric value", () => {
		let captured: number | null = null
		const { container } = render(
			<NumberInput
				label="Count"
				value={5}
				onChange={(n) => {
					captured = n
				}}
			/>
		)
		const input = container.querySelector('input[inputmode="decimal"]')!
		fireEvent.change(input, { target: { value: "42" } })
		expect(captured).toBe(42)
	})

	it("clamps to [min, max] when clamp=true", () => {
		let captured: number | null = null
		const { container } = render(
			<NumberInput
				label="Pct"
				value={50}
				min={0}
				max={100}
				clamp
				onChange={(n) => {
					captured = n
				}}
			/>
		)
		const input = container.querySelector('input[inputmode="decimal"]')!
		fireEvent.change(input, { target: { value: "150" } })
		expect(captured).toBe(100)
		fireEvent.change(input, { target: { value: "-5" } })
		expect(captured).toBe(0)
	})

	it("does NOT clamp when clamp is omitted (raw values pass through)", () => {
		let captured: number | null = null
		const { container } = render(
			<NumberInput
				label="Free"
				value={50}
				min={0}
				max={100}
				onChange={(n) => {
					captured = n
				}}
			/>
		)
		const input = container.querySelector('input[inputmode="decimal"]')!
		fireEvent.change(input, { target: { value: "200" } })
		expect(captured).toBe(200)
	})

	it("lets the user type a leading minus mid-edit without committing it", () => {
		// Regression: a controlled type=number snaps a lone "-" back to the
		// committed value, so negatives are impossible to type. The draft
		// buffer holds "-" in the field and only commits once it parses.
		let captured: number | null = null
		let calls = 0
		const { container } = render(
			<NumberInput
				label="Y min"
				value={5}
				onChange={(n) => {
					captured = n
					calls += 1
				}}
			/>
		)
		const input = container.querySelector(
			'input[inputmode="decimal"]'
		) as HTMLInputElement
		// Typing just "-" must NOT fire onChange and must stay in the field.
		fireEvent.change(input, { target: { value: "-" } })
		expect(calls).toBe(0)
		expect(input.value).toBe("-")
		// Completing the number commits the negative value.
		fireEvent.change(input, { target: { value: "-3" } })
		expect(captured).toBe(-3)
	})

	it("snaps back to the committed value on blur after an unresolved draft", () => {
		const { container } = render(
			<NumberInput label="X" value={7} onChange={() => {}} />
		)
		const input = container.querySelector(
			'input[inputmode="decimal"]'
		) as HTMLInputElement
		fireEvent.change(input, { target: { value: "-" } })
		expect(input.value).toBe("-")
		fireEvent.blur(input)
		expect(input.value).toBe("7")
	})

	it("steps the value with the spinner buttons (clamped)", () => {
		let captured: number | null = null
		const { container, getByLabelText } = render(
			<NumberInput
				label="Px"
				value={2}
				step={0.5}
				min={0}
				clamp
				onChange={(n) => {
					captured = n
				}}
			/>
		)
		// Stepping fires on press (mousedown) so a press-and-hold can repeat;
		// mouseup ends the (here, single-step) interaction.
		fireEvent.mouseDown(getByLabelText("Increment"))
		fireEvent.mouseUp(getByLabelText("Increment"))
		expect(captured).toBe(2.5)
		// Steps off the live draft (the increment set it to 2.5), so down by
		// one step lands on 2.0 — and float noise is rounded out by `step`.
		fireEvent.mouseDown(getByLabelText("Decrement"))
		fireEvent.mouseUp(getByLabelText("Decrement"))
		expect(captured).toBe(2)
		// The input is still a typeable text field alongside the buttons.
		expect(
			container.querySelector('input[inputmode="decimal"]')
		).not.toBeNull()
	})

	it("ignores non-numeric input (no onChange fires)", () => {
		let calls = 0
		const { container } = render(
			<NumberInput
				label="X"
				value={5}
				onChange={() => {
					calls += 1
				}}
			/>
		)
		const input = container.querySelector('input[inputmode="decimal"]')!
		fireEvent.change(input, { target: { value: "abc" } })
		expect(calls).toBe(0)
	})

	it("disables the input when disabled prop is true", () => {
		const { container } = render(
			<NumberInput label="X" value={5} disabled onChange={() => {}} />
		)
		expect(
			(container.querySelector('input[inputmode="decimal"]') as HTMLInputElement)
				.disabled
		).toBe(true)
	})
})

describe("ColorInput", () => {
	afterEach(cleanup)

	it("fires onChange when the swatch changes", () => {
		let captured: string | null = null
		const { container } = render(
			<ColorInput
				label="Fill"
				value="#000000"
				onChange={(c) => {
					captured = c
				}}
			/>
		)
		const swatch = container.querySelector('input[type="color"]')!
		fireEvent.change(swatch, { target: { value: "#ff0000" } })
		expect(captured).toBe("#FF0000")
	})

	it("fires onChange when text input becomes a valid hex", () => {
		let captured: string | null = null
		const { container } = render(
			<ColorInput
				label="Fill"
				value="#000000"
				onChange={(c) => {
					captured = c
				}}
			/>
		)
		const text = container.querySelector('input[type="text"]')!
		fireEvent.change(text, { target: { value: "#abcdef" } })
		expect(captured).toBe("#ABCDEF")
	})

	it("does NOT fire onChange on intermediate invalid hex (lets the user type freely)", () => {
		let calls = 0
		const { container } = render(
			<ColorInput
				label="Fill"
				value="#000000"
				onChange={() => {
					calls += 1
				}}
			/>
		)
		const text = container.querySelector('input[type="text"]')!
		// "#ab" is partial — not a valid hex per HEX_PATTERN.
		fireEvent.change(text, { target: { value: "#ab" } })
		expect(calls).toBe(0)
	})

	it("displays a lowercase value prop as uppercase hex", () => {
		const { container } = render(
			<ColorInput label="Fill" value="#abcdef" onChange={() => {}} />
		)
		const text = container.querySelector(
			'input[type="text"]'
		) as HTMLInputElement
		expect(text.value).toBe("#ABCDEF")
	})

	it("hides the hex text input when showHexInput is false", () => {
		const { container } = render(
			<ColorInput
				label="Fill"
				value="#000000"
				onChange={() => {}}
				showHexInput={false}
			/>
		)
		expect(container.querySelector('input[type="text"]')).toBeNull()
		expect(container.querySelector('input[type="color"]')).not.toBeNull()
	})

	it("re-syncs the text input when value prop changes externally", () => {
		const Wrapper = () => {
			const [v, setV] = useState("#111111")
			return (
				<>
					<ColorInput label="Fill" value={v} onChange={setV} />
					<button type="button" onClick={() => setV("#222222")}>
						set
					</button>
				</>
			)
		}
		const { container, getByText } = render(<Wrapper />)
		const text = container.querySelector(
			'input[type="text"]'
		) as HTMLInputElement
		expect(text.value).toBe("#111111")
		fireEvent.click(getByText("set"))
		expect(text.value).toBe("#222222")
	})
})

describe("SelectInput", () => {
	afterEach(cleanup)

	it("renders all options and reflects the current value as selected", () => {
		const { container } = render(
			<SelectInput
				label="Mode"
				value="b"
				options={[
					{ value: "a", label: "A" },
					{ value: "b", label: "B" },
					{ value: "c", label: "C" },
				]}
				onChange={() => {}}
			/>
		)
		const select = container.querySelector("select") as HTMLSelectElement
		expect(select.value).toBe("b")
		expect(container.querySelectorAll("option").length).toBe(3)
	})

	it("fires onChange with the typed value when the selection changes", () => {
		let captured: "a" | "b" | "c" | null = null
		const { container } = render(
			<SelectInput
				label="Mode"
				value="a"
				options={[
					{ value: "a", label: "A" },
					{ value: "b", label: "B" },
					{ value: "c", label: "C" },
				]}
				onChange={(v) => {
					captured = v
				}}
			/>
		)
		fireEvent.change(container.querySelector("select")!, {
			target: { value: "c" },
		})
		expect(captured).toBe("c")
	})
})

describe("RadioGroup", () => {
	afterEach(cleanup)

	it("shares a single `name` across all options so the browser enforces single-select", () => {
		const { container } = render(
			<RadioGroup
				legend="Background"
				value="a"
				options={[
					{ value: "a", label: "A" },
					{ value: "b", label: "B" },
					{ value: "c", label: "C" },
				]}
				onChange={() => {}}
			/>
		)
		const radios = [
			...container.querySelectorAll('input[type="radio"]'),
		] as HTMLInputElement[]
		expect(radios.length).toBe(3)
		const names = new Set(radios.map((r) => r.name))
		expect(names.size).toBe(1)
	})

	it("marks only the option matching `value` as checked", () => {
		const { container } = render(
			<RadioGroup
				legend="Background"
				value="b"
				options={[
					{ value: "a", label: "A" },
					{ value: "b", label: "B" },
					{ value: "c", label: "C" },
				]}
				onChange={() => {}}
			/>
		)
		const checked = [
			...container.querySelectorAll('input[type="radio"]:checked'),
		] as HTMLInputElement[]
		expect(checked.length).toBe(1)
		expect(checked[0]?.value).toBe("b")
	})

	it("fires onChange with the option's value when a radio is clicked", () => {
		let captured: "a" | "b" | "c" | null = null
		const { container } = render(
			<RadioGroup
				legend="Background"
				value="a"
				options={[
					{ value: "a", label: "A" },
					{ value: "b", label: "B" },
					{ value: "c", label: "C" },
				]}
				onChange={(v) => {
					captured = v
				}}
			/>
		)
		const radios = [
			...container.querySelectorAll('input[type="radio"]'),
		] as HTMLInputElement[]
		fireEvent.click(radios[2]!)
		expect(captured).toBe("c")
	})

	it("each option's label is wired to its radio via htmlFor", () => {
		const { container } = render(
			<RadioGroup
				legend="Pick"
				value="a"
				options={[
					{ value: "a", label: "A" },
					{ value: "b", label: "B" },
				]}
				onChange={() => {}}
			/>
		)
		const labels = [
			...container.querySelectorAll("label"),
		] as HTMLLabelElement[]
		const radios = [
			...container.querySelectorAll('input[type="radio"]'),
		] as HTMLInputElement[]
		expect(labels.length).toBe(2)
		expect(labels[0]!.htmlFor).toBe(radios[0]!.id)
		expect(labels[1]!.htmlFor).toBe(radios[1]!.id)
	})

	it("supports a `trailing` slot rendered to the right of each option's label", () => {
		const { container } = render(
			<RadioGroup
				legend="Pick"
				value="a"
				options={[
					{ value: "a", label: "A", trailing: <span>swatch-A</span> },
					{ value: "b", label: "B", trailing: <span>swatch-B</span> },
				]}
				onChange={() => {}}
			/>
		)
		expect(container.textContent).toContain("swatch-A")
		expect(container.textContent).toContain("swatch-B")
	})
})

describe("Toggle", () => {
	afterEach(cleanup)

	it("fires onChange(true) when an unchecked toggle is clicked", () => {
		let captured: boolean | null = null
		const { container } = render(
			<Toggle
				label="Show"
				checked={false}
				onChange={(v) => {
					captured = v
				}}
			/>
		)
		fireEvent.click(container.querySelector('input[type="checkbox"]')!)
		expect(captured).toBe(true)
	})

	it("fires onChange(false) when a checked toggle is clicked", () => {
		let captured: boolean | null = null
		const { container } = render(
			<Toggle
				label="Show"
				checked={true}
				onChange={(v) => {
					captured = v
				}}
			/>
		)
		fireEvent.click(container.querySelector('input[type="checkbox"]')!)
		expect(captured).toBe(false)
	})

	it("clicking the LABEL toggles the checkbox (via htmlFor association)", () => {
		let captured: boolean | null = null
		const { container } = render(
			<Toggle
				label="Show"
				checked={false}
				onChange={(v) => {
					captured = v
				}}
			/>
		)
		// Clicking the label should activate the associated checkbox —
		// this is the entire reason `htmlFor` matters for accessibility.
		fireEvent.click(container.querySelector("label")!)
		expect(captured).toBe(true)
	})
})
