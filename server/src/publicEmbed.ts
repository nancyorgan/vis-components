/** THE PUBLIC BOUNDARY for published embeds.
 *
 *  Everything under the publish dir is on the public internet with no
 *  sign-in, and can be copied by crawlers, caches and archives forever.
 *  So: DEFAULT DENY. Nothing goes into a published page unless the embed
 *  needs it to draw the chart, and every field below is here because
 *  someone decided it should be. A stored record is never passed through
 *  whole: stored records grow fields (who saved it, where it is filed, when)
 *  that nobody meant to publish.
 *
 *  This module is the one definition of what a published page may hold:
 *   - the allowlists below, one per object in the payload
 *   - `toPublicPayload` builds a payload by PICKING those fields — the
 *     editor calls it before a publish, and the startup pass calls it on
 *     pages published before this boundary existed
 *   - `validatePublicPayload` is the enforcement: the publish route runs it
 *     on every request and answers 400 for any field not listed here, so a
 *     script calling the API directly gets the same boundary
 *
 *  What is deliberately NOT here: who saved the visual, its folder, the ids
 *  of the visual / data set / version / theme in the library, file names,
 *  timestamps, thumbnails, template links, version notes. Where the embed
 *  app needs an id to tie the pieces together it gets the fixed
 *  placeholders below, the same in every embed.
 *
 *  The listed config objects (encodings, channelConfigs, the theme's style
 *  values, ...) are the chart's own settings and are passed as they are.
 *  The data set's rows are passed as they arrive, and which COLUMNS arrive
 *  is the editor's job, not this module's: it sends only the columns the
 *  chart shows (src/contexts/chartBuilder/lib/embedColumns.ts). The server
 *  can't check that (it has no chart logic), so a page converted at startup
 *  keeps the columns it was published with until it is republished.
 *
 *  To publish a new field: add it to the list here AND to the expected list
 *  in publicEmbed.test.ts, with the reason it is needed to draw. The editor
 *  side (src/embedRuntime/payload.ts) fails the typecheck until every field
 *  of a stored visual and theme is listed as public or private.
 *
 *  No imports: the editor and the embed app import this file too. */

/** The placeholder ids, identical in every embed. */
export const EMBED_VISUAL_ID = "embed"
export const EMBED_DATASET_ID = "embed-data"
export const EMBED_VERSION_ID = "embed-version"
export const EMBED_THEME_ID = "embed-theme"

export const PUBLIC_PAYLOAD_KEYS = ["visual", "dataset", "theme", "fonts", "zctaTopology"] as const

/** The visual: its name (the page title and the data table's default
 *  title), the placeholder ids, and the settings the chart is drawn from. */
export const PUBLIC_VISUAL_KEYS = [
	"id",
	"name",
	"datasetId",
	"themeId",
	"fieldTypeOverrides",
	"encodings",
	"channelConfigs",
	"labelsConfig",
	"legendConfig",
	"tooltipConfig",
	"mapConfig",
	"reshapeConfig",
	"derivedVariablesConfig",
	"dataLabelsEncodings",
	"dataLabelsConfig",
	"fieldLevelOrders",
	"fieldLevelOrderSpecs",
	"fieldOrder",
	"annotationsConfig",
	"captionConfig",
	"dataTableConfig",
	"accessibilityConfig",
] as const

/** The data set: its columns and the one version the chart draws. */
export const PUBLIC_DATASET_KEYS = ["id", "fields", "versions", "latestVersionId"] as const

/** The one version: its rows, and what maps them onto the columns' names. */
export const PUBLIC_VERSION_KEYS = ["id", "rows", "fields", "keyAliases"] as const

/** A column: its name, type and how its values are read and shown. */
export const PUBLIC_FIELD_KEYS = [
	"name",
	"inferredType",
	"sourceNames",
	"formatHint",
	"displayCells",
	"derived",
] as const

/** A user-font face the chart's text uses, binary included. */
export const PUBLIC_FONT_KEYS = ["family", "weight", "style", "woff2Base64", "unicodeRange"] as const

/** The theme's style values (colors, fonts, sizes, palettes). Not its
 *  name or its place in the theme library. */
