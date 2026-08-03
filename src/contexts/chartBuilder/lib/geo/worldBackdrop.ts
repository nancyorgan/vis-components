import type { Feature } from "geojson"

import { featureId } from "./loadGeometry"

/** ISO 3166-1 numeric code for the United States. The world-countries backdrop
 *  omits it because every non-world geography level today is US-based (states;
 *  counties/zcta later): the US is drawn precisely by the foreground level's
 *  own features, and the coarse 110m US country outline would otherwise show
 *  through them. */
export const US_ISO_NUMERIC = "840"

/**
 * Features for the world-countries backdrop drawn behind a non-world map (US
 * states bubble/dot/choropleth) under a world-capable projection — every
 * country EXCEPT the foreground geography's parent country (the US today), so
 * neighbors like Canada and Mexico fill with the no-data color while the US is
 * left to the precise state geometry on top.
 *
 * Shared by every geographic renderer so the exclusion can never drift.
 */
export const worldBackdropFeatures = (features: Feature[]): Feature[] =>
	features.filter((f) => featureId(f) !== US_ISO_NUMERIC)
