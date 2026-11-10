import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import {
	LINKED_PICTURE_HELP,
	LINKED_PICTURE_LABEL,
	LINKED_PICTURE_RETRY,
	LinkedPictureRow,
} from "./LinkedPictureRow"

/** Export modal → Embed tab → "Linked picture (experimental)": the
 *  published PNG link with its PowerPoint hint, or the retry hint when the
 *  picture step of the publish failed. */

afterEach(cleanup)

describe("LinkedPictureRow", () => {
	it("shows the picture link, the PowerPoint hint and a Copy button", () => {
		const url = "https://embeds.example.com/embeds/pub-1/image.png"
		render(<LinkedPictureRow url={url} />)
		expect(screen.getByLabelText(LINKED_PICTURE_LABEL)).toHaveProperty("value", url)
		expect(screen.getByText(LINKED_PICTURE_HELP)).toBeTruthy()
		expect(screen.getByRole("button", { name: "Copy link" })).toBeTruthy()
		expect(screen.queryByText(LINKED_PICTURE_RETRY)).toBeNull()
	})

	it("shows the retry hint when the picture didn't publish", () => {
		render(<LinkedPictureRow url={undefined} />)
		expect(screen.getByText(LINKED_PICTURE_LABEL)).toBeTruthy()
		expect(screen.getByText(LINKED_PICTURE_RETRY)).toBeTruthy()
		expect(screen.queryByText(LINKED_PICTURE_HELP)).toBeNull()
		expect(screen.queryByRole("button", { name: "Copy link" })).toBeNull()
	})

	it("shows the reason under the retry hint when this session saw the failure", () => {
		render(<LinkedPictureRow url={undefined} reason="Publishing the picture failed (HTTP 403)." />)
		expect(screen.getByText(LINKED_PICTURE_RETRY)).toBeTruthy()
		expect(screen.getByText("Publishing the picture failed (HTTP 403).")).toBeTruthy()
	})
})
