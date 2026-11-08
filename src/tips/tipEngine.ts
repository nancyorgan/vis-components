/**
 * Pacing for the tip catalog (tips.ts): which moment may show right now,
 * and what to remember once it has. Pure functions over a small state
 * record; TipHost reads/writes the record and supplies the signals.
 */
import {
	ARRIVAL_GAP_MINUTES,
	LATER_GAP_MINUTES,
	SIGHT_GAP_SECONDS,
	SOON_GAP_MINUTES,
	type TipMoment,
	type TipPage,
	type TipSignals,
} from "./tips"

export type TipState = {
	/** Moments already shown (finished or dismissed). */
	done: string[]
	/** When the last moment closed (ms epoch), or null if none yet. */
	lastClosedAt: number | null
	/** The visit that last showed any moment. */
	lastShownVisit: string | null
	/** The page arrival that last showed any moment. */
	lastShownArrival: string | null
	visits: number
	editorVisited: boolean
	chartMade: boolean
	/** Tips are off (only via the `?tips=off` preview switch). */
	off: boolean
}

export const EMPTY_TIP_STATE: TipState = {
	done: [],
	lastClosedAt: null,
	lastShownVisit: null,
	lastShownArrival: null,
	visits: 0,
	editorVisited: false,
	chartMade: false,
	off: false,
}

export type PaceContext = {
	now: number
	visitId: string
	/** This arrival on the current page (new each time it's navigated to). */
	arrivalId: string
	/** `?tips=fast`: ignore the pace waits (conditions still apply). */
	fast: boolean
}

const MINUTE = 60_000

/** Whether `moment`'s pace lets it show now. */
export const paceAllows = (
	moment: TipMoment,
	state: TipState,
	ctx: PaceContext
): boolean => {
	if (ctx.fast || moment.pace === "now") return true
	const sinceClose =
		state.lastClosedAt === null ? Infinity : ctx.now - state.lastClosedAt
	if (moment.pace === "soon") return sinceClose >= SOON_GAP_MINUTES * MINUTE
	if (moment.pace === "sight") return sinceClose >= SIGHT_GAP_SECONDS * 1000
	if (moment.pace === "arrival")
		return (
			state.lastShownArrival !== ctx.arrivalId &&
			sinceClose >= ARRIVAL_GAP_MINUTES * MINUTE
		)
	// "later": never in a visit that has already shown tips (so one
	// "later" moment per visit, and never on the heels of the basics), and
	// a gap since the last tips closed.
	return (
		state.lastShownVisit !== ctx.visitId &&
		sinceClose >= LATER_GAP_MINUTES * MINUTE
	)
}

/** The moments that may show on `page` now, in catalog (priority) order.
 *  Whether their anchors are on screen is the caller's check (it needs
 *  the DOM). */
export const eligibleMoments = (
	catalog: readonly TipMoment[],
	state: TipState,
	page: TipPage,
	/** The open dialog's `tipDialog` name; "other" for an unnamed one,
	 *  null when none is open. */
	dialog: string | null,
	signals: TipSignals,
	ctx: PaceContext,
	/** The URL path, for moments that name a sub-page (`path`). */
	pathname = ""
): TipMoment[] => {
	if (state.off) return []
	return catalog.filter(
		(m) =>
			m.page === page &&
			(m.dialog ?? null) === dialog &&
			(!m.path || m.path.test(pathname)) &&
			!state.done.includes(m.id) &&
			(m.when ? m.when(signals) : true) &&
			paceAllows(m, state, ctx)
	)
}

/** Record that `moment` has closed. */
export const markMomentDone = (
	state: TipState,
	moment: TipMoment,
	ctx: PaceContext
): TipState => ({
	...state,
	done: state.done.includes(moment.id) ? state.done : [...state.done, moment.id],
	lastClosedAt: ctx.now,
	lastShownVisit: ctx.visitId,
	lastShownArrival: ctx.arrivalId,
})

/** Accepts whatever was stored, falling back field by field. */
export const parseTipState = (raw: string | null): TipState => {
	if (!raw) return { ...EMPTY_TIP_STATE }
	try {
		const v = JSON.parse(raw) as Partial<TipState> | null
		if (!v || typeof v !== "object") return { ...EMPTY_TIP_STATE }
		return {
			...EMPTY_TIP_STATE,
			...v,
			done: Array.isArray(v.done)
				? v.done.filter((d): d is string => typeof d === "string")
				: [],
		}
	} catch {
		return { ...EMPTY_TIP_STATE }
	}
}
