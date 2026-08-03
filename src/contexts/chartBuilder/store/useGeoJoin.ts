import { useMemo } from "react"

import type { GeometryBundle } from "../lib/geo/loadGeometry"
import { resolveGeography } from "../lib/geo/resolveGeography"
import type { RegionKeyType } from "../lib/mapConfig"

/**
 * Join the chart's region values against a geometry bundle and invert the
 * result into a `featureId -> data row` map.
 *
 * The region renderers iterate FEATURES (so the whole basemap can draw, or so
 * one bubble draws per matched feature), so they need the lookup in the
 * `featureId -> row` direction — the opposite of what `resolveGeography`
 * returns (`rawValue -> featureId`). This inverts it through the rows that
 * carry each raw value; the first row per raw value wins (the lookup table is
 * unique per region).
 *
 * Shared by GeoChoroplethPlot, GeoSymbolPlot, and the lat/long dot map.
 *
 * @param bundle       decoded geometry (null while loading)
 * @param regionField  the field carrying the region value (the `connection`
 *                     encoding); null when unmapped
 * @param rows         the rows being charted
 * @param keyType      `mapConfig.keyType` ("auto" -> let resolveGeography pick)
 */
export const useGeoJoin = (
	bundle: GeometryBundle | null,
	regionField: string | null | undefined,
	rows: Record<string, unknown>[],
	keyType: RegionKeyType | "auto"
): Map<string, Record<string, unknown>> =>
	useMemo<Map<string, Record<string, unknown>>>(() => {
		const out = new Map<string, Record<string, unknown>>()
		if (!bundle || !regionField) return out
		const keyTypeOverride: RegionKeyType | undefined =
			keyType === "auto" ? undefined : keyType
		const values = rows.map((r) => String(r[regionField] ?? ""))
		const { matched } = resolveGeography(values, bundle.table, keyTypeOverride)
		// First row per raw value wins (the lookup table is unique per region).
		for (const row of rows) {
			const raw = String(row[regionField] ?? "")
			const id = matched.get(raw)
			if (id === undefined) continue
			if (!out.has(id)) out.set(id, row)
		}
		return out
	}, [bundle, regionField, rows, keyType])
