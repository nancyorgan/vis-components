import { cleanup, createEvent, fireEvent, render } from "@testing-library/react"
import { TestProvider } from "../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../testSupport/localStorageShim"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { stringifyJsonDangerous } from "../../../lib/json"
import { EMPTY_CHANNEL_CONFIGS } from "../../chartBuilder/lib/channelConfig"
import {
	clearStockFolders,
	setStockFolders,
} from "../../chartBuilder/lib/stockFolders"
import { DEFAULT_LABELS_CONFIG } from "../../chartBuilder/lib/labelsConfig"
import type { Folder, Visual } from "../../chartBuilder/lib/types"
import { emptyEncodings } from "../../chartBuilder/lib/types"
import { setCurrentDrag } from "../lib/folderDnd"
import { UNFILED_FOLDER_ID } from "../lib/folderSubtree"
import type { LibraryKind } from "../lib/libraryKind"
import { FolderTree } from "./FolderTree"

// FolderTree only needs Link from the router; render it as a plain anchor
// so the test doesn't have to stand up a RouterProvider.
vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		// Router-only props that must not leak onto the DOM node:
		to,
		params: _params,
		search,
		...rest
	}: React.PropsWithChildren<
		{ to?: string; params?: unknown; search?: { templateId?: string } } & React.AnchorHTMLAttributes<HTMLAnchorElement>
	>) => (
		// Only the template target is spelled out; tests read it off href.
		<a {...rest} href={search?.templateId ? `${to}?templateId=${search.templateId}` : undefined}>
			{children}
		</a>
	),
}))

/** testing-library builds a NEW `window.DataTransfer` for every fireEvent
 *  call and copies the passed stub's OWN properties onto it. So the stub's
 *  methods must be own properties (not prototype methods) closing over one
 *  shared data map — that's what carries the payload from dragstart to drop.
 *  setDragImage must be overridden (happy-dom's throws "Not implemented");
 *  effectAllowed/dropEffect are deliberately NOT included so happy-dom's own
 *  writable fields are used (a copied `{ value }` prop would be read-only,
 *  and the component assigns to both). */
const makeFakeDataTransfer = () => {
	const data = new Map<string, string>()
	return {
		setData: (type: string, value: string) => {
			data.set(type, value)
		},
		getData: (type: string) => data.get(type) ?? "",
		setDragImage: () => {},
	}
}

const mkFolder = (
	id: string,
	parentId: string | null,
	name = id,
	sortIndex?: number
): Folder => ({
	id,
	name,
	parentId,
	createdAt: 1,
	...(sortIndex === undefined ? {} : { sortIndex }),
})

const mkVisual = (id: string, folderId: string | null, name = id): Visual => ({
	id,
	name,
	folderId,
	datasetId: null,
	createdAtVersionId: null,
	fieldTypeOverrides: {},
	encodings: emptyEncodings(),
	channelConfigs: EMPTY_CHANNEL_CONFIGS,
	labelsConfig: DEFAULT_LABELS_CONFIG,
	thumbnail: null,
	createdAt: 1,
	updatedAt: 1,
})

/* eslint-disable @vc/no-storage-outside-try -- the in-memory shim cannot
   throw, and a swallowed seeding failure would only obscure test errors */

/** Seed the persistence layer the atoms' persistEffects read on init.
 *  Folders are stored bare; visuals use the versioned envelope. */
const seedStorage = (folders: Folder[], visuals: Visual[]) => {
	window.localStorage.setItem(
		"vis-components:folders",
		stringifyJsonDangerous(folders)
	)
	window.localStorage.setItem(
		"vis-components:visuals",
		stringifyJsonDangerous({ _v: 1, data: visuals } as never)
	)
}

const readStoredVisuals = (): Visual[] => {
	const raw = window.localStorage.getItem("vis-components:visuals")
	if (raw === null) return []
	return (JSON.parse(raw) as { data: Visual[] }).data
}

