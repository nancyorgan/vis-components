import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { installInMemoryLocalStorage } from "../../../testSupport/localStorageShim"
import { TestProvider } from "../../../testSupport/TestProvider"
import type { Folder, Visual } from "../../chartBuilder/lib/types"
import { foldersAtom, visualsAtom } from "../../chartBuilder/store/atoms"
import { TemplatePickerModal } from "./TemplatePickerModal"

/** "New from template…" picker: the rail lists only folders holding a live
 *  template, the grid shows the selected folder's templates, and a pick
 *  reports the template plus whether to carry the current data set. */

afterEach(cleanup)

const FOLDERS: Folder[] = [
	{ id: "fl-work", name: "Work", parentId: null, createdAt: 1 },
	{ id: "fl-q3", name: "Q3", parentId: "fl-work", createdAt: 1 },
	{ id: "fl-empty", name: "Empty", parentId: null, createdAt: 1 },
	{ id: "fl-plain", name: "Plain visuals", parentId: null, createdAt: 1 },
] as Folder[]

const visual = (
	id: string,
	name: string,
	folderId: string | null,
	extra: Partial<Visual> = {}
): Visual =>
	({
		id,
		name,
		folderId,
		datasetId: null,
		createdAtVersionId: null,
		thumbnail: null,
		createdAt: 1,
		updatedAt: 1,
		...extra,
	}) as unknown as Visual

const meta = (n: number): Visual["template"] => ({
	sourceFields: Array.from({ length: n }, (_, i) => ({
		name: `f${i}`,
		type: "categorical",
		kind: "category",
	})) as NonNullable<Visual["template"]>["sourceFields"],
	formatMemory: {},
})

const VISUALS: Visual[] = [
	visual("t-bar", "Bar template", "fl-q3", {
		template: meta(2),
		thumbnail: "data:image/png;base64,AAAA",
	}),
	visual("t-root", "Root template", null, { template: meta(1) }),
	visual("t-gone", "Trashed template", "fl-empty", {
		template: meta(3),
		deletedAt: 5,
	} as Partial<Visual>),
	visual("v-plain", "Plain visual", "fl-plain"),
]

const mount = (
	visuals: Visual[],
	props: { currentDatasetName?: string } = {}
) => {
	installInMemoryLocalStorage()
	const onPick = vi.fn()
	const onClose = vi.fn()
	render(
		<TestProvider
			initializeState={(s) => {
				s.set(visualsAtom, visuals)
				s.set(foldersAtom, FOLDERS)
			}}
		>
			<TemplatePickerModal
				open
				onClose={onClose}
				onPick={onPick}
				{...props}
			/>
		</TestProvider>
	)
	return { onPick, onClose }
}

const cardNames = () =>
	within(screen.getByRole("list", { name: "Templates" }))
		.queryAllByRole("button")
		.map((b) => b.textContent)

describe("TemplatePickerModal", () => {
	it("rails only folders holding a live template; cards follow the rail", () => {
		mount(VISUALS)
		const rail = screen.getByRole("navigation", { name: "Template folders" })
		const railItems = within(rail)
			.getAllByRole("button")
			.map((b) => b.textContent)
		// Work holds Q3's template in its subtree; Empty holds only a trashed
		// one; Plain visuals holds no template.
		expect(railItems).toEqual(["All templates", "Work", "Q3"])

		expect(cardNames()).toEqual([
			"Bar template2 fields",
			"No previewRoot template1 field",
		])
		expect(document.querySelectorAll("img")).toHaveLength(1)

		fireEvent.click(within(rail).getByText("Q3"))
		expect(cardNames()).toEqual(["Bar template2 fields"])
	})

	it("picks the selected card; Use template waits for a selection", () => {
		const { onPick } = mount(VISUALS)
		const use = screen.getByRole("button", { name: "Use template" })
		expect((use as HTMLButtonElement).disabled).toBe(true)
		expect(screen.queryByLabelText(/Use the current data set/)).toBeNull()

		fireEvent.click(screen.getByText("Root template"))
		expect((use as HTMLButtonElement).disabled).toBe(false)
		fireEvent.click(use)
		expect(onPick).toHaveBeenCalledWith("t-root", false)
	})

	it("double-click picks; the checkbox carries the current data set", () => {
		const { onPick } = mount(VISUALS, { currentDatasetName: "Q3 Sales" })
		const box = screen.getByLabelText(
			"Use the current data set (Q3 Sales)"
		) as HTMLInputElement
		expect(box.checked).toBe(false)
		fireEvent.doubleClick(screen.getByText("Bar template"))
		expect(onPick).toHaveBeenLastCalledWith("t-bar", false)

		fireEvent.click(box)
		fireEvent.doubleClick(screen.getByText("Bar template"))
		expect(onPick).toHaveBeenLastCalledWith("t-bar", true)
	})

	it("Enter on a card picks it", () => {
		const { onPick } = mount(VISUALS)
		const card = screen.getByText("Root template").closest("button")!
		fireEvent.keyDown(card, { key: "Enter" })
		expect(onPick).toHaveBeenCalledWith("t-root", false)
	})

	it("shows the empty state without live templates", () => {
		mount([VISUALS[2]!, VISUALS[3]!], { currentDatasetName: "Q3 Sales" })
		expect(
			screen.getByText(
				"No templates yet. Save one from the editor's Save menu."
			)
		).toBeTruthy()
		expect(screen.queryByRole("navigation")).toBeNull()
		expect(screen.queryByLabelText(/Use the current data set/)).toBeNull()
	})
})
