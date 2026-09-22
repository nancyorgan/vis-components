import { describe, expect, it } from "vitest"
import {
	COALESCE_MS,
	EMPTY_HISTORY,
	MAX_STEPS,
	recordChange,
	redoHistory,
	resetHistory,
	sameDraft,
	undoHistory,
	type DraftSnapshot,
} from "./editorHistory"

/** The reducer never looks inside a snapshot, so a stub is enough. */
const snap = (name: string): DraftSnapshot =>
	({ name }) as unknown as DraftSnapshot

const T0 = 10_000

describe("recordChange", () => {
	it("seeds present without creating a step", () => {
		const h = recordChange(EMPTY_HISTORY, snap("a"), T0)
		expect(h.present).toEqual(snap("a"))
		expect(h.past).toEqual([])
	})

	it("pushes a step when the change lands after the coalesce window", () => {
		let h = resetHistory(snap("a"))
		h = recordChange(h, snap("b"), T0)
		h = recordChange(h, snap("c"), T0 + COALESCE_MS + 1)
		expect(h.past.map((s) => s.name)).toEqual(["a", "b"])
		expect(h.present?.name).toBe("c")
	})

	it("merges a burst of changes into one step", () => {
		let h = resetHistory(snap("a"))
		h = recordChange(h, snap("b"), T0)
		h = recordChange(h, snap("c"), T0 + 100)
		h = recordChange(h, snap("d"), T0 + 200)
		expect(h.past.map((s) => s.name)).toEqual(["a"])
		expect(h.present?.name).toBe("d")
	})

	it("clears redo on a new change", () => {
		let h = resetHistory(snap("a"))
		h = recordChange(h, snap("b"), T0)
		h = undoHistory(h)
		expect(h.future.length).toBe(1)
		h = recordChange(h, snap("c"), T0 + 5000)
		expect(h.future).toEqual([])
		expect(h.past.map((s) => s.name)).toEqual(["a"])
	})

	it("drops the oldest step past the cap", () => {
		let h = resetHistory(snap("0"))
		for (let i = 1; i <= MAX_STEPS + 5; i++) {
			h = recordChange(h, snap(String(i)), T0 + i * (COALESCE_MS + 1))
		}
		expect(h.past.length).toBe(MAX_STEPS)
		expect(h.past[0].name).toBe("5")
		expect(h.present?.name).toBe(String(MAX_STEPS + 5))
	})
})

describe("undo / redo", () => {
	it("walks back and forward through the steps", () => {
		let h = resetHistory(snap("a"))
		h = recordChange(h, snap("b"), T0)
		h = recordChange(h, snap("c"), T0 + 5000)
		h = undoHistory(h)
		expect(h.present?.name).toBe("b")
		h = undoHistory(h)
		expect(h.present?.name).toBe("a")
		expect(h.future.map((s) => s.name)).toEqual(["b", "c"])
		h = redoHistory(h)
		expect(h.present?.name).toBe("b")
		h = redoHistory(h)
		expect(h.present?.name).toBe("c")
		expect(h.future).toEqual([])
	})

	it("returns the same history when there is nothing to do", () => {
		const h = resetHistory(snap("a"))
		expect(undoHistory(h)).toBe(h)
		expect(redoHistory(h)).toBe(h)
		expect(undoHistory(EMPTY_HISTORY)).toBe(EMPTY_HISTORY)
	})

	it("does not merge the next change into an undone state", () => {
		let h = resetHistory(snap("a"))
		h = recordChange(h, snap("b"), T0)
		h = undoHistory(h)
		// Immediately after the undo — well inside the coalesce window of
		// the last recorded change, had the clock not been reset.
		h = recordChange(h, snap("c"), T0 + 10)
		expect(h.past.map((s) => s.name)).toEqual(["a"])
		expect(h.present?.name).toBe("c")
	})
})

describe("sameDraft", () => {
	it("treats structurally equal snapshots as the same", () => {
		const a = { name: "x", encodings: { x: { field: "f" } } }
		const b = { name: "x", encodings: { x: { field: "f" } } }
		expect(
			sameDraft(a as unknown as DraftSnapshot, b as unknown as DraftSnapshot)
		).toBe(true)
	})

	it("tells different snapshots apart", () => {
		expect(sameDraft(snap("a"), snap("b"))).toBe(false)
		expect(sameDraft(null, snap("b"))).toBe(false)
		expect(sameDraft(null, null)).toBe(true)
	})
})