const readStoredFolders = (): Folder[] => {
	const raw = window.localStorage.getItem("vis-components:folders")
	if (raw === null) return []
	return JSON.parse(raw) as Folder[]
}

/* eslint-enable @vc/no-storage-outside-try */

const renderTree = (
	onSelect: (id: string | null) => void = () => {},
	selectedFolderId: string | null = null
) =>
	render(
		<TestProvider>
			<FolderTree selectedFolderId={selectedFolderId} onSelect={onSelect} />
		</TestProvider>
	)

/** The folder row is the [data-folder-row] div wrapping the folder name. */
/** A visual's row in the tree (the draggable, selectable element). */
const queryVisualRow = (name: string): HTMLElement | null =>
	document.querySelector<HTMLElement>(`[data-visual-row="${CSS.escape(name)}"]`)
const visualRow = (name: string): HTMLElement => {
	const row = queryVisualRow(name)
	if (!row) throw new Error(`no visual row "${name}"`)
	return row
}

const folderRow = (container: HTMLElement, name: string): HTMLElement => {
	const rows = [...container.querySelectorAll("[data-folder-row]")]
	const row = rows.find((r) => r.textContent?.includes(name))
	if (!row) throw new Error(`no folder row containing "${name}"`)
	return row as HTMLElement
}

/** Simulate a full same-window drag from a source element to a target.
 *  `zone` picks where in the target row the pointer lands: happy-dom
 *  reports an all-zero rect, so a row has to be given a real one for the
 *  before/inside/after bands to exist at all. Omitting it leaves the
 *  degenerate rect, which resolves to "inside". */
const dragTo = (
	source: HTMLElement,
	target: HTMLElement,
	zone?: "before" | "inside" | "after"
) => {
	const dataTransfer = makeFakeDataTransfer()
	let clientY = 0
	if (zone) {
		const top = 100
		const height = 20
		target.getBoundingClientRect = () =>
			({ top, height, bottom: top + height, left: 0, right: 0, width: 100, x: 0, y: top }) as DOMRect
		clientY = { before: top + 1, inside: top + 10, after: top + 19 }[zone]
	}
	// happy-dom's DragEvent constructor ignores clientY, so it has to be
	// pinned onto the event object after construction or the row's
	// before/inside/after bands can't be reached at all.
	const dragEvent = (
		kind: "dragEnter" | "dragOver" | "drop",
		node: HTMLElement
	) => {
		const event = createEvent[kind](node, { dataTransfer })
		Object.defineProperty(event, "clientY", { value: clientY })
		fireEvent(node, event)
	}
	fireEvent.dragStart(source, { dataTransfer })
	dragEvent("dragEnter", target)
	dragEvent("dragOver", target)
	dragEvent("drop", target)
	fireEvent.dragEnd(source, { dataTransfer })
}

/** Folder names in the order their rows appear in the tree. */
const folderRowOrder = (container: HTMLElement, names: string[]): string[] =>
	[...container.querySelectorAll("[data-folder-row]")]
		.map((r) => names.find((n) => r.textContent?.includes(n)))
		.filter((n): n is string => n !== undefined)

beforeEach(() => {
	installInMemoryLocalStorage()
	setCurrentDrag(null)
})

afterEach(cleanup)

