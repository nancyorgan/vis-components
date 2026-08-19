import type { DataLabelsConfig } from "../../lib/channelConfig"
import { buildLabelText } from "../../lib/dataLabelsStyle"
import type { GeometryBundle } from "../../lib/geo/loadGeometry"
import { resolveGeography } from "../../lib/geo/resolveGeography"
import type { RegionKeyType } from "../../lib/mapConfig"
import type { DataLabelsEncodings } from "../../lib/types"

import type { DataLabelAnchor } from "./DataLabelsLayer"

/**
 * Build the Data Labels anchors for a geographic chart: one label per map
 * region matched by the `geography` label channel, centered on the region's
 * centroid. The join is independent of the map's own `connection` field —
 * `bundle` is the geometry for the LABELS' geography level (auto-detected
 * from `geographyField`'s values), which may be coarser than the map's (state
 * labels on a county choropleth).
 *
 * Text composes exactly like the other anchor renderers (single field +
 * format spec, or the multi-field template) via `buildLabelText` on each
 * region's representative row: the FIRST row (in dataset order) among the
 * region's rows whose composed text is non-null — so a state-average column
 * that's blank on some county rows still labels from the rows that carry it.
 * Several raw values joining the same region (e.g. "TX" and "Texas") yield
 * one label. Unmatched values, regions the projection clips (albersUsa
 * outside the US), and regions outside the focus box produce no label.
 */
export const buildGeoLabelAnchors = ({
	rows,
	geographyField,
	value,
	cfg,
	hueField,
	sizeField,
	bundle,
	keyType,
	project,
	inClip,
}: {
	rows: ReadonlyArray<Record<string, unknown>>
	geographyField: string
	value: DataLabelsEncodings["value"]
	cfg: Pick<DataLabelsConfig, "decimals" | "labelTemplate" | "fieldFormats">
	hueField: string | null
	sizeField: string | null
	bundle: GeometryBundle
	/** "auto" lets resolveGeography pick the key format; the scaffold passes
	 *  the map's own `mapConfig.keyType` through when the geography field IS
	 *  the map's region field (a user who overrode auto detection for the map
	 *  needs the same override here). */
	keyType: RegionKeyType | "auto"
	project: (lonlat: [number, number]) => [number, number] | null
	inClip: (px: number, py: number) => boolean
}): DataLabelAnchor[] => {
	const values = rows.map((r) => String(r[geographyField] ?? ""))
	const { matched } = resolveGeography(
		values,
		bundle.table,
		keyType === "auto" ? undefined : keyType
	)

	// Representative row per region: first row whose composed label text is
	// non-null. A matched row with a blank value doesn't claim the region —
	// a later row carrying the value still labels it.
	const picked = new Map<string, { row: Record<string, unknown>; label: string }>()
	for (const row of rows) {
		const raw = String(row[geographyField] ?? "")
		const id = matched.get(raw)
		if (id === undefined || picked.has(id)) continue
		const label = buildLabelText(row, value, cfg, geographyField)
		if (label === null) continue
		picked.set(id, { row, label })
	}

	const anchors: DataLabelAnchor[] = []
	for (const [id, { row, label }] of picked) {
		const centroid = bundle.centroids.get(id)
		if (!centroid) continue
		// Project the [lon, lat] centroid through the coord — same seam as the
		// bubble map, so albersUsa-clipped regions drop consistently.
		const projected = project(centroid)
		if (projected === null) continue
		const [px, py] = projected
		// Drop labels outside the focus box (clipExtent only clips paths).
		if (!inClip(px, py)) continue
		anchors.push({
			key: id,
			cx: px,
			cy: py,
			label,
			hueValue: hueField ? row[hueField] : undefined,
			sizeValue: sizeField ? row[sizeField] : undefined,
			// Raw value backing the label, for the conditional text-color rules
			// (they compare the number, not its formatted string). Multi-field
			// labels have no single backing value.
			labelValue: value.field ? row[value.field] : undefined,
		})
	}
	return anchors
}
