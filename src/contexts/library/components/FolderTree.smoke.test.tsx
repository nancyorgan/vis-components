import { cleanup, createEvent, fireEvent, render } from "@testing-library/react"
import { TestProvider } from "../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../testSupport/localStorageShim"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { stringifyJsonDangerous } from "../../../lib/json"
import { EMPTY_CHANNEL_CONFIGS } from "../../chartBuilder/lib/channelConfig"
import { DEFAULT_LABELS_CONFIG } from "../../chartBuilder/lib/labelsConfig"
import type { Folder, Visual } from "../../chartBuilder/lib/types"
import { emptyEncodings } from "../../chartBuilder/lib/types"
import { setCurrentDrag } from "../lib/folderDnd"
import { FolderTree } from "./FolderTree"

// FolderTree only needs Link from the router; render it as a plain anchor
// so the test doesn't have to stand up a RouterProvider.
vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		// Router-only props that must not leak onto the DOM node:
		to: _to,
		params: _params,
		...rest
	}: React.PropsWithChildren<
		{ to?: string; params?: unknown } & React.AnchorHTMLAttributes<HTMLAnchorElement>
	>) => <a {...rest}>{children}</a>,
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

/* eslint-disable @th/no-storage-outside-try -- the in-memory shim cannot
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

/* eslint-enable @th/no-storage-outside-try */

const renderTree = () =>
	render(
		<TestProvider>
			<FolderTree selectedFolderId={null} onSelect={() => {}} />
		</TestProvider>
	)

/** The folder row is the [role=button] div wrapping the folder name. */
const folderRow = (container: HTMLElement, name: string): HTMLElement => {
	const rows = [...container.querySelectorAll('[role="button"]')]
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
	[...container.querySelectorAll('[role="button"]')]
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
		const { getByTitle } = renderTree()
		const link = getByTitle("Loose")
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
		const { getByTitle } = renderTree()
		fireEvent.click(getByTitle("aa"), { metaKey: true })
		fireEvent.click(getByTitle("cc"), { shiftKey: true })
		expect(getByTitle("bb").getAttribute("data-selected")).toBe("true")
	})

	it("dropping a visual on a folder row moves it into that folder", () => {
		seedStorage(
			[mkFolder("fl-a", null, "Alpha")],
			[mkVisual("vis-1", null, "Loose")]
		)
		const { container, getByTitle } = renderTree()
		dragTo(getByTitle("Loose"), folderRow(container, "Alpha"))
		expect(readStoredVisuals().find((v) => v.id === "vis-1")?.folderId).toBe(
			"fl-a"
		)
	})

	it("dragging a selected visual moves the whole selection", () => {
		seedStorage(
			[mkFolder("fl-a", null, "Alpha")],
			[mkVisual("vis-1", null, "aa"), mkVisual("vis-2", null, "bb")]
		)
		const { container, getByTitle } = renderTree()
		fireEvent.click(getByTitle("aa"), { metaKey: true })
		fireEvent.click(getByTitle("bb"), { metaKey: true })
		dragTo(getByTitle("aa"), folderRow(container, "Alpha"))
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