describe("FolderTree drag-and-drop", () => {
	it("renders seeded folders and visuals", () => {
		seedStorage(
			[mkFolder("fl-a", null, "Alpha")],
			[mkVisual("vis-1", "fl-a", "Inside"), mkVisual("vis-2", null, "Loose")]
		)
		const { getByText } = renderTree()
		expect(getByText("Alpha")).toBeTruthy()
		expect(getByText("Inside")).toBeTruthy()
		expect(getByText("Loose")).toBeTruthy()
	})

	it("cmd-click selects a visual without navigating; second cmd-click deselects", () => {
		seedStorage([], [mkVisual("vis-1", null, "Loose")])
		renderTree()
		const link = visualRow("Loose")
		fireEvent.click(link, { metaKey: true })
		expect(link.getAttribute("data-selected")).toBe("true")
		fireEvent.click(link, { metaKey: true })
		expect(link.getAttribute("data-selected")).toBeNull()
	})

	it("shift-click selects the visible range between anchor and target", () => {
		seedStorage(
			[],
			[
				mkVisual("vis-1", null, "aa"),
				mkVisual("vis-2", null, "bb"),
				mkVisual("vis-3", null, "cc"),
			]
		)
		renderTree()
		fireEvent.click(visualRow("aa"), { metaKey: true })
		fireEvent.click(visualRow("cc"), { shiftKey: true })
		expect(visualRow("bb").getAttribute("data-selected")).toBe("true")
	})

	it("dropping a visual on a folder row moves it into that folder", () => {
		seedStorage(
			[mkFolder("fl-a", null, "Alpha")],
			[mkVisual("vis-1", null, "Loose")]
		)
		const { container } = renderTree()
		dragTo(visualRow("Loose"), folderRow(container, "Alpha"))
		expect(readStoredVisuals().find((v) => v.id === "vis-1")?.folderId).toBe(
			"fl-a"
		)
	})

	it("dragging a selected visual moves the whole selection", () => {
		seedStorage(
			[mkFolder("fl-a", null, "Alpha")],
			[mkVisual("vis-1", null, "aa"), mkVisual("vis-2", null, "bb")]
		)
		const { container } = renderTree()
		fireEvent.click(visualRow("aa"), { metaKey: true })
		fireEvent.click(visualRow("bb"), { metaKey: true })
		dragTo(visualRow("aa"), folderRow(container, "Alpha"))
		const stored = readStoredVisuals()
		expect(stored).toHaveLength(2)
		expect(stored.every((v) => v.folderId === "fl-a")).toBe(true)
	})

	it("re-parents a folder dropped onto another folder", () => {
		seedStorage(
			[mkFolder("fl-a", null, "Alpha"), mkFolder("fl-b", null, "Beta")],
			[]
		)
		const { container } = renderTree()
		dragTo(folderRow(container, "Beta"), folderRow(container, "Alpha"))
		expect(readStoredFolders().find((f) => f.id === "fl-b")?.parentId).toBe(
			"fl-a"
		)
	})

	it("renders a hand-placed group in sortIndex order, not alphabetically", () => {
		seedStorage(
			[
				mkFolder("fl-a", null, "Alpha", 2),
				mkFolder("fl-b", null, "Beta", 0),
				mkFolder("fl-c", null, "Gamma", 1),
			],
			[]
		)
		const { container } = renderTree()
		expect(folderRowOrder(container, ["Alpha", "Beta", "Gamma"])).toEqual([
			"Beta",
			"Gamma",
			"Alpha",
		])
	})

	it("dropping on a row's top edge orders the folder there instead of nesting", () => {
		seedStorage(
			[
				mkFolder("fl-a", null, "Alpha"),
				mkFolder("fl-b", null, "Beta"),
				mkFolder("fl-c", null, "Gamma"),
			],
			[]
		)
		const { container } = renderTree()
		dragTo(folderRow(container, "Gamma"), folderRow(container, "Alpha"), "before")
		const stored = readStoredFolders()
		// Still a root folder — an edge drop never re-parents into the row.
		expect(stored.find((f) => f.id === "fl-c")?.parentId).toBe(null)
		expect(folderRowOrder(container, ["Alpha", "Beta", "Gamma"])).toEqual([
			"Gamma",
			"Alpha",
			"Beta",
		])
	})

	it("dropping on a row's middle still nests, and clears the hand-placed position", () => {
		seedStorage(
			[
				mkFolder("fl-a", null, "Alpha", 0),
				mkFolder("fl-b", null, "Beta", 1),
			],
			[]
		)
		const { container } = renderTree()
		dragTo(folderRow(container, "Beta"), folderRow(container, "Alpha"), "inside")
		const moved = readStoredFolders().find((f) => f.id === "fl-b")
		expect(moved?.parentId).toBe("fl-a")
		expect(moved && "sortIndex" in moved).toBe(false)
	})

	it("dropping a visual on a row INSIDE a folder moves it into that folder", () => {
		seedStorage(
			[mkFolder("fl-a", null, "Alpha")],
			[mkVisual("vis-1", null, "Loose"), mkVisual("vis-2", "fl-a", "Inside")]
		)
		renderTree()
		dragTo(visualRow("Loose"), visualRow("Inside"))
		expect(readStoredVisuals().find((v) => v.id === "vis-1")?.folderId).toBe(
			"fl-a"
		)
	})

	it("highlights the FOLDER row while a drag is over its contents", () => {
		seedStorage(
			[mkFolder("fl-a", null, "Alpha")],
			[mkVisual("vis-1", null, "Loose"), mkVisual("vis-2", "fl-a", "Inside")]
		)
		const { container } = renderTree()
		const dataTransfer = makeFakeDataTransfer()
		fireEvent.dragStart(visualRow("Loose"), { dataTransfer })
		fireEvent.dragEnter(visualRow("Inside"), { dataTransfer })
		fireEvent.dragOver(visualRow("Inside"), { dataTransfer })
		expect(folderRow(container, "Alpha").getAttribute("data-drop-zone")).toBe(
			"inside"
		)
		// The hovered row itself stays plain — the target is the folder.
		expect(visualRow("Inside").getAttribute("data-drop-zone")).toBeNull()
		fireEvent.dragLeave(visualRow("Inside"), { dataTransfer })
		expect(
			folderRow(container, "Alpha").getAttribute("data-drop-zone")
		).toBeNull()
	})

	it("dropping a visual on an unfiled row moves it to the root group", () => {
		seedStorage(
			[mkFolder("fl-a", null, "Alpha")],
			[mkVisual("vis-1", "fl-a", "Filed"), mkVisual("vis-2", null, "Loose")]
		)
		renderTree()
		dragTo(visualRow("Filed"), visualRow("Loose"))
		expect(readStoredVisuals().find((v) => v.id === "vis-1")?.folderId).toBe(
			null
		)
	})

	it("re-parents a folder dropped on a row inside another folder", () => {
		seedStorage(
			[mkFolder("fl-a", null, "Alpha"), mkFolder("fl-b", null, "Beta")],
			[mkVisual("vis-1", "fl-a", "Inside")]
		)
		const { container } = renderTree()
		dragTo(folderRow(container, "Beta"), visualRow("Inside"))
		expect(readStoredFolders().find((f) => f.id === "fl-b")?.parentId).toBe(
			"fl-a"
		)
	})

	it("refuses to drop a folder on a row inside its own descendant", () => {
		seedStorage(
			[mkFolder("fl-a", null, "Alpha"), mkFolder("fl-b", "fl-a", "Beta")],
			[mkVisual("vis-1", "fl-b", "Deep")]
		)
		const { container } = renderTree()
		dragTo(folderRow(container, "Alpha"), visualRow("Deep"))
		expect(readStoredFolders().find((f) => f.id === "fl-a")?.parentId).toBe(
			null
		)
	})

	it("refuses to drop a folder into its own descendant", () => {
		seedStorage(
			[mkFolder("fl-a", null, "Alpha"), mkFolder("fl-b", "fl-a", "Beta")],
			[]
		)
		const { container } = renderTree()
		dragTo(folderRow(container, "Alpha"), folderRow(container, "Beta"))
		expect(readStoredFolders().find((f) => f.id === "fl-a")?.parentId).toBe(
			null
		)
	})
})

