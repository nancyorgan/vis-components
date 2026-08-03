import {
	DEFAULT_CONNECTION_CONFIG,
	type ChannelConfigs,
} from "./channelConfig"
import { sampleConnectionPointIndices } from "./dataLabelsLayout"

/** Decide which marks should render a POINT MARKER when a connection field
 *  is mapped. Returns `null` when no sampling applies (every mark renders)
 *  — that lets callers skip the lookup entirely.
 *
 *  Lines/polygons themselves always pass through every point; this only
 *  filters the dots/shapes drawn at each point. The user's sampling
 *  preference is applied per connection group (so each line keeps its own
 *  first / last / every-Nth markers), with the marks sorted by `sortKey`
 *  within each group to match the line's traversal order — ScatterPlot
 *  sorts by cx (left-to-right), RadarPlot by angle (around the dial). */
export const sampleMarkersByConnection = <
	T extends { i: number; row: Record<string, unknown> },
>(
	items: readonly T[],
	connectionField: string,
	channelConfigs: ChannelConfigs,
	sortKey: (item: T) => number
): Set<number> | null => {
	const cfg = {
		...DEFAULT_CONNECTION_CONFIG,
		...channelConfigs.connection,
	}
	// Defensive coercion: a saved config from before this field existed
	// (or any persisted-state shape that nulls out `pointSampling`)
	// shouldn't accidentally fall into the every-Nth branch and silently
	// swallow most of the user's points. Treat anything unrecognized as
	// "all" — the previous behavior — so existing visualizations keep
	// rendering every point when they upgrade.
	const sampling = cfg.pointSampling ?? "all"
	if (sampling === "none") {
		// Empty set → render loop skips every point. Lines still draw.
		return new Set<number>()
	}
	if (
		sampling !== "first-only" &&
		sampling !== "last-only" &&
		sampling !== "first-and-last" &&
		sampling !== "every-n"
	) {
		// "all" (or any unrecognized value) → no filtering.
		return null
	}
	const groups = new Map<string, T[]>()
	const ungrouped: T[] = []
	for (const item of items) {
		const raw = item.row[connectionField]
		if (raw === undefined || raw === null || String(raw) === "") {
			ungrouped.push(item)
			continue
		}
		const key = String(raw)
		const list = groups.get(key) ?? []
		list.push(item)
		groups.set(key, list)
	}
	const keep = new Set<number>()
	// Marks not in any connection group keep their default behavior — they
	// don't have a line/polygon to anchor against, so filtering them away
	// would silently drop user data.
	for (const item of ungrouped) keep.add(item.i)
	for (const groupItems of groups.values()) {
		const sorted = [...groupItems].sort((a, b) => sortKey(a) - sortKey(b))
		const indices = sampleConnectionPointIndices(
			sorted.length,
			sampling,
			cfg.pointEveryN ?? 1
		)
		for (const idx of indices) {
			const item = sorted[idx]
			if (item) keep.add(item.i)
		}
	}
	return keep
}
