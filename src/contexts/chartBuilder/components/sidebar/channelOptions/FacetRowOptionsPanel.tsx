import { FacetAxisOptionsPanel } from "./FacetAxisOptionsPanel"

/** Options panel for the `facetRow` channel — a thin wrapper over the
 *  axis-parameterized `FacetAxisOptionsPanel`. Hosts only the row-axis-
 *  relevant controls — share, gapY, panelHeight, the sizing toggle, and
 *  per-row axis bound overrides. The "row axis" channel depends on the
 *  chart mode: y for cartesian, r for radar, none for pies (which have
 *  no R-like channel). shareX / gapX / panelWidth / col-axis controls
 *  live on `FacetColOptionsPanel`; the wrap panel surfaces both. */
export const FacetRowOptionsPanel = () => <FacetAxisOptionsPanel axis="row" />