describe("FolderTree selection", () => {
	it("clicking the panel's own whitespace selects the unfiled set", () => {
		seedStorage([mkFolder("fl-a", null, "Alpha")], [mkVisual("vis-1", null)])
		const onSelect = vi.fn()
		const { getByTestId } = renderTree(onSelect)
		fireEvent.click(getByTestId("folder-tree-body"))
		expect(onSelect).toHaveBeenCalledTimes(1)
		expect(onSelect).toHaveBeenCalledWith(UNFILED_FOLDER_ID)
	})

	it("clicking a folder row selects that folder, not the unfiled set", () => {
		seedStorage([mkFolder("fl-a", null, "Alpha")], [])
		const onSelect = vi.fn()
		const { container } = renderTree(onSelect)
		fireEvent.click(folderRow(container, "Alpha"))
		expect(onSelect).toHaveBeenCalledTimes(1)
		expect(onSelect).toHaveBeenCalledWith("fl-a")
	})

	it("clicking \"All visualizations\" selects everything (null)", () => {
		seedStorage([], [])
		const onSelect = vi.fn()
		const { container } = renderTree(onSelect)
		fireEvent.click(folderRow(container, "All visualizations"))
		expect(onSelect).toHaveBeenCalledTimes(1)
		expect(onSelect).toHaveBeenCalledWith(null)
	})
})

