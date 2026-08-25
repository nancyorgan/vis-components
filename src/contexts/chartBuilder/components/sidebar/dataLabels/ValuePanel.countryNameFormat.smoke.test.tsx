import { cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { DEFAULT_DATA_LABELS_CONFIG } from "../../../lib/channelConfig"
import { COUNTRY_NAME_FORMAT } from "../../../lib/geo/countryNames"
import { SingleValuePanel } from "./ValuePanel"

/** The Label-format dropdown's Geography group ("Full country name") is
 *  offered only on countries-level geo charts — DataLabelsPanel passes
 *  `countryNames` there and nowhere else, so every other chart type keeps
 *  its dropdown unchanged. Picking it stores the COUNTRY_NAME_FORMAT spec
 *  in the same per-field `fieldFormats` store the d3 presets use. */

const mount = (countryNames: boolean, onChange: (p: unknown) => void) =>
	render(
		<SingleValuePanel
			field="Country"
			cfg={DEFAULT_DATA_LABELS_CONFIG}
			onChange={onChange}
			countryNames={countryNames}
		/>,
	)

describe("Data Labels Label format — Full country name option", () => {
	afterEach(cleanup)

	it("offers the option when countryNames is set and commits the spec", () => {
		const onChange = vi.fn()
		const { getByRole } = mount(true, onChange)
		const option = getByRole("option", {
			name: /Full country name/i,
		}) as HTMLOptionElement
		expect(option.value).toBe(COUNTRY_NAME_FORMAT)
		// The preset dropdown is the select carrying the option.
		const select = option.closest("select")!
		fireEvent.change(select, { target: { value: COUNTRY_NAME_FORMAT } })
		expect(onChange).toHaveBeenCalledWith({
			fieldFormats: { Country: COUNTRY_NAME_FORMAT },
		})
	})

	it("hides the option outside countries-level geo contexts", () => {
		const { queryByRole } = mount(false, vi.fn())
		expect(queryByRole("option", { name: /Full country name/i })).toBeNull()
		// The rest of the dropdown is unchanged.
		expect(queryByRole("option", { name: /Literal/i })).toBeTruthy()
	})
})
