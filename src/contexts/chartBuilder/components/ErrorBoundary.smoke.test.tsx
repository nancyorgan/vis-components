import { useState } from "react"
import { cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ErrorBoundary } from "./ErrorBoundary"

/** The boundary's job is narrow: catch render-time errors in descendants,
 *  show a fallback, and offer a "try again" that re-mounts. These tests
 *  pin those three behaviors. */
describe("ErrorBoundary", () => {
	// React's error boundaries log the caught error to console.error in
	// development. Silence it across the suite so test output stays clean.
	let consoleError: ReturnType<typeof vi.spyOn>
	afterEach(() => {
		// Unmount + clear document.body between tests so getByText on the
		// global DOM doesn't see stale fallback markup from the previous
		// case (vitest doesn't auto-cleanup the way Jest does by default).
		cleanup()
		consoleError?.mockRestore()
	})

	it("renders children when they don't throw", () => {
		const { container } = render(
			<ErrorBoundary>
				<div>healthy child</div>
			</ErrorBoundary>
		)
		expect(container.textContent).toContain("healthy child")
	})

	it("catches a thrown error and shows the default fallback", () => {
		consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
		const Boom = () => {
			throw new Error("kaboom from render")
		}
		const { container } = render(
			<ErrorBoundary>
				<Boom />
			</ErrorBoundary>
		)
		// "Try again" only exists in the fallback — it's the cleanest
		// signal that the boundary caught and rendered fallback rather
		// than letting the error propagate.
		expect(container.textContent).toContain("Try again")
		// Error message surfaces in the fallback so we can see what blew
		// up without opening devtools.
		expect(container.textContent).toContain("kaboom from render")
	})

	it("re-mounts the children when 'Try again' is clicked AFTER the throw condition clears", () => {
		consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
		// A stateful Boomer toggles its throw behavior so we can verify
		// the boundary actually re-mounts (vs. permanently latching to
		// error). We expose the setter via a ref (writing during render
		// is forbidden by react-hooks/globals) so the test can flip it
		// after the initial render captures the throw.
		const setterRef: { current: ((v: boolean) => void) | null } = {
			current: null,
		}
		const Boomer = ({ shouldThrow }: { shouldThrow: boolean }) => {
			if (shouldThrow) throw new Error("first boom")
			return <div>recovered child</div>
		}
		const Wrapper = () => {
			const [shouldThrow, setter] = useState(true)
			// Stashing the setter in an outer ref MUTATES the ref object,
			// not a closure variable — that satisfies react-hooks/globals
			// because the ref object identity stays stable.
			setterRef.current = setter
			return (
				<ErrorBoundary>
					<Boomer shouldThrow={shouldThrow} />
				</ErrorBoundary>
			)
		}
		const { container, getByText } = render(<Wrapper />)
		// Initial render throws; fallback shown.
		expect(container.textContent).toContain("Try again")
		// Fix the underlying cause, then click "Try again".
		setterRef.current!(false)
		fireEvent.click(getByText("Try again"))
		// Boundary clears its error state, re-renders children, child no
		// longer throws.
		expect(container.textContent).not.toContain("Try again")
		expect(container.textContent).toContain("recovered child")
	})

	it("supports a custom fallback render-prop", () => {
		consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
		const Boom = () => {
			throw new Error("specific message")
		}
		const { container } = render(
			<ErrorBoundary
				fallback={(err, reset) => (
					<div>
						<span>custom: {err.message}</span>
						<button type="button" onClick={reset}>
							custom reset
						</button>
					</div>
				)}
			>
				<Boom />
			</ErrorBoundary>
		)
		expect(container.textContent).toContain("custom: specific message")
		expect(container.textContent).toContain("custom reset")
	})
})