describe("entering a folder (the selected folder re-roots the tree)", () => {
	// Two top-level folders; Alpha holds a subfolder and a visual.
	const seed = () =>
		seedStorage(
			[
				mkFolder("fl-a", null, "Alpha"),
				mkFolder("fl-a1", "fl-a", "Kid"),
				mkFolder("fl-b", null, "Beta"),
			],
			[mkVisual("vis-a", "fl-a", "In alpha"), mkVisual("vis-r", null, "Loose")]
		)

	it("shows the whole tree, and no crumbs, while nothing is selected", () => {
		seed()
		const { container, getByText } = renderTree()
		expect(folderRowOrder(container, ["Alpha", "Beta"])).toEqual([
			"Alpha",
			"Beta",
		])
		expect(container.querySelector("[data-folder-crumb]")).toBeNull()
		expect(getByText("Loose")).toBeTruthy()
	})

	it("the chevron opens a folder in place without selecting it", () => {
		seed()
		const onSelect = vi.fn()
		const { getByLabelText, queryByText } = renderTree(onSelect)
		fireEvent.click(getByLabelText("Collapse Alpha"))
		expect(queryByText("Kid")).toBeNull()
		fireEvent.click(getByLabelText("Expand Alpha"))
		expect(queryByText("Kid")).toBeTruthy()
		expect(onSelect).not.toHaveBeenCalled()
	})

	it("hides the entered folder's siblings and the unfiled visuals, keeps its contents", () => {
		seed()
		const { container, getByText, queryByText } = renderTree(() => {}, "fl-a")
		expect(folderRowOrder(container, ["Alpha", "Kid", "Beta"])).toEqual(
			["Alpha", "Kid"]
		)
		// The root row is gone; "All visualizations" survives only as a crumb.
		expect(
			[...container.querySelectorAll("[data-folder-row]")].some((r) =>
				r.textContent?.includes("All visualizations")
			)
		).toBe(false)
		expect(getByText("In alpha")).toBeTruthy()
		expect(queryByText("Loose")).toBeNull()
		// The entered folder is always open: no chevron to close it with.
		expect(container.querySelector('[aria-label="Collapse Alpha"]')).toBeNull()
		expect(container.querySelector('[aria-label="Collapse Kid"]')).toBeNull()
	})

	it("a crumb trail leads back out: root, then each ancestor", () => {
		seed()
		const onSelect = vi.fn()
		const { container } = renderTree(onSelect, "fl-a1")
		const crumbs = [...container.querySelectorAll("[data-folder-crumb]")]
		expect(crumbs.map((c) => c.textContent)).toEqual([
			"All visualizations",
			"Alpha",
		])
		fireEvent.click(crumbs[1] as HTMLElement)
		expect(onSelect).toHaveBeenLastCalledWith("fl-a")
		fireEvent.click(crumbs[0] as HTMLElement)
		expect(onSelect).toHaveBeenLastCalledWith(null)
	})

	it("clicking a child folder's name selects (enters) it", () => {
		seed()
		const onSelect = vi.fn()
		const { container } = renderTree(onSelect, "fl-a")
		fireEvent.click(folderRow(container, "Kid"))
		expect(onSelect).toHaveBeenCalledWith("fl-a1")
	})

	it("an empty entered folder says so", () => {
		seedStorage([mkFolder("fl-e", null, "Empty")], [])
		const { getByText } = renderTree(() => {}, "fl-e")
		expect(getByText("Empty folder")).toBeTruthy()
	})

	it("a stale selection (deleted folder id) shows the whole tree", () => {
		seed()
		const { container } = renderTree(() => {}, "fl-gone")
		expect(folderRowOrder(container, ["Alpha", "Beta"])).toEqual([
			"Alpha",
			"Beta",
		])
	})

	it("the header's + makes the new folder inside the entered folder", () => {
		seed()
		const { getByLabelText } = renderTree(() => {}, "fl-a")
		fireEvent.click(getByLabelText("New folder in Alpha"))
		const created = readStoredFolders().find((f) => f.name === "New folder")
		expect(created?.parentId).toBe("fl-a")
	})

	it("dropping a visual on a crumb moves it up to that level", () => {
		seedStorage(
			[mkFolder("fl-a", null, "Alpha"), mkFolder("fl-a1", "fl-a", "Kid")],
			[mkVisual("vis-c", "fl-a1", "Deep")]
		)
		const { container, getByText } = renderTree(() => {}, "fl-a1")
		const crumbs = [...container.querySelectorAll("[data-folder-crumb]")]
		dragTo(
			getByText("Deep").closest("div") as HTMLElement,
			crumbs[1] as HTMLElement
		)
		expect(readStoredVisuals().find((v) => v.id === "vis-c")?.folderId).toBe(
			"fl-a"
		)
	})
})

