import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { TestProvider } from "../../../../testSupport/TestProvider"
import { UploadNoticeModal } from "../UploadNoticeModal"
import { DataUpload } from "./DataUpload"

// The upload-prompt modal inside DataUpload calls `useNavigate`; stubbing it
// beats standing up a RouterProvider for a notice-text assertion.
vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => () => {},
}))

/** A high-cardinality upload has to be advisory: the data is imported in full,
 *  unbinned, and the note only says charting will be slow and that
 *  pre-aggregating is the way out. It lives in a centered modal that nothing
 *  but the user can close — the real "start a new visualization" path
 *  navigates, and a note owned by the sidebar vanished on that remount. */

const csvWithDistinctPrices = (count: number) =>
	["price,cut", ...Array.from({ length: count }, (_, i) => `${i},Ideal`)].join(
		"\n"
	)

/** Mirrors the real tree: the notice modal hangs off the ROOT layout, not off
 *  the upload control, so `showSidebar` can drop DataUpload the way a route
 *  change does while the store (and the notice) stay put. */
const renderApp = () => {
	// TestProvider stays mounted across the rerender, so its store (and the
	// notice atom in it) survives DataUpload going away.
	const view = ({ showSidebar }: { showSidebar: boolean }) => (
		<TestProvider>
			{showSidebar && <DataUpload />}
			<UploadNoticeModal />
		</TestProvider>
	)
	const { rerender, container } = render(view({ showSidebar: true }))
	return {
		container,
		dropSidebar: () => rerender(view({ showSidebar: false })),
	}
}

const uploadInto = (container: HTMLElement, csv: string) => {
	const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
	const file = new File([csv], "wide.csv", { type: "text/csv" })
	Object.defineProperty(input, "files", { value: [file], configurable: true })
	fireEvent.change(input)
}

describe("upload cost notice", () => {
	afterEach(cleanup)

	it("shows an advisory note for a wide column, and waits to be dismissed", async () => {
		const { container } = renderApp()
		uploadInto(container, csvWithDistinctPrices(5001))

		const dialog = await waitFor(() => screen.getByRole("dialog"))
		expect(dialog.textContent).toContain("over 5,000 distinct values")
		expect(dialog.textContent).toContain(
			"Consider pre-aggregating data separately before importing."
		)

		// A stray backdrop click must not take the note away unread.
		fireEvent.click(dialog.parentElement!)
		expect(screen.queryByRole("dialog")).not.toBeNull()

		fireEvent.click(screen.getByText("Got it"))
		expect(screen.queryByRole("dialog")).toBeNull()
	})

	it("survives the upload control unmounting", async () => {
		const { container, dropSidebar } = renderApp()
		uploadInto(container, csvWithDistinctPrices(5001))
		await waitFor(() => screen.getByRole("dialog"))

		// What navigating to the new visualization does to the sidebar.
		dropSidebar()
		expect(screen.getByRole("dialog").textContent).toContain(
			"pre-aggregating"
		)
	})

	it("stays quiet on an ordinary upload", async () => {
		const { container } = renderApp()
		uploadInto(container, csvWithDistinctPrices(50))
		await waitFor(() => expect(container.textContent).toContain("Upload"))
		expect(screen.queryByRole("dialog")).toBeNull()
	})
})
