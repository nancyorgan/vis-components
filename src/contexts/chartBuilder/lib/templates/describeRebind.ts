import { CHANNELS } from "../channels"
import type { RebindResult } from "./rebind"

/** One-line banner text for a template snap: the renamed pairs, then the
 * encoding slots that found nothing, e.g.
 * "Template applied: Date → Period, Spend → Rate · Facet: no match — pick a field".
 * Same-name matches aren't listed; when every field matched by name (and
 * nothing is missing) it says so. Template fields referenced only outside
 * the encodings aren't slots, so an unmatched one isn't named. */
export const describeRebind = (
	result: Pick<RebindResult<unknown>, "mapping" | "unmatched">,
): string => {
	const pairs = Object.entries(result.mapping)
		.filter((e): e is [string, string] => e[1] !== null && e[1] !== e[0])
		.map(([from, to]) => `${from} → ${to}`)
	const slots = [
		...new Set(
			result.unmatched.flatMap((u) => u.channels.map((ch) => CHANNELS[ch].label)),
		),
	]
	const head =
		pairs.length > 0
			? `Template applied: ${pairs.join(", ")}`
			: Object.values(result.mapping).every((v) => v !== null)
				? "Template applied: all fields matched by name"
				: "Template applied"
	return slots.length > 0
		? `${head} · ${slots.join(", ")}: no match — pick a field`
		: head
}
