import {
	atom,
	useAtomValue,
	useSetAtom,
	type Atom,
	type ExtractAtomValue,
	type Setter,
	type WritableAtom,
} from "jotai"
import { useAtomCallback } from "jotai/utils"
import { useCallback, useEffect, useRef } from "react"
import { stringifyJsonDangerous } from "../../../lib/json"

import {
	currentAnnotationsAtom,
	currentCaptionConfigAtom,
	currentChannelConfigsAtom,
	currentDataLabelsConfigAtom,
	currentDataLabelsEncodingsAtom,
	currentDatasetIdAtom,
	currentDerivedVariablesAtom,
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentFieldLevelOrderSpecsAtom,
	currentFieldOverridesAtom,
	currentLabelsAtom,
	currentLegendConfigAtom,
	currentMapConfigAtom,
	currentReshapeConfigAtom,
	currentThemeIdAtom,
	currentTooltipConfigAtom,
	currentVisualNameAtom,
} from "./atoms"

/**
 * Editor undo / redo.
 *
 * The draft is ~20 independent atoms and every change autosaves 800 ms
 * later, so there is no "unsaved" state to fall back to; undo is a history
 * of whole-draft snapshots instead. A snapshot is the 17 editable pieces of
 * a visual (everything `useSaveVisual` writes into the blob), held by
 * reference — the atoms' own objects, no copying. Undo writes a snapshot
 * back through the same atoms, and autosave then persists it like any edit.
 *
 * Not in the snapshot, by design:
 *  - the dataset binding — swapping data under encodings that name the old
 *    fields isn't a state to put the editor back into; a dataset change
 *    RESETS the stack instead;
 *  - field renames / dataset edits / version changes — they mutate the
 *    dataset and sibling visuals, not this draft;
 *  - the preview version — a viewing choice, not an edit.
 */
const DRAFT_ATOMS = {
	name: currentVisualNameAtom,
	encodings: currentEncodingsAtom,
	fieldTypeOverrides: currentFieldOverridesAtom,
	channelConfigs: currentChannelConfigsAtom,
	labelsConfig: currentLabelsAtom,
	legendConfig: currentLegendConfigAtom,
	tooltipConfig: currentTooltipConfigAtom,
	dataLabelsEncodings: currentDataLabelsEncodingsAtom,
	dataLabelsConfig: currentDataLabelsConfigAtom,
	fieldLevelOrders: currentFieldLevelOrdersAtom,
	fieldLevelOrderSpecs: currentFieldLevelOrderSpecsAtom,
	annotationsConfig: currentAnnotationsAtom,
	captionConfig: currentCaptionConfigAtom,
	mapConfig: currentMapConfigAtom,
	reshapeConfig: currentReshapeConfigAtom,
	derivedVariablesConfig: currentDerivedVariablesAtom,
	themeId: currentThemeIdAtom,
} as const

type DraftKey = keyof typeof DRAFT_ATOMS
const DRAFT_KEYS = Object.keys(DRAFT_ATOMS) as DraftKey[]

export type DraftSnapshot = {
	[K in DraftKey]: ExtractAtomValue<(typeof DRAFT_ATOMS)[K]>
}

/** The whole editable draft as one object. Recomputes whenever any piece
 * changes; the pieces themselves are shared by reference. */
export const draftSnapshotAtom = atom((get): DraftSnapshot => {
	const snap = {} as Record<DraftKey, unknown>
	// Same widening as applyDraftSnapshot: the record is heterogeneous.
	for (const k of DRAFT_KEYS) snap[k] = get(DRAFT_ATOMS[k] as Atom<unknown>)
	return snap as DraftSnapshot
})

/** Write a snapshot back into the draft atoms. */
export const applyDraftSnapshot = (set: Setter, snap: DraftSnapshot): void => {
	// The atoms are a heterogeneous record; one widening cast here beats
	// seventeen hand-written `set(...)` lines that would drift from
	// DRAFT_ATOMS.
	const setAny = set as (
		a: WritableAtom<unknown, [unknown], void>,
		v: unknown
	) => void
	for (const k of DRAFT_KEYS) {
		setAny(
			DRAFT_ATOMS[k] as unknown as WritableAtom<unknown, [unknown], void>,
			snap[k]
		)
	}
}

/** Structural equality — used to recognise the change the hook itself
 * just applied (an undo) and the no-op re-set a visual load performs, so
 * neither becomes a step. Reference check first; the stringify runs once
 * per (coalesced) user change on a few KB of config. */
export const sameDraft = (
	a: DraftSnapshot | null,
	b: DraftSnapshot | null
): boolean => {
	if (a === b) return true
	if (a === null || b === null) return false
	if (DRAFT_KEYS.every((k) => a[k] === b[k])) return true
	return stringifyJsonDangerous(a as never) === stringifyJsonDangerous(b as never)
}

// ---------------------------------------------------------------------------
// History — a pure reducer, so the rules are unit-testable.

export type EditorHistory = {
	past: DraftSnapshot[]
	/** What the draft looks like now; null until the first snapshot lands. */
	present: DraftSnapshot | null
	future: DraftSnapshot[]
	/** When the last recorded change landed — the coalescing clock. */
	lastChangeAt: number
}

/** Changes landing within this window merge into ONE step, so a slider
 * drag or a typed title undoes as a unit rather than per event. */
export const COALESCE_MS = 500
/** Oldest steps fall off past this. Snapshots share their objects with
 * the atoms, so the cap is about sanity, not memory. */
export const MAX_STEPS = 100