export const PUBLIC_THEME_STYLE_KEYS = [
	"defaultFill", "defaultRadius", "defaultOpacity", "defaultShape", "outlineColor",
	"outlineWidth", "titleFontFamily", "titleFontColor", "titlePrimarySize",
	"titleSubtitleSize", "titleSecondarySize", "titleFontBold", "titleFontItalic",
	"titleFontUnderline", "titleFontWeight", "subtitleFontWeight", "axisTitleFontWeight",
	"legendTitleFontWeight", "subtitleFontFamily", "axisTitleFontFamily",
	"legendTitleFontFamily", "axisTitleFontColor", "axisTitleFontItalic",
	"axisTitleFontUnderline", "legendTitleFontColor", "legendTitleFontSize",
	"legendTitleFontItalic", "legendTitleFontUnderline", "titlePrefixFontFamily",
	"titlePrefixFontColor", "titlePrefixFontSize", "titlePrefixFontWeight",
	"titlePrefixFontItalic", "titlePrefixFontUnderline", "titleAlignment",
	"subtitleAlignment", "legendTitleAlignment", "legendTextFontFamily",
	"legendTextFontSize", "legendTextFontWeight", "legendTextColor",
	"legendTextFontItalic", "legendTextFontUnderline", "textFontFamily", "textFontSize",
	"textFontColor", "textFontBold", "textFontItalic", "textFontUnderline",
	"textFontWeight", "categoricalPalettes", "ordinalPalettes", "linearGradients",
	"divergingGradients", "defaultCategoricalPaletteId", "defaultOrdinalPaletteId",
	"defaultTextPaletteId", "defaultFillPaletteId", "defaultGradientPalette",
	"categoricalPalette", "patternInkColor", "patternBackgroundColor", "gridlineColor",
	"gridlineThickness", "xGridlineColor", "xGridlineThickness", "yGridlineColor",
	"yGridlineThickness", "rGridlineColor", "rGridlineThickness", "tickmarkColor",
	"tickmarkThickness", "tickmarkLength", "spineColor", "spineThickness", "xSpineColor",
	"xSpineThickness", "ySpineColor", "ySpineThickness", "polarSpineColor",
	"polarSpineThickness", "textEncodingFontFamily", "textEncodingFontSize",
	"textEncodingFontWeight", "textEncodingColor", "dataLabelsFontSize",
	"dataLabelsFontWeight", "dataLabelsFontFamily", "dataLabelsColor", "dataLabelsItalic",
	"dataLabelsUnderline", "captionFontFamily", "captionFontColor", "captionFontSize",
	"captionFontWeight", "captionAlignment", "captionItalic", "captionUnderline",
	"captionPadding", "captionBackgroundColor", "captionBackgroundOpacity",
	"captionBorderEnabled", "captionBorderColor", "captionBorderWidth",
	"captionBorderRadius", "annotationFillColor", "annotationFillOpacity",
	"annotationBorderColor", "annotationBorderThickness", "annotationBorderOpacity",
	"annotationBorderDash", "annotationBorderDasharray", "annotationTextFontFamily",
	"annotationTextFontSize", "annotationTextColor", "annotationTextFontWeight",
	"annotationTextAlign", "annotationTextPadding", "annotationTextBoxFillColor",
	"annotationTextBoxFillOpacity", "annotationTextBoxBorderColor",
	"annotationTextBoxBorderThickness", "annotationTextBoxBorderOpacity",
	"annotationTextBoxBorderDash", "annotationTextBoxBorderDasharray",
	"annotationTextBoxCornerRadius", "annotationLineColor", "annotationLineThickness",
	"annotationLineOpacity", "annotationLineDash", "annotationLineDasharray",
	"mapLeaderLineColor", "mapLeaderLineThickness", "mapNoDataFill",
	"mapNoDataPatternInk", "distributionOverlayStroke", "distributionOverlayFill",
	"regressionStroke", "regressionCiFill", "connectionThickness", "connectionColor",
	"lengthMin", "lengthMax", "angleMin", "angleMax", "areaMin", "areaMax",
	"saturationMin", "saturationMax", "brightnessMin", "brightnessMax",
	"chartBackgroundColor", "panelBorderEnabled", "panelBorderWidth", "panelBorderColor",
	"legendBackgroundColor", "legendPosition", "legendOrientation", "legendShowBorder",
	"legendBorderColor", "legendBorderRadius", "legendGradientStyle", "legendPadding",
	"legendGradientBarLength", "legendGradientBarThickness", "legendGradientBarRadius",
	"legendGradientBarBorderWidth", "legendGradientBarBorderColor",
	"legendGradientBarTickLength", "legendGradientBarTickThickness",
	"legendGradientBarTickColor", "legendGradientBarLabelAlign", "legendSwatchColor",
	"legendSwatchStroke", "legendSwatchShape", "legendSwatchSize",
	"legendSwatchOutlineColor", "legendSwatchOutlineWidth", "tooltipMaxWidth",
	"tooltipCornerRadius", "tooltipOutlineColor", "tooltipBackgroundColor",
	"tooltipBackgroundOpacity", "tooltipShadowSize", "tooltipShadowColor",
	"tooltipShadowOpacity", "tooltipEnabled", "tooltipPointsOnly", "hoverEnabled",
	"hoverLegendHighlight", "hoverRecolor", "hoverHighlightColor", "hoverOutline",
	"hoverOutlineColor", "hoverOutlineWidth", "hoverFade", "hoverFadeAmount",
	"dataTableFontFamily", "dataTableFontSize", "dataTableFontWeight",
	"dataTableTextColor", "dataTableFirstColumnLikeOthers",
	"dataTableFirstColumnFontFamily", "dataTableFirstColumnFontSize",
	"dataTableFirstColumnFontWeight", "dataTableFirstColumnColor",
	"dataTableHeaderBackground", "dataTableHeaderTextColor", "dataTableHeaderFontFamily",
	"dataTableHeaderFontSize", "dataTableHeaderFontWeight", "dataTableHeaderBorderColor",
	"dataTableHeaderBorderWidth", "dataTableBorderColor", "dataTableStriped",
	"dataTableStripeColor", "dataTableNumberAlign", "dataTableTitleFontFamily",
	"dataTableTitleFontSize", "dataTableTitleColor", "dataTableTitleFontWeight",
	"dataTableTitleAlign", "dataTableCaptionFontFamily", "dataTableCaptionFontSize",
	"dataTableCaptionColor", "dataTableCaptionFontWeight", "dataTableCaptionAlign",
	"dataTableEnabled", "dataTablePlacement", "dataTableMaxRows", "dataTableShowDownload",
	"exportCanvasMargins", "exportCanvasWidth", "exportCanvasHeight", "exportMarginUnit",
] as const

