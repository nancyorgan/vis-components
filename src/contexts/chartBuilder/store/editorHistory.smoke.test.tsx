import { act, cleanup, renderHook } from "@testing-library/react"
import { useAtomValue } from "jotai"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { TestProvider, type TestStore } from "../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../testSupport/localStorageShim"
import { currentDatasetIdAtom, currentVisualNameAtom } from "./atoms"
import {
	COALESCE_MS,
	canRedoAtom,
	canUndoAtom,
	editorHistoryEpochAtom,
	useEditorHistory,
	useRedo,
	useUndo,
} from "./editorHistory"

beforeEach(() => {
	installInMemoryLocalStorage()
	vi.spyOn(Date, "now").mockReturnValue(100_000)
})

afterEach(() => {
	cleanup()
	vi.restoreAllMocks()
})

/** Mount the history hook the way EditorLayout does, and expose the bits
 *  SaveBar reads, against a store the test can drive directly. */
const mount = (seed?: (s: TestStore) => void) => {
	const captured: { store?: TestStore } = {}
	const { result } = renderHook(
		() => {
			useEditorHistory()
			return {
				undo: useUndo(),
				redo: useRedo(),
				canUndo: useAtomValue(canUndoAtom),
				canRedo: useAtomValue(canRedoAtom),
			}
		},
		{
			wrapper: ({ children }: { children: ReactNode }) => (
				<TestProvider
					initializeState={(s) => {
						captured.store = s
						s.set(currentVisualNameAtom, "Original")
						seed?.(s)
					}}
				>
					{children}
				</TestProvider>
			),
		}
	)
	return { result, store: captured.store! }
}

/** Advance the coalescing clock past the window. */
const later = () => {
	const now = Date.now() + COALESCE_MS + 1
	vi.spyOn(Date, "now").mockReturnValue(now)
}

describe("useEditorHistory", () => {
	it("starts with nothing to undo and records a change as a step", () => {
		const { result, store } = mount()
		expect(result.current.canUndo).toBe(false)
		later()
		act(() => store.set(currentVisualNameAtom, "Edited"))
		expect(result.current.canUndo).toBe(true)
		expect(result.current.canRedo).toBe(false)
	})

	it("undo puts the draft back and redo re-applies it", () => {
		const { result, store } = mount()
		later()
		act(() => store.set(currentVisualNameAtom, "Edited"))
		act(() => {
			result.current.undo()
		})
		expect(store.get(currentVisualNameAtom)).toBe("Original")
		expect(result.current.canUndo).toBe(false)
		expect(result.current.canRedo).toBe(true)
		act(() => {
			result.current.redo()
		})
		expect(store.get(currentVisualNameAtom)).toBe("Edited")
		expect(result.current.canRedo).toBe(false)
	})

	it("coalesces a burst of changes into one step", () => {
		const { result, store } = mount()
		later()
		act(() => store.set(currentVisualNameAtom, "E"))
		act(() => store.set(currentVisualNameAtom, "Ed"))
		act(() => store.set(currentVisualNameAtom, "Edi"))
		act(() => {
			result.current.undo()
		})
		expect(store.get(currentVisualNameAtom)).toBe("Original")
		expect(result.current.canUndo).toBe(false)
	})

	it("restarts the stack when the epoch is bumped (visual load / New)", () => {
		const { result, store } = mount()
		later()
		act(() => store.set(currentVisualNameAtom, "Edited"))
		expect(result.current.canUndo).toBe(true)
		act(() => {
			store.set(currentVisualNameAtom, "Loaded")
			store.set(editorHistoryEpochAtom, (n) => n + 1)
		})
		expect(result.current.canUndo).toBe(false)
		expect(store.get(currentVisualNameAtom)).toBe("Loaded")
	})

	it("restarts the stack when the dataset changes", () => {
		const { result, store } = mount()
		later()
		act(() => store.set(currentVisualNameAtom, "Edited"))
		later()
		act(() => store.set(currentDatasetIdAtom, "another-ds"))
		expect(result.current.canUndo).toBe(false)
	})

	it("binds ⌘Z / ⌘⇧Z on the document", () => {
		const { store } = mount()
		later()
		act(() => store.set(currentVisualNameAtom, "Edited"))
		act(() => {
			document.body.dispatchEvent(
				new KeyboardEvent("keydown", { key: "z", metaKey: true, bubbles: true })
			)
		})
		expect(store.get(currentVisualNameAtom)).toBe("Original")
		act(() => {
			document.body.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "z",
					metaKey: true,
					shiftKey: true,
					bubbles: true,
				})
			)
		})
		expect(store.get(currentVisualNameAtom)).toBe("Edited")
	})

	it("leaves ⌘Z alone while a text field has focus", () => {
		const { store } = mount()
		later()
		act(() => store.set(currentVisualNameAtom, "Edited"))
		const input = document.createElement("input")
		input.type = "text"
		document.body.appendChild(input)
		act(() => {
			input.dispatchEvent(
				new KeyboardEvent("keydown", { key: "z", metaKey: true, bubbles: true })
			)
		})
		expect(store.get(currentVisualNameAtom)).toBe("Edited")
		input.remove()
	})
})
