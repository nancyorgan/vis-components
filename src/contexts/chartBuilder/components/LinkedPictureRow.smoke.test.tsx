import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import {
	LINKED_PICTURE_PNG,
	LINKED_PICTURE_RETRY,
	LINKED_PICTURE_SVG,
	LinkedPictureRow,
} from "./LinkedPictureRow"

/** Export dialog → Publish → Slides & documents: the
 *  published PNG and SVG links with their PowerPoint hint, or a retry hint
 *  (with the reason this session saw) per format whose upload failed. */

afterEach(cleanup)

const PNG = "https://embeds.example.com/embeds/pub-1/image.png"
const SVG = "https://embeds.example.com/embeds/pub-1/image.svg"

describe("LinkedPictureRow", () => {
	it("shows both picture links with a Copy button per format", () => {
		render(<LinkedPictureRow imageUrl={PNG} vectorUrl={SVG} />)
		expect(screen.getByLabelText(LINKED_PICTURE_PNG)).toHaveProperty("value", PNG)
		expect(screen.getByLabelText(LINKED_PICTURE_SVG)).toHaveProperty("value", SVG)
		expect(screen.getByRole("button", { name: "Copy PNG link" })).toBeTruthy()
		expect(screen.getByRole("button", { name: "Copy SVG link" })).toBeTruthy()
		expect(screen.queryByText(LINKED_PICTURE_RETRY)).toBeNull()
	})

	it("shows the retry hint, with the reason, only for the format that failed", () => {
		render(
			<LinkedPictureRow
				imageUrl={PNG}
				vectorUrl={undefined}
				failures={{ vector: "Vector must be a plain SVG" }}
			/>
		)
		expect(screen.getByLabelText(LINKED_PICTURE_PNG)).toHaveProperty("value", PNG)
		expect(screen.getByText(LINKED_PICTURE_RETRY)).toBeTruthy()
		expect(screen.getByText("Vector must be a plain SVG")).toBeTruthy()
		expect(screen.queryByRole("button", { name: "Copy SVG link" })).toBeNull()
	})

	it("with neither picture, shows two retry hints and no Copy buttons", () => {
		render(<LinkedPictureRow imageUrl={undefined} vectorUrl={undefined} />)
		expect(screen.getAllByText(LINKED_PICTURE_RETRY)).toHaveLength(2)
		expect(screen.queryByRole("button")).toBeNull()
	})
})
