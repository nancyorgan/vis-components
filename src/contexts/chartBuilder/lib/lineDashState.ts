import type { ChannelConfigs } from "./channelConfig"

// JSX-free on purpose: the "edited" dots (`lib/themeConfig.ts`) read this,
// and that module is also built for the servers.

/** True when a connecting line can draw with a dash: a Pattern variable is
 *  mapped (each category takes a dash from the cycle), or a default dash is
 *  picked — a swatch other than None, or a custom pattern.
 *
 *  The dash's follow-on options — "Apply pattern to range", "Fill dash
 *  gaps" and the gap colors — style the dash, so they are offered (and
 *  count as edits) only while this holds. With no dash there are no gaps to
 *  fill and nothing for a range to window. */
export const lineDashInEffect = (
	configs: Pick<ChannelConfigs, "connection">,
	patternMapped: boolean
): boolean =>
	patternMapped ||
	(configs.connection?.defaultDashPattern ?? "solid") !== "solid" ||
	(configs.connection?.customDashPattern ?? null) !== null
