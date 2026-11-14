import type { ChannelConfigs } from "./channelConfig"
import type { Encodings } from "./types"

// Kept in a module of its own, free of the pattern tiles (`patterns.tsx`):
// the mark-parts rules ask this, and they are read by code that is built
// without JSX (the MCP server, the API server).

/** Whether the scatter renderer draws its marks as LINE SEGMENTS: the mode
 *  reads Length as a mark trait (`lengthRole: "mark"` — scatter, not a bar
 *  or combo mode) and either a Length variable is mapped or a default
 *  length is set. Mirrors the branch in `buildMarks` that swaps the glyph
 *  for a line. The Pattern menu, the legends and the accessibility check
 *  all gate their segment treatment on this. */
export const segmentsDrawn = (
	lengthRole: "mark" | "measure" | "none",
	encodings: Partial<Pick<Encodings, "length">>,
	channelConfigs: Pick<ChannelConfigs, "defaultLength">
): boolean =>
	lengthRole === "mark" &&
	(!!encodings.length?.field || channelConfigs.defaultLength != null)
