import type { AestheticScales } from "../store/useAestheticScales"

import type { ChannelConfigs } from "./channelConfig"
import type { MarkAesthetics } from "./resolveMarkAesthetics"
import { resolveSlotColor, slotModulationUnitsResolver } from "./resolveLayerColor"
import { modulateColor } from "./scales"

/** The resolved color of one filled radar polygon's BODY, with the pieces
 *  the pattern-def pass needs (`PatternDefItem`): the drawn fill, the
 *  pre-modulation color its pattern ink pairs on, and the sat / bri units
 *  applied. */
export type PolygonBody = {
	fill: string
	preModulationHue: string
	satUnit: number | null
	briUnit: number | null
}

/** A series' representative point (its first-by-angle row), as
 *  `resolveMarkAesthetics` resolved it. */
export type PolygonRepresentative = Pick<
	MarkAesthetics,
	"fill" | "preModulationHue" | "satUnit" | "briUnit"
> & { row: Record<string, unknown> }

/** Build the resolver for a filled radar polygon's body color, from the
 *  Polygon fill COLOR slot and its SATURATION / BRIGHTNESS slots:
 *   - every slot untouched: the body IS the series' point color — hue, fill
 *     rules and the Point fill's own sat / bri shading, byte for byte — so
 *     visuals from before the body had targets of its own render unchanged;
 *   - the color slot set ("Vary by" a field, resolved off the representative
 *     row, or a single color): that color, shaded only by the body's own
 *     sat / bri slots — the Point fill's shading belongs to the points;
 *   - only a sat / bri slot set: the point color (pre-modulation), shaded by
 *     the body's own levels instead of the points'.
 *  Shared by the renderer's polygon pass and its upfront pattern-defs pass,
 *  so a body never references a `<pattern>` def that was never emitted. */
export const polygonBodyResolver = (
	channelConfigs: ChannelConfigs,
	aestheticScales: AestheticScales
): ((rep: PolygonRepresentative) => PolygonBody) => {
	const slotCfg = channelConfigs.colorSlots?.polygonFill
	const slot = aestheticScales.colorSlots.polygonFill ?? null
	const units = slotModulationUnitsResolver(
		"polygonFill",
		channelConfigs,
		aestheticScales
	)
	return (rep) => {
		if (!slotCfg && !units) {
			return {
				fill: rep.fill,
				preModulationHue: rep.preModulationHue,
				satUnit: rep.satUnit,
				briUnit: rep.briUnit,
			}
		}
		const base = slotCfg
			? resolveSlotColor(slot, slotCfg, rep.row, rep.preModulationHue)
			: rep.preModulationHue
		const u = units
			? units(rep.row)
			: slotCfg
				? { sat: null, bri: null }
				: { sat: rep.satUnit, bri: rep.briUnit }
		const fill =
			u.sat === null && u.bri === null ? base : modulateColor(base, u.sat, u.bri)
		return { fill, preModulationHue: base, satUnit: u.sat, briUnit: u.bri }
	}
}
