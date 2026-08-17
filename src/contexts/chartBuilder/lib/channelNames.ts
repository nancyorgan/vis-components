/** The bare channel/field-type names, in their own module so the channel
 * registry (`lib/channels.ts`) and the app-wide type barrel (`lib/types.ts`)
 * can both depend on them without depending on each other. `types.ts` still
 * re-exports both names, so nothing outside this pair imports from here. */

export type FieldType = "quantitative" | "categorical" | "temporal" | "ordinal"

export type EncodingChannel =
	| "x"
	| "y"
	| "r"
	| "length"
	| "angle"
	| "area"
	| "saturation"
	| "hue"
	| "outlineHue"
	| "brightness"
	| "opacity"
	| "shape"
	| "pattern"
	| "connection"
	| "facet"
	| "facetRow"
	| "facetCol"
	| "text"
