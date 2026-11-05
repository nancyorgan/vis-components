import type { ChannelConfigs } from "../channelConfig"
import { CHANNELS } from "../channels"
import type { EncodingChannel } from "../channelNames"
import type { FormatSurfaceKey } from "../types"
import type { TemplateBody } from "./buildTemplateBody"

/** The units "Update template" lets the user pick: one per sidebar panel
 * (or per channel option panel inside Encodings), each owning a slice of
 * the template body plus the format-memory surfaces it formats. */
export type TemplateSectionId =
	| "encodings"
	| "xAxis"
	| "yAxis"
	| "rAxis"
	| "angle"
	| "length"
	| "area"
	| "color"
	| "modulation"
	| "shapePattern"
	| "connection"
	| "facets"
	| "titles"
	| "legend"
	| "dataLabels"
	| "tooltips"
	| "caption"
	| "dataTable"
	| "annotations"
	| "maps"
	| "aesthetics"
	| "accessibility"

/** Display order and labels — the sidebar's own vocabulary. */
export const TEMPLATE_SECTIONS: ReadonlyArray<{
	id: TemplateSectionId
	label: string
}> = [
	{ id: "encodings", label: "Encodings" },
	{ id: "xAxis", label: "X axis" },
	{ id: "yAxis", label: "Y axis" },
	{ id: "rAxis", label: "Radial axis" },
	{ id: "angle", label: "Angle" },
	{ id: "length", label: "Length" },
	{ id: "area", label: "Size" },
	{ id: "color", label: "Color" },
	{ id: "modulation", label: "Saturation, brightness & opacity" },
	{ id: "shapePattern", label: "Shape & pattern" },
	{ id: "connection", label: "Connection" },
	{ id: "facets", label: "Facets" },
	{ id: "titles", label: "Titles" },
	{ id: "legend", label: "Legend" },
	{ id: "dataLabels", label: "Data labels" },
	{ id: "tooltips", label: "Tooltips and hover" },
	{ id: "caption", label: "Caption" },
	{ id: "dataTable", label: "Data table" },
	{ id: "annotations", label: "Annotations" },
	{ id: "maps", label: "Maps" },
	{ id: "aesthetics", label: "Aesthetics & theme" },
	{ id: "accessibility", label: "Accessibility" },
]

export const ALL_TEMPLATE_SECTIONS: ReadonlySet<TemplateSectionId> = new Set(
	TEMPLATE_SECTIONS.map((s) => s.id),
)

export const templateSectionLabel = (id: TemplateSectionId): string =>
	TEMPLATE_SECTIONS.find((s) => s.id === id)?.label ?? id

/** Which section each top-level body key belongs to. `null` = a constant
 * in every template body (`buildTemplateBody` resets it), so never diffed.
 * `channelConfigs` is split per key below. `Required` keeps this
 * exhaustive: a new `Visual` field fails to type-check until it is
 * placed. */
export const BODY_KEY_SECTIONS: Required<
	Record<keyof TemplateBody, TemplateSectionId | "channelConfigs" | null>
> = {
	datasetId: null,
	createdAtVersionId: null,
	reshapeConfig: null,
	derivedVariablesConfig: null,
	fieldLevelOrders: null,
	fieldLevelOrderSpecs: null,
	fieldOrder: null,
	encodings: "encodings",
	fieldTypeOverrides: "encodings",
	channelConfigs: "channelConfigs",
	labelsConfig: "titles",
	legendConfig: "legend",
	tooltipConfig: "tooltips",
	mapConfig: "maps",
	dataLabelsEncodings: "dataLabels",
	dataLabelsConfig: "dataLabels",
	themeId: "aesthetics",
	annotationsConfig: "annotations",
	captionConfig: "caption",
	dataTableConfig: "dataTable",
	accessibilityConfig: "accessibility",
}

/** Which section each `channelConfigs` key belongs to (exhaustive). */
export const CHANNEL_CONFIG_SECTIONS: Required<
	Record<keyof ChannelConfigs, TemplateSectionId>
> = {
	x: "xAxis",
	y: "yAxis",
	r: "rAxis",
	area: "area",
	hue: "color",
	hueQuantStash: "color",
	hueCategoricalStash: "color",
	outlineHue: "color",
	saturation: "modulation",
	brightness: "modulation",
	opacity: "modulation",
	shape: "shapePattern",
	pattern: "shapePattern",
	length: "length",
	angle: "angle",
	connection: "connection",
	facet: "facets",
	text: "encodings",
	hexbin: "color",
	defaultFill: "color",
	fillColorRules: "color",
	defaultRadius: "shapePattern",
	defaultOpacity: "modulation",
	defaultShape: "shapePattern",
	defaultSaturation: "modulation",
	defaultBrightness: "modulation",
	defaultPattern: "shapePattern",
	defaultPatternInk: "shapePattern",
	defaultAngle: "angle",
	defaultLength: "length",
	categoricalPaletteId: "color",
	categoricalPalette: "color",
	categoricalPalettePatternInks: "color",
	ordinalPaletteId: "color",
	ordinalPalette: "color",
	ordinalPalettePatternInks: "color",
	outlineCategoricalPaletteId: "color",
	outlineCategoricalPalette: "color",
	outlineOrdinalPaletteId: "color",
	outlineOrdinalPalette: "color",
	defaultGradientId: "color",
	defaultGradientColors: "color",
	patternInkColor: "shapePattern",
	backgroundColor: "aesthetics",
	scrollMode: "aesthetics",
	drawOrder: "aesthetics",
	axesBehindMarks: "aesthetics",
	aspectRatio: "aesthetics",
	canvasSize: "aesthetics",
	panelBorder: "aesthetics",
	colorSlots: "color",
	opacitySlots: "modulation",
	saturationSlots: "modulation",
	brightnessSlots: "modulation",
}

/** The section a format-memory surface reports to and merges with. */
export const formatSurfaceSection = (
	key: FormatSurfaceKey,
): TemplateSectionId => {
	if (key.startsWith("legend:")) return "legend"
	if (key.startsWith("labels:")) return "dataLabels"
	switch (key) {
		case "axis:x":
			return "xAxis"
		case "axis:y":
			return "yAxis"
		case "axis:r":
			return "rAxis"
		case "axis:angle":
			return "angle"
		case "axis:chord":
			return "connection"
		default:
			return "encodings"
	}
}

/** Prose name of a format surface, for the change summary. */
export const formatSurfaceLabel = (key: FormatSurfaceKey): string => {
	if (key.startsWith("legend:")) {
		const ch = key.slice("legend:".length) as EncodingChannel
		const label = CHANNELS[ch]?.label ?? ch
		return `${label} legend`
	}
	if (key === "labels:value") return "data labels"
	if (key.startsWith("labels:value:")) {
		const i = Number(key.slice("labels:value:".length))
		return `data labels (variable ${Number.isFinite(i) ? i + 1 : key})`
	}
	switch (key) {
		case "axis:x":
			return "X axis"
		case "axis:y":
			return "Y axis"
		case "axis:r":
			return "radial axis"
		case "axis:angle":
			return "angle axis"
		case "axis:chord":
			return "chord axis"
		default:
			return key
	}
}
