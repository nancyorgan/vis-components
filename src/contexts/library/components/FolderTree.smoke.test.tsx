import { cleanup, fireEvent, render } from "@testing-library/react"
import { TestProvider } from "../../../testSupport/TestProvider"
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

const mkFolder = (id: string, parentId: string | null, name = id): Folder => ({
	id,
	name,
	parentId,
	createdAt: 1,
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

/** happy-dom's localStorage is incomplete (no .clear); install the same
 *  in-memory shim the other smoke tests use. Reinstalled per test, which
 *  also serves as the between-test reset. */
const installInMemoryLocalStorage = () => {
	const store = new Map<string, string>()
	const fakeStorage: Storage = {
		get length() {
			return store.size
		},
		clear: () => store.clear(),
		getItem: (k) => (store.has(k) ? store.get(k)! : null),
		key: (i) => [...store.keys()][i] ?? null,
		removeItem: (k) => {
			store.delete(k)
		},
		setItem: (k, v) => {
			store.set(k, String(v))
		},
	}
	Object.defineProperty(window, "localStorage", {
		value: fakeStorage,
		writable: true,
		configurable: true,
	})
	Object.defineProperty(globalThis, "localStorage", {
		value: fakeStorage,
		writable: true,
		configurable: true,
	})
}

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

/** Simulate a full same-window drag from a source element to a target. */
const dragTo = (source: HTMLElement, target: HTMLElement) => {
	const dataTransfer = makeFakeDataTransfer()
	fireEvent.dragStart(source, { dataTransfer })
	fireEvent.dragEnter(target, { dataTransfer })
	fireEvent.dragOver(target, { dataTransfer })
	fireEvent.drop(target, { dataTransfer })
	fireEvent.dragEnd(source, { dataTransfer })
}

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
