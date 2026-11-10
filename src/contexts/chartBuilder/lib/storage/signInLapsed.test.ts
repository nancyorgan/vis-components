import { afterEach, describe, expect, it } from "vitest"
import {
	isSignInLapsed,
	markSignInLapsed,
	noteSignIn,
	resetSignInLapsedForTests,
} from "./signInLapsed"

afterEach(() => resetSignInLapsedForTests())

describe("signInLapsed", () => {
	it("flips on a 401 and on nothing else, and only a reset clears it", () => {
		expect(isSignInLapsed()).toBe(false)
		for (const status of [200, 204, 404, 409, 500]) {
			expect(noteSignIn({ status }).status).toBe(status)
			expect(isSignInLapsed()).toBe(false)
		}
		expect(noteSignIn({ status: 401 }).status).toBe(401)
		expect(isSignInLapsed()).toBe(true)
		noteSignIn({ status: 200 })
		expect(isSignInLapsed()).toBe(true)
	})

	it("marking twice is harmless", () => {
		markSignInLapsed()
		markSignInLapsed()
		expect(isSignInLapsed()).toBe(true)
	})
})
