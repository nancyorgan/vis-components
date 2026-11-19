import { timeFormat } from "d3-time-format"

/**
 * ONE label format for a whole date axis. d3's `scale.tickFormat()` is a
 * multi-scale formatter that picks a format PER TICK — "1988" at a year
 * start, "Jul" at a month start, "04 PM" at an hour — so an axis whose
 * ticks don't all share a boundary reads as a mix of styles. Here the
 * finest calendar component any tick carries decides a single format for
 * all of them: a tick set of year starts reads "1949 … 2019", one with
 * a mid-year tick reads "Jan 1949 … Jul 2018" throughout.
 *
 * Granularities are judged on the LOCAL clock, the one `scaleTime` lays
 * its ticks on.
 */
export type TimeGranularity = "year" | "month" | "day" | "minute" | "second" | "ms"

const GRANULARITY_ORDER: TimeGranularity[] = [
	"year", "month", "day", "minute", "second", "ms",
]

/** The finest calendar component present in one date. */
const granularityOf = (d: Date): TimeGranularity => {
	if (d.getMilliseconds() !== 0) return "ms"
	if (d.getSeconds() !== 0) return "second"
	if (d.getMinutes() !== 0 || d.getHours() !== 0) return "minute"
	if (d.getDate() !== 1) return "day"
	if (d.getMonth() !== 0) return "month"
	return "year"
}

/** The finest granularity across a tick set (year when it is empty). */
export const timeGranularityOf = (dates: readonly Date[]): TimeGranularity => {
	let finest = 0
	for (const d of dates) {
		const i = GRANULARITY_ORDER.indexOf(granularityOf(d))
		if (i > finest) finest = i
	}
	return GRANULARITY_ORDER[finest]
}

/** Auto label format per granularity — readable, calendar-aware. */
const AUTO_SPEC: Record<TimeGranularity, string> = {
	year: "%Y",
	month: "%b %Y",
	day: "%b %-d, %Y",
	minute: "%b %-d, %Y %H:%M",
	second: "%b %-d, %Y %H:%M:%S",
	ms: "%b %-d, %Y %H:%M:%S.%L",
}

/** Literal ("show value as-is") format per granularity — the date's ISO
 *  calendar text, no longer than the ticks need. */
const ISO_SPEC: Record<TimeGranularity, string> = {
	year: "%Y",
	month: "%Y-%m",
	day: "%Y-%m-%d",
	minute: "%Y-%m-%d %H:%M",
	second: "%Y-%m-%d %H:%M:%S",
	ms: "%Y-%m-%d %H:%M:%S.%L",
}

/** The Auto formatter for a date axis drawing exactly these ticks. */
export const uniformTimeFormat = (dates: readonly Date[]): ((d: Date) => string) =>
	timeFormat(AUTO_SPEC[timeGranularityOf(dates)])

/** The Literal formatter for a date axis drawing exactly these ticks. */
export const uniformTimeLiteral = (dates: readonly Date[]): ((d: Date) => string) =>
	timeFormat(ISO_SPEC[timeGranularityOf(dates)])

/** Literal text for ONE date with no tick set to agree with — ISO at the
 *  date's own granularity ("1988", "1988-07", "1988-07-15 09:30"). */
export const literalDateText = (d: Date): string =>
	timeFormat(ISO_SPEC[granularityOf(d)])(d)
