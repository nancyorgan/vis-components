import type { AxisConfig, MirrorAxisConfig } from "./channelConfig"
import { parseValue } from "./scales"
import { applyLevelOrder } from "./smartSort"
import type { FieldType } from "./types"

type Row = Record<string, unknown>

/** Which value of the direction field draws on which side of zero. The
 * first level (pinned order, else first-seen) goes NEGATIVE — left on a
 * horizontal measure axis, down on a vertical one. */
export type MirrorDirection = {
	field: string
	/** The direction field's effective type — levels are compared as
	 * `String(parseValue(raw, type))`, so a temporal or numeric field
	 * matches the same way it was discovered. */
	type: FieldType
	negativeLevel: string
	positiveLevel: string
}

/** The two levels of `field`, in display order, or `null` when the field
 * doesn't have EXACTLY two distinct non-blank values in `rows`. Levels are
 * discovered over the whole dataset (never a facet panel's subset) so every
 * panel agrees on which side each value belongs to. */
export const twoLevelsOf = (
	rows: ReadonlyArray<Row>,
	field: string,
	type: FieldType,
	pinnedOrder: readonly string[] | undefined
): [string, string] | null => {
	const discovered = [
		...new Set(
			rows
				.map((r) => parseValue(r[field], type))
				.filter((v) => v !== null)
				.map(String)
		),
	]
	if (discovered.length !== 2) return null
	// Pinned order from the Fields panel wins; otherwise first-seen order,
	// matching the legend (`orderCategories`) — never smart-sorted, so the
	// side each level lands on is the one the legend lists first.
	const ordered =
		pinnedOrder && pinnedOrder.length > 0
			? applyLevelOrder(discovered, type, pinnedOrder)
			: discovered
	return [ordered[0], ordered[1]]
}

/** Names of the fields eligible as a mirror direction: exactly two distinct
 * non-blank values across the dataset. */
export const twoLevelFieldNames = (
	rows: ReadonlyArray<Row>,
	fields: ReadonlyArray<{ name: string }>,
	getType: (name: string) => FieldType
): string[] =>
	fields
		.filter((f) => twoLevelsOf(rows, f.name, getType(f.name), undefined) !== null)
		.map((f) => f.name)

/** Resolve the mirror's direction, or `null` when the mirror is off, no
 * direction is chosen, or the chosen field no longer has exactly two levels
 * (bars then render unmirrored). */
export const resolveMirrorDirection = (
	mirror: MirrorAxisConfig | undefined,
	rows: ReadonlyArray<Row>,
	getType: (name: string) => FieldType,
	levelOrders: Partial<Record<string, readonly string[]>>
): MirrorDirection | null => {
	if (!mirror?.enabled || !mirror.directionField) return null
	const field = mirror.directionField
	const type = getType(field)
	const levels = twoLevelsOf(rows, field, type, levelOrders[field])
	if (!levels) return null
	return { field, type, negativeLevel: levels[0], positiveLevel: levels[1] }
}

/** Copy `rows` with `measureField` negated on rows whose direction value is
 * the negative level. Blank / non-numeric measures pass through untouched
 * (the aggregator drops them anyway). The rows themselves are never
 * mutated. The direction value is parsed with the field's type before the
 * string compare, mirroring `twoLevelsOf` — so "1.0" matches level "1" and
 * a temporal direction matches its Date string. */
export const applyMirrorSign = <R extends Row>(
	rows: ReadonlyArray<R>,
	measureField: string,
	direction: MirrorDirection
): R[] =>
	rows.map((row) => {
		const dir = parseValue(row[direction.field], direction.type)
		if (dir === null || String(dir) !== direction.negativeLevel) return row
		const raw = row[measureField]
		if (raw == null) return row
		const n = typeof raw === "number" ? raw : Number(raw)
		if (!Number.isFinite(n)) return row
		if (typeof raw === "string" && raw.trim() === "") return row
		// Sign-flip; `-0` would print as "0" but keep the value a plain 0 so
		// the zero baseline check (`value < 0`) doesn't see a negative zero.
		return { ...row, [measureField]: n === 0 ? 0 : -n }
	})

/** Mirror a list of tick-break magnitudes around 0: each `b` yields `-|b|`
 * and `+|b|` (0 once). Sorted ascending, de-duplicated. */
export const mirrorTickBreaks = (breaks: readonly number[] | undefined): number[] => {
	if (!breaks || breaks.length === 0) return []
	const out = new Set<number>()
	for (const b of breaks) {
		if (!Number.isFinite(b)) continue
		const m = Math.abs(b)
		out.add(m)
		out.add(m === 0 ? 0 : -m)
	}
	return [...out].sort((a, b) => a - b)
}

/** The user-pinned domain bounds an axis config asks for: the mirror's
 * side maxes while the mirror is on (its negative max becomes the domain
 * MIN, negated), else the plain Scale range min/max. `undefined` = auto. */
export const pinnedAxisBounds = (
	config: AxisConfig | undefined,
	mirrorActive: boolean
): { min: number | undefined; max: number | undefined } => {
	if (mirrorActive && config?.mirror?.enabled) {
		const neg = config.mirror.negativeMax
		const pos = config.mirror.positiveMax
		return {
			min: neg === null || neg === undefined ? undefined : -Math.abs(neg),
			max: pos === null || pos === undefined ? undefined : Math.abs(pos),
		}
	}
	return { min: config?.min ?? undefined, max: config?.max ?? undefined }
}
