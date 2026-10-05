import { createContext, useContext } from "react"

/** The facet panel key a renderer subtree is drawing — the same key
 *  `resolveFacetPanels` produced and PlotCanvas stamps on the panel's
 *  `data-panel-key`. Provided per panel by PlotCanvas so layers nested
 *  inside any renderer (the Data Labels layer) can scope themselves to
 *  facets without every renderer threading the key through its props.
 *  `null` outside PlotCanvas (bare renderer mounts in tests, previews). */
export const FacetPanelContext = createContext<string | null>(null)

export const useFacetPanelKey = (): string | null => useContext(FacetPanelContext)
