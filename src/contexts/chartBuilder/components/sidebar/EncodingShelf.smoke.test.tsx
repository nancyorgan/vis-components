import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

// Smoke test: proves happy-dom + @testing-library/react render pipeline is
// wired. Later component tests rely on this same setup — if one of those
// fails, this file narrows whether the failure is environmental or logical.
describe("component-test environment", () => {
	it("renders a React component into happy-dom and queries it", () => {
		render(<div data-testid="smoke">vis-components jsdom alive</div>)
		expect(screen.getByTestId("smoke").textContent).toBe(
			"vis-components jsdom alive"
		)
	})
})