describe("FolderTree row menu (touch/keyboard fallback for drag)", () => {
	const openMenu = (getByLabelText: (t: string) => HTMLElement, name: string) => {
		fireEvent.click(getByLabelText(`Actions for ${name}`))
	}

	it("Move down steps a folder past its next sibling", () => {
		seedStorage(
			[
				mkFolder("fl-a", null, "Alpha"),
				mkFolder("fl-b", null, "Beta"),
				mkFolder("fl-c", null, "Gamma"),
			],
			[]
		)
		const { getByLabelText, getByText, container } = renderTree()
		openMenu(getByLabelText, "Alpha")
		fireEvent.click(getByText("Move down"))
		const names = [...container.querySelectorAll("[data-folder-row]")]
			.map((r) => r.textContent?.trim())
			.filter((t) => t === "Alpha" || t === "Beta" || t === "Gamma")
		expect(names).toEqual(["Beta", "Alpha", "Gamma"])
		// Persisted as a hand-placed order, like an edge-zone drop.
		const stored = readStoredFolders()
		expect(stored.every((f) => typeof f.sortIndex === "number")).toBe(true)
	})

	it("Move up is disabled for the first sibling", () => {
		seedStorage(
			[mkFolder("fl-a", null, "Alpha"), mkFolder("fl-b", null, "Beta")],
			[]
		)
		const { getByLabelText, getByText } = renderTree()
		openMenu(getByLabelText, "Alpha")
		expect((getByText("Move up") as HTMLButtonElement).disabled).toBe(true)
		expect((getByText("Move down") as HTMLButtonElement).disabled).toBe(false)
	})

	it("Move to… lists only legal destinations and re-parents", () => {
		seedStorage(
			[
				mkFolder("fl-a", null, "Alpha"),
				mkFolder("fl-a1", "fl-a", "Alpha child"),
				mkFolder("fl-b", null, "Beta"),
			],
			[]
		)
		const { getByLabelText, getByText, queryByText, getByRole } = renderTree()
		openMenu(getByLabelText, "Alpha")
		fireEvent.click(getByText("Move to…"))
		const menu = getByRole("menu")
		// Not itself, not its own descendant, not "Top level" (already there).
		expect(queryByText("Top level")).toBeNull()
		expect(menu.textContent).not.toContain("Alpha child")
		fireEvent.click(getByText("Beta", { selector: '[role="menuitem"]' }))
		expect(readStoredFolders().find((f) => f.id === "fl-a")?.parentId).toBe(
			"fl-b"
		)
	})

	it("a visual row's pencil opens an inline editor and Enter renames it", () => {
		seedStorage([], [mkVisual("v-a", null, "Loose")])
		const { getByLabelText, container } = renderTree()
		fireEvent.click(getByLabelText("Rename Loose"))
		const input = container.querySelector('input[type="text"]') as HTMLInputElement
		expect(input).not.toBeNull()
		expect(input.value).toBe("Loose")
		fireEvent.change(input, { target: { value: "Loose renamed" } })
		fireEvent.keyDown(input, { key: "Enter" })
		expect(readStoredVisuals().find((v) => v.id === "v-a")?.name).toBe(
			"Loose renamed"
		)
	})

	it("Escape in a visual's rename box keeps the old name", () => {
		seedStorage([], [mkVisual("v-a", null, "Loose")])
		const { getByLabelText, container } = renderTree()
		fireEvent.click(getByLabelText("Rename Loose"))
		const input = container.querySelector('input[type="text"]') as HTMLInputElement
		fireEvent.change(input, { target: { value: "Nope" } })
		fireEvent.keyDown(input, { key: "Escape" })
		expect(container.querySelector('input[type="text"]')).toBeNull()
		expect(visualRow("Loose")).not.toBeNull()
		expect(readStoredVisuals().find((v) => v.id === "v-a")?.name).toBe("Loose")
	})

	it("Rename opens the inline editor", () => {
		seedStorage([mkFolder("fl-a", null, "Alpha")], [])
		const { getByLabelText, getByText, container } = renderTree()
		openMenu(getByLabelText, "Alpha")
		fireEvent.click(getByText("Rename"))
		const input = container.querySelector('input[type="text"]') as HTMLInputElement
		expect(input).not.toBeNull()
		expect(input.value).toBe("Alpha")
	})
})

