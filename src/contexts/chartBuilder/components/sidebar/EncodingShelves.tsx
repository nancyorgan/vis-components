import { ALL_ENCODING_CHANNELS } from "../../lib/types"

import { EncodingShelf } from "./EncodingShelf"
import { QuickStartIconBar } from "./QuickStartIconBar"

// Channels that have moved out of the main encoding shelf into their own
// dedicated sidebar sections. The underlying encoding slot stays in the
// data model for back-compat (older saved visuals still load), but the
// main shelf no longer surfaces it as a row.
//
// This is the ONLY filter on the main shelf — every other encoding
// channel is always visible regardless of chart mode. Exposing every
// channel is the product's core promise: the user explores by mapping
// fields to channels and watching the chart respond. A per-mode hide
// list (e.g. "no Connection on bar charts") was tried and removed: it
// turned the sidebar into a guessing game where users couldn't find
// channels that *might* be inert for the current mode but are exactly
// how you'd extend the chart toward a different mode.
// `outlineHue` (mark outline color) is surfaced inside the Shape panel,
// next to the universal outline color, rather than as its own shelf row —
// see ShapeOptionsPanel. It stays a first-class channel for legend/scale
// purposes; this just keeps it out of the main shelf.
const HIDDEN_FROM_MAIN_SHELF = new Set<string>(["text", "outlineHue"])

export const EncodingShelves = () => {
	return (
		<div className="flex flex-col gap-2">
			<QuickStartIconBar />
			<div className="flex flex-col gap-1.5">
				{ALL_ENCODING_CHANNELS.filter(
					(channel) => !HIDDEN_FROM_MAIN_SHELF.has(channel),
				).map((channel) => (
					<EncodingShelf key={channel} channel={channel} />
				))}
			</div>
		</div>
	)
}
