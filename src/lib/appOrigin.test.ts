import { afterEach, describe, expect, it } from "vitest"
import { appOrigin, resetAppOriginForTests, setAppOrigin } from "./appOrigin"

afterEach(() => {
	resetAppOriginForTests()
})

describe("appOrigin", () => {
	it("falls back to the page origin when unconfigured", () => {
		expect(appOrigin()).toBe(window.location.origin)
	})

	it("prefers the configured base URL, trailing slashes stripped", () => {
		setAppOrigin("https://charts.example.com/")
		expect(appOrigin()).toBe("https://charts.example.com")
	})
})