describe("the stock shelf (shipped examples' folder)", () => {
	// Alphabetically FIRST, so the pin — not the sort — puts it last. The
	// library holds it under an older name; the registry's name wins.
	const stock = mkFolder("fl-stock", null, "Aardvark examples")
	const installStock = (extraFolders: Folder[], visuals: Visual[] = []) => {
		setStockFolders([stock])
		seedStorage(
			[mkFolder("fl-stock", null, "Examples"), ...extraFolders],
			[mkVisual("vis-seed", "fl-stock", "Shipped chart"), ...visuals]
		)
	}
	afterEach(clearStockFolders)

	it("renders last, in heading ink, with no action buttons", () => {
		installStock([mkFolder("fl-b", null, "Beta"), mkFolder("fl-z", null, "Zed")])
		const { container, getByText, getByLabelText, queryByLabelText } =
			renderTree()
		expect(
			folderRowOrder(container, ["Aardvark examples", "Beta", "Zed"])
		).toEqual(["Beta", "Zed", "Aardvark examples"])
		expect(getByText("Shipped chart")).toBeTruthy()
		const name = getByText("Aardvark examples")
		expect(name.className).toContain("vc-heading")
		expect(name.className).not.toContain("text-vc-brand-text")
		expect(getByLabelText("Collapse Aardvark examples").className).toContain(
			"vc-heading"
		)
		expect(queryByLabelText("Actions for Aardvark examples")).toBeNull()
		expect(queryByLabelText("New subfolder in Aardvark examples")).toBeNull()
		expect(
			folderRow(container, "Aardvark examples").getAttribute("draggable")
		).toBe("false")
	})

	it("ignores a double-click rename, while a user folder still takes one", () => {
		installStock([mkFolder("fl-b", null, "Beta")])
		const { container, getByText } = renderTree()
		const box = () => container.querySelector('input[aria-label="New folder name"]')
		fireEvent.doubleClick(getByText("Aardvark examples"))
		expect(box()).toBeNull()
		fireEvent.doubleClick(getByText("Beta"))
		expect(box()).not.toBeNull()
	})

	it("neither nests a user folder nor orders against it", () => {
		installStock([mkFolder("fl-b", null, "Beta"), mkFolder("fl-z", null, "Zed")])
		const { container } = renderTree()
		dragTo(folderRow(container, "Beta"), folderRow(container, "Aardvark examples"), "inside")
		dragTo(folderRow(container, "Beta"), folderRow(container, "Aardvark examples"), "after")
		const beta = readStoredFolders().find((f) => f.id === "fl-b")
		expect(beta?.parentId).toBeNull()
		expect(beta?.sortIndex).toBeUndefined()
		expect(
			folderRowOrder(container, ["Aardvark examples", "Beta", "Zed"])
		).toEqual(["Beta", "Zed", "Aardvark examples"])
	})

	it("still takes a visual dropped onto it", () => {
		installStock([], [mkVisual("vis-1", null, "Loose")])
		const { container } = renderTree()
		dragTo(visualRow("Loose"), folderRow(container, "Aardvark examples"))
		expect(readStoredVisuals().find((v) => v.id === "vis-1")?.folderId).toBe(
			"fl-stock"
		)
	})
})

