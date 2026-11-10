import { act, cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import {
	noteSignIn,
	resetSignInLapsedForTests,
} from "../contexts/chartBuilder/lib/storage/signInLapsed"
import { SignInLapsedBanner } from "./SignInLapsedBanner"

afterEach(() => {
	cleanup()
	resetSignInLapsedForTests()
})

describe("SignInLapsedBanner", () => {
	it("stays out of the way until the API answers 401, then asks for a reload", () => {
		const { queryByRole, getByRole } = render(<SignInLapsedBanner />)
		expect(queryByRole("alert")).toBeNull()
		act(() => {
			noteSignIn({ status: 500 })
		})
		expect(queryByRole("alert")).toBeNull()
		act(() => {
			noteSignIn({ status: 401 })
		})
		expect(getByRole("alert").textContent).toMatch(/sign-in has expired/i)
		expect(getByRole("button", { name: "Reload" })).toBeTruthy()
	})
})