export const EMPTY_HISTORY: EditorHistory = {
	past: [],
	present: null,
	future: [],
	lastChangeAt: -Infinity,
}

/** Start over from `snap`: on visual load, New, or a dataset change. */
export const resetHistory = (snap: DraftSnapshot): EditorHistory => ({
	past: [],
	present: snap,
	future: [],
	lastChangeAt: -Infinity,
})

/** Record that the draft now looks like `snap`. */
export const recordChange = (
	h: EditorHistory,
	snap: DraftSnapshot,
	now: number
): EditorHistory => {
	if (h.present === null) return resetHistory(snap)
	if (now - h.lastChangeAt < COALESCE_MS) {
		return { ...h, present: snap, future: [], lastChangeAt: now }
	}
	const past = [...h.past, h.present]
	if (past.length > MAX_STEPS) past.splice(0, past.length - MAX_STEPS)
	return { past, present: snap, future: [], lastChangeAt: now }
}

/** Step back. Returns `h` itself when there is nothing to undo. The clock
 * resets so the next real change never merges into the restored state. */
export const undoHistory = (h: EditorHistory): EditorHistory => {
	if (h.present === null || h.past.length === 0) return h
	return {
		past: h.past.slice(0, -1),
		present: h.past[h.past.length - 1],
		future: [h.present, ...h.future],
		lastChangeAt: -Infinity,
	}
}

/** Step forward. Returns `h` itself when there is nothing to redo. */
export const redoHistory = (h: EditorHistory): EditorHistory => {
	if (h.present === null || h.future.length === 0) return h
	return {
		past: [...h.past, h.present],
		present: h.future[0],
		future: h.future.slice(1),
		lastChangeAt: -Infinity,
	}
}

// ---------------------------------------------------------------------------
// Atoms + hooks

/** In-memory only: the stack lives for one editor visit. */
export const editorHistoryAtom = atom<EditorHistory>(EMPTY_HISTORY)

/** Bumped by `useLoadVisual` (when the id actually changes) and
 * `useResetVisual`; `useEditorHistory` restarts the stack on it. */
export const editorHistoryEpochAtom = atom(0)

export const canUndoAtom = atom((get) => get(editorHistoryAtom).past.length > 0)
export const canRedoAtom = atom(
	(get) => get(editorHistoryAtom).future.length > 0
)

export const useUndo = () =>
	useAtomCallback(
		useCallback((get, set): boolean => {
			const h = get(editorHistoryAtom)
			const next = undoHistory(h)
			if (next === h || next.present === null) return false
			set(editorHistoryAtom, next)
			applyDraftSnapshot(set, next.present)
			return true
		}, [])
	)

export const useRedo = () =>
	useAtomCallback(
		useCallback((get, set): boolean => {
			const h = get(editorHistoryAtom)
			const next = redoHistory(h)
			if (next === h || next.present === null) return false
			set(editorHistoryAtom, next)
			applyDraftSnapshot(set, next.present)
			return true
		}, [])
	)

/** Focus in a place where ⌘Z means "undo my typing": leave it to the
 * browser. Checkboxes, radios, ranges, buttons and selects have no native
 * text undo, so the shortcut reaches the visual from those. */
export const isTextEditingTarget = (t: EventTarget | null): boolean => {
	if (!(t instanceof HTMLElement)) return false
	if (t.isContentEditable) return true
	if (t.tagName === "TEXTAREA") return true
	if (t.tagName === "INPUT") {
		const type = (t as HTMLInputElement).type
		return ![
			"checkbox",
			"radio",
			"range",
			"button",
			"submit",
			"reset",
			"color",
			"file",
		].includes(type)
	}
	return false
}

/** Mounted once by EditorLayout: records every draft change into the
 * history (coalescing bursts), restarts the stack when a visual is loaded
 * / reset or the dataset changes, and binds ⌘Z / ⌘⇧Z (Ctrl+Z / Ctrl+Y). */
export const useEditorHistory = () => {
	const snap = useAtomValue(draftSnapshotAtom)
	const epoch = useAtomValue(editorHistoryEpochAtom)
	const datasetId = useAtomValue(currentDatasetIdAtom)
	const setHistory = useSetAtom(editorHistoryAtom)
	const undo = useUndo()
	const redo = useRedo()

	// One key for both reset triggers, so a load that also changes the
	// dataset resets exactly once.
	const resetKey = `${epoch}|${datasetId ?? ""}`
	const seenResetKey = useRef<string | null>(null)

	useEffect(() => {
		if (seenResetKey.current !== resetKey) {
			seenResetKey.current = resetKey
			setHistory(resetHistory(snap))
			return
		}
		setHistory((h) =>
			sameDraft(h.present, snap) ? h : recordChange(h, snap, Date.now())
		)
	}, [snap, resetKey, setHistory])

	// Leaving the editor drops the stack: the next visit starts clean.
	useEffect(() => () => setHistory(EMPTY_HISTORY), [setHistory])

	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (!(e.metaKey || e.ctrlKey) || e.altKey) return
			const key = e.key.toLowerCase()
			const isUndo = key === "z" && !e.shiftKey
			const isRedo = (key === "z" && e.shiftKey) || (key === "y" && !e.shiftKey)
			if (!isUndo && !isRedo) return
			if (isTextEditingTarget(e.target)) return
			e.preventDefault()
			if (isUndo) undo()
			else redo()
		}
		document.addEventListener("keydown", onKeyDown)
		return () => document.removeEventListener("keydown", onKeyDown)
	}, [undo, redo])
}