describe("FolderTree kind filter", () => {
	const seed = () =>
		seedStorage(
			[mkFolder("fl-a", null, "Alpha"), mkFolder("fl-t", null, "Tpls")],
			[
				mkVisual("vis-1", "fl-a", "Chart"),
				{
					...mkVisual("tpl-1", "fl-t", "Starter"),
					template: { sourceFields: [], formatMemory: {} },
				},
			]
		)
	const renderKind = (kind: LibraryKind | undefined) =>
		render(
			<TestProvider>
				<FolderTree selectedFolderId={null} onSelect={() => {}} kind={kind} />
			</TestProvider>
		)

	it("lists ordinary visuals only by default", () => {
		seed()
		renderKind(undefined)
		expect(queryVisualRow("Chart")).not.toBeNull()
		expect(queryVisualRow("Starter")).toBeNull()
	})

	it("lists templates only under Templates, chipped and linked to a new visual", () => {
		seed()
		renderKind("templates")
		expect(queryVisualRow("Chart")).toBeNull()
		const row = visualRow("Starter")
		expect(row.textContent).toContain("Template")
		expect(row.querySelector("a")?.getAttribute("href")).toBe(
			"/editor/new?templateId=tpl-1"
		)
	})

	it("a move while filtered keeps the rows the filter hides", () => {
		seed()
		const { container } = renderKind("templates")
		dragTo(visualRow("Starter"), folderRow(container, "Alpha"))
		const stored = readStoredVisuals()
		expect(stored.map((v) => v.id).sort()).toEqual(["tpl-1", "vis-1"])
		expect(stored.find((v) => v.id === "tpl-1")?.folderId).toBe("fl-a")
		expect(stored.find((v) => v.id === "vis-1")?.folderId).toBe("fl-a")
	})
})
