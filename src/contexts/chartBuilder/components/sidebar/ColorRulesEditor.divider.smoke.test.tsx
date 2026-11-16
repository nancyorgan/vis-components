import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { TestProvider } from "../../../../testSupport/TestProvider"

import { ColorRulesEditor } from "./ColorRulesEditor"

/** Dividers are never drawn around a single row (`ui/rowGroup.ts`), with
 *  one exception kept on purpose: the line above "+ Add color rule" stays
 *  even before a rule exists, when the link is the block's only row. */

afterEach(cleanup)

const mount = (props: Partial<Parameters<typeof ColorRulesEditor>[0]> = {}) => {
	installInMemoryLocalStorage()
	return render(
		<TestProvider>
			<ColorRulesEditor rules={[]} onChange={() => undefined} defaultColor="#000000" {...props} />
		</TestProvider>
	)
}

describe("ColorRulesEditor — the line above the add link", () => {
	it("is there with no rule yet, when the link is the only row", () => {
		const { getByText } = mount()
		expect(getByText("+ Add color rule").parentElement?.classList.contains("vc-divider-group")).toBe(true)
	})

	it("is there with rules", () => {
		const { getByText } = mount({ rules: [{ condition: "> 0", color: "#ff0000" }] })
		expect(getByText("+ Add color rule").parentElement?.classList.contains("vc-divider-group")).toBe(true)
	})

	it("is off for a host that puts the rules among its own rows", () => {
		const { getByText } = mount({ divider: false })
		expect(getByText("+ Add color rule").parentElement?.classList.contains("vc-divider-group")).toBe(false)
	})
})
