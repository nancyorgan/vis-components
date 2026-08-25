import { cleanup, fireEvent, render, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { DownloadVisualsButton } from "./DownloadVisualsButton"

const buildBundleForVisuals = vi.fn()

// Only the bundle BUILD is stubbed — it reads the whole library through the
// storage adapter, which this component test has no business standing up.
// The filename policy and the anchor plumbing stay real.
vi.mock("../../chartBuilder/lib/libraryBundle", async (importOriginal) => ({
	...(await importOriginal<
		typeof import("../../chartBuilder/lib/libraryBundle")
	>()),
	buildBundleForVisuals: (ids: readonly string[]) =>
		buildBundleForVisuals(ids) as unknown,
}))

const emptyBundle = {
	exportedAt: "2026-08-24T00:00:00.000Z",
	visuals: [],
	folders: [],
	datasets: {},
	themes: [],
	userDefaultThemeId: null,
}

/** Anchor clicks + object URLs aren't implemented in happy-dom; capture what
 *  the download hands the browser instead. */
const captureDownload = () => {
	const clicks: { href: string; download: string }[] = []
	const revoked: string[] = []
	vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake")
	vi.spyOn(URL, "revokeObjectURL").mockImplementation((url) => {
		revoked.push(url)
	})
	vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
		function (this: HTMLAnchorElement) {
			clicks.push({ href: this.href, download: this.download })
		}
	)
	return { clicks, revoked }
}

beforeEach(() => {
	buildBundleForVisuals.mockReset()
	buildBundleForVisuals.mockResolvedValue(emptyBundle)
})

afterEach(() => {
	cleanup()
	vi.restoreAllMocks()
})

describe("DownloadVisualsButton", () => {
	it("downloads one selected visual under its sanitized name", async () => {
		const { clicks, revoked } = captureDownload()
		const { getByRole } = render(
			<DownloadVisualsButton selected={[{ id: "vs-1", name: "Q3 Revenue!" }]} />
		)
		fireEvent.click(getByRole("button", { name: "Download" }))
		await waitFor(() => expect(clicks.length).toBe(1))
		expect(buildBundleForVisuals).toHaveBeenCalledWith(["vs-1"])
		expect(clicks[0]?.download).toBe("q3-revenue.json")
		expect(revoked).toEqual(["blob:fake"])
	})

	it("downloads a multi-selection as the generic bundle file", async () => {
		const { clicks } = captureDownload()
		const { getByRole } = render(
			<DownloadVisualsButton
				selected={[
					{ id: "vs-1", name: "One" },
					{ id: "vs-2", name: "Two" },
				]}
			/>
		)
		fireEvent.click(getByRole("button", { name: "Download" }))
		await waitFor(() => expect(clicks.length).toBe(1))
		expect(buildBundleForVisuals).toHaveBeenCalledWith(["vs-1", "vs-2"])
		expect(clicks[0]?.download).toBe("library-bundle.json")
	})

	it("reports a failure inline instead of throwing", async () => {
		captureDownload()
		buildBundleForVisuals.mockRejectedValue(new Error("storage is down"))
		const { getByRole, findByText } = render(
			<DownloadVisualsButton selected={[{ id: "vs-1", name: "One" }]} />
		)
		fireEvent.click(getByRole("button", { name: "Download" }))
		expect(await findByText(/storage is down/)).toBeTruthy()
		// Still usable afterwards.
		expect(
			(getByRole("button", { name: "Download" }) as HTMLButtonElement).disabled
		).toBe(false)
	})
})
