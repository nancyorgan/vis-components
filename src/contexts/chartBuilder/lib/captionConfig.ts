// ---------------------------------------------------------------------------
// Caption config
// ---------------------------------------------------------------------------
//
// A single free-floating text box rendered inside the plot SVG (so it travels
// with thumbnails + image exports, which serialize only the SVG). By default
// the caption sits centered below the x-axis title; the position adjusters
// NUDGE it from that default rather than placing it from an absolute origin.
// Size and position adjusters each carry their own px/% unit — percent is
// taken against the canvas width (x / width) or height (y / height).

export type CaptionUnit = "px" | "%"

export type CaptionAlign = "left" | "center" | "right"

export type CaptionConfig = {
	/** Master switch. Even when true, an empty `text` renders nothing. */
	enabled: boolean
	/** Caption body. Long text wraps to the box width; literal `\n` forces a
	 *  break. */
	text: string

	/** Horizontal nudge from the default (centered) position. `+` moves right. */
	offsetX: number
	offsetXUnit: CaptionUnit
	/** Vertical nudge from the default (below x-axis title) position. `+` moves
	 *  down. */
	offsetY: number
	offsetYUnit: CaptionUnit

	/** Box width. `0` = auto (spans the full canvas width). */
	width: number
	widthUnit: CaptionUnit
	/** Box height. `0` = auto (grows to fit the wrapped text). */
	height: number
	heightUnit: CaptionUnit

	/** Text styling. */
	fontFamily: string
	fontSize: number
	fontWeight: number
	textColor: string
	align: CaptionAlign
	/** Inner padding between the box edge and the text, in px. */
	padding: number

	/** Background fill. `backgroundOpacity: 0` = transparent (no visible box);
	 *  there's no separate on/off toggle — opacity 0 IS "off". */
	backgroundColor: string
	backgroundOpacity: number

	/** Border. Gated by `borderEnabled` (an explicit toggle, mirroring the
	 *  Legend panel's "Border box") so the box can carry a stored width/color
	 *  without drawing until the user opts in. */
	borderEnabled: boolean
	borderColor: string
	borderWidth: number
	borderRadius: number
}

export const DEFAULT_CAPTION_CONFIG: CaptionConfig = {
	enabled: true,
	text: "",
	offsetX: 0,
	offsetXUnit: "px",
	offsetY: 0,
	offsetYUnit: "px",
	width: 0,
	widthUnit: "px",
	height: 0,
	heightUnit: "px",
	fontFamily: "system-ui, sans-serif",
	fontSize: 13,
	fontWeight: 400,
	textColor: "#44403c",
	align: "left",
	padding: 8,
	backgroundColor: "#ffffff",
	backgroundOpacity: 0,
	borderEnabled: false,
	borderColor: "#78716c",
	borderWidth: 1,
	borderRadius: 6,
}