export const PUBLIC_THEME_KEYS = ["id", ...PUBLIC_THEME_STYLE_KEYS] as const

type Json = Record<string, unknown>

const isRecord = (value: unknown): value is Json =>
	typeof value === "object" && value !== null && !Array.isArray(value)

/** A new object holding only the listed keys that are present. */
const pick = (source: Json, keys: readonly string[]): Json => {
	const out: Json = {}
	for (const key of keys) {
		if (source[key] !== undefined) out[key] = source[key]
	}
	return out
}

const pickEach = (list: unknown, keys: readonly string[]): unknown[] =>
	Array.isArray(list) ? list.filter(isRecord).map((item) => pick(item, keys)) : []

/** Build the public payload from the editor's records — or from an older
 *  published payload, which had the same records passed through whole. Every
 *  field is picked by name from the lists above; ids become the
 *  placeholders. The data set keeps the one version the chart draws (its
 *  latest, when handed several). Null when `source` holds no visual. */
export const toPublicPayload = (source: unknown): Json | null => {
	if (!isRecord(source) || !isRecord(source.visual)) return null

	let dataset: Json | null = null
	const stored = source.dataset
	if (isRecord(stored)) {
		const versions = Array.isArray(stored.versions) ? stored.versions.filter(isRecord) : []
		const version = versions.find((v) => v.id === stored.latestVersionId) ?? versions.at(-1)
		dataset = {
			id: EMBED_DATASET_ID,
			fields: pickEach(stored.fields, PUBLIC_FIELD_KEYS),
			versions: version
				? [
						{
							...pick(version, PUBLIC_VERSION_KEYS),
							id: EMBED_VERSION_ID,
							...(version.fields !== undefined
								? { fields: pickEach(version.fields, PUBLIC_FIELD_KEYS) }
								: {}),
						},
					]
				: [],
			latestVersionId: EMBED_VERSION_ID,
		}
	}

	const theme = isRecord(source.theme)
		? { ...pick(source.theme, PUBLIC_THEME_STYLE_KEYS), id: EMBED_THEME_ID }
		: null

	return {
		visual: {
			...pick(source.visual, PUBLIC_VISUAL_KEYS),
			id: EMBED_VISUAL_ID,
			datasetId: dataset ? EMBED_DATASET_ID : null,
			themeId: theme ? EMBED_THEME_ID : null,
		},
		dataset,
		theme,
		fonts: pickEach(source.fonts, PUBLIC_FONT_KEYS),
		...(source.zctaTopology !== undefined ? { zctaTopology: source.zctaTopology } : {}),
	}
}

