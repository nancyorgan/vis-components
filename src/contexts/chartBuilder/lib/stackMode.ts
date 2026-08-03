import type { ChannelConfigs, StackMode } from "./channelConfig"
import type { Encodings } from "./types"

/** Color-like channels in precedence order. The highest-precedence
 *  MAPPED channel owns the chart's stack/group/overlay layout (§15.9
 *  in APPLICATION.md). When that channel's config exposes a `stackMode`
 *  field, the resolver uses it; otherwise it falls through to the next
 *  mapped channel, finally to the default. */
export const STACK_PRECEDENCE = [
	"hue",
	"pattern",
	"brightness",
	"opacity",
	"saturation",
] as const

export type StackChannel = (typeof STACK_PRECEDENCE)[number]

/** Returns the highest-precedence mapped color channel, or `null` when
 *  none of the color-like channels is mapped. UI panels use this to
 *  decide whether to render the Stack/Group/Overlay toggle: a panel
 *  shows the toggle only when its own channel === primaryStackChannel. */
export const primaryStackChannel = (
	encodings: Encodings,
): StackChannel | null => {
	for (const ch of STACK_PRECEDENCE) {
		if (encodings[ch]?.field) return ch
	}
	return null
}

/** Resolve the chart's stack/group/overlay layout. Walks the precedence
 *  chain and returns the first MAPPED channel's `stackMode` (if its
 *  config exposes one). Falls back to "stack" — the unified default
 *  for bar and area charts. */
export const resolveStackMode = (
	channelConfigs: ChannelConfigs,
	encodings: Encodings,
): StackMode => {
	for (const ch of STACK_PRECEDENCE) {
		if (!encodings[ch]?.field) continue
		const cfg = channelConfigs[ch] as { stackMode?: StackMode } | undefined
		if (cfg && cfg.stackMode) return cfg.stackMode
	}
	return "stack"
}

export type StackModeEntry = { channel: StackChannel; mode: StackMode }

/** The layout mode for every MAPPED stack channel, in precedence order.
 *  A mapped channel with no stored `stackMode` defaults to "stack" — so a
 *  newly-added inner channel (e.g. pattern on a color-grouped chart) stacks. */
export const resolveStackModes = (
	channelConfigs: ChannelConfigs,
	encodings: Encodings,
): StackModeEntry[] => {
	const out: StackModeEntry[] = []
	for (const ch of STACK_PRECEDENCE) {
		if (!encodings[ch]?.field) continue
		const cfg = channelConfigs[ch] as { stackMode?: StackMode } | undefined
		out.push({ channel: ch, mode: cfg?.stackMode ?? "stack" })
	}
	return out
}

/** Every mapped stack channel, in precedence order (one entry per mapped
 *  channel — no configs needed, unlike `resolveStackModes`). The UI uses this
 *  to decide whether to offer per-channel layout toggles and how to label them.
 *  Channels sharing a field are all included: each still gets its own toggle,
 *  since a user may want e.g. color→group and pattern→stack on the same var. */
export const mappedStackChannels = (encodings: Encodings): StackChannel[] =>
	STACK_PRECEDENCE.filter((ch) => !!encodings[ch]?.field)