const unknownKey = (where: string, value: Json, keys: readonly string[]): string | null => {
	const extra = Object.keys(value).find((key) => !keys.includes(key))
	return extra === undefined ? null : `${where} has a field that isn't public: ${extra}`
}

const checkFields = (where: string, fields: unknown): string | null => {
	if (!Array.isArray(fields)) return `${where} must be a list`
	for (const field of fields) {
		if (!isRecord(field)) return `${where} must hold objects`
		const extra = unknownKey(where, field, PUBLIC_FIELD_KEYS)
		if (extra) return extra
	}
	return null
}

/** Why `payload` may not be published, or null when it may: every object
 *  holds only its listed fields, and every id is its placeholder. */
export const validatePublicPayload = (payload: unknown): string | null => {
	if (!isRecord(payload)) return "payload must be an object"
	const { visual, dataset, theme, fonts } = payload
	let problem = unknownKey("payload", payload, PUBLIC_PAYLOAD_KEYS)
	if (problem) return problem

	if (!isRecord(visual)) return "payload.visual must be an object"
	problem = unknownKey("payload.visual", visual, PUBLIC_VISUAL_KEYS)
	if (problem) return problem
	if (visual.id !== EMBED_VISUAL_ID) return `payload.visual.id must be "${EMBED_VISUAL_ID}"`

	if (dataset === null || dataset === undefined) {
		if (visual.datasetId !== null && visual.datasetId !== undefined) {
			return "payload.visual.datasetId must be null without a data set"
		}
	} else {
		if (!isRecord(dataset)) return "payload.dataset must be an object or null"
		problem = unknownKey("payload.dataset", dataset, PUBLIC_DATASET_KEYS)
		if (problem) return problem
		if (dataset.id !== EMBED_DATASET_ID || visual.datasetId !== EMBED_DATASET_ID) {
			return `the data set's id must be "${EMBED_DATASET_ID}"`
		}
		if (dataset.latestVersionId !== EMBED_VERSION_ID) {
			return `payload.dataset.latestVersionId must be "${EMBED_VERSION_ID}"`
		}
		problem = checkFields("payload.dataset.fields", dataset.fields)
		if (problem) return problem
		const versions = dataset.versions
		if (!Array.isArray(versions) || versions.length !== 1 || !isRecord(versions[0])) {
			return "payload.dataset.versions must hold exactly one version"
		}
		const version = versions[0]
		problem = unknownKey("payload.dataset.versions[0]", version, PUBLIC_VERSION_KEYS)
		if (problem) return problem
		if (version.id !== EMBED_VERSION_ID) {
			return `the version's id must be "${EMBED_VERSION_ID}"`
		}
		if (!Array.isArray(version.rows)) return "the version's rows must be a list"
		if (version.fields !== undefined) {
			problem = checkFields("payload.dataset.versions[0].fields", version.fields)
			if (problem) return problem
		}
	}

	if (theme === null || theme === undefined) {
		if (visual.themeId !== null && visual.themeId !== undefined) {
			return "payload.visual.themeId must be null without a theme"
		}
	} else {
		if (!isRecord(theme)) return "payload.theme must be an object or null"
		problem = unknownKey("payload.theme", theme, PUBLIC_THEME_KEYS)
		if (problem) return problem
		if (theme.id !== EMBED_THEME_ID || visual.themeId !== EMBED_THEME_ID) {
			return `the theme's id must be "${EMBED_THEME_ID}"`
		}
	}

	if (!Array.isArray(fonts)) return "payload.fonts must be a list"
	for (const font of fonts) {
		if (!isRecord(font)) return "payload.fonts must hold objects"
		problem = unknownKey("payload.fonts", font, PUBLIC_FONT_KEYS)
		if (problem) return problem
	}
	return null
}
