# Vis-Components Application Description

A feature-by-feature description of how the editor works, in plain language.
This is the source of truth for the code audit; if the implementation
disagrees, the doc wins.

---

## 1. What it is

Vis-components is a browser-based data visualization builder and
versioning system. The user uploads CSV data, selects variables to apply
to specific visual encodings (x position, y position, hue, etc.), and
the app builds the visualization piece-by-piece and renders it.
Customization happens in the relevant encoding; for example, axes are
customized in the position encoding, and color palettes are specified
(selected or overridden) in the hue encoding. Charts persist locally
along with the dataset they were authored against.

The app is designed so the chart type is **emergent from encodings**,
not chosen up-front. Map a field to `length` and you get bars; map
`x + y + connection` and you get a line chart; etc. This keeps the
modeling discipline tight (one mental model: "what does each field
represent in the visual"). For the "make me a bar chart" entry point,
the **Quickstart bar** offers one-click chart templates that drop
a random selection of variables into the encoding shelves that produce
the requested chart type. Quickstart is only a starting point — it does
not recommend the best visualization for the data set.

As part of this encodings-first philosophy, the tool follows some
default-resolution logic to produce a sensible figure from any given
combination of encodings. For example, two position encodings plus a
connection encoding could create a line chart or an area chart, but
since line charts are more common we render a line chart by default
with the option to toggle to area chart in the connection encoding
panel. Similarly, a multi-color bar chart could stack, group, or
overlay; we default to stacking and let the user toggle.

---

## 2. Data layer

### 2.1 Data upload
Users drop a CSV file via the Data section or with the CSV upload
button under Data in the left menu bar. When uploading INTO an
existing visual, they're asked: add as a new dataset *version* (live
iframes embedding this visual update automatically), OR detach into a
brand-new visual. New datasets get their type-inferred fields and
become available across the workspace; field types can be adjusted by
the user as appropriate, and those adjustments are reflected in the
visual. New dataset versions must have the same columns and data types
as the original dataset; anything else breaks the versioning and is
not allowed.

### 2.2 Field types
Every field is tagged with one of: `quantitative` (numbers),
`categorical` (distinct labels), `temporal` (dates), `ordinal` (ranked
categories). Types are inferred from the first ~50 non-empty values.
Users override per-field in the Fields panel with a dropdown — useful
when a numeric column like a zip code should be treated as categorical.
For categorical/ordinal fields, users can also pin a custom level
order (up/down arrows) instead of the smart-sort default.

### 2.3 Visuals (save/load)
A "visual" is a named snapshot of: chart name, the dataset (and the
specific version it was authored against), field-type overrides, all
encoding-channel assignments, every channel config, label settings,
legend settings, data labels, annotations, and a thumbnail. Visuals
persist to localStorage with versioned migrations so older saves
remain backward-compatible.

---

## 3. Encoding shelves & channels

### 3.1 The shelves
The Encodings section lists 18 channels, each accepting a field via
dropdown. The shelves are ordered intuitively for constructing a
visualization, with position encodings first (including faceting,
which is a type of position encoding), color (hue), etc. Settings
relevant to each encoding live behind a toggle on its row. Only
variables applicable to a given encoding appear in the dropdown — for
example, a quantitative variable cannot be assigned to pattern.

### 3.2 The channels
- **x, y** — position
- **r** — radial distance from center (radar / spider charts)
- **facet** — small multiples grid (single-variable wrap)
- **facetRow, facetCol** — two-variable facet grid (data-determined
  rows × cols); mutually exclusive with `facet` in the UI
- **hue** — fill color (UI label: "Color")
- **outlineHue** — outline/stroke color (UI label: "Outline color");
  coexists with hue since fill and outline are independent color
  dimensions. Surfaced inside the Color panel rather than as its own
  shelf row, but it's a first-class channel with its own legend section.
- **length** — bar/area height (the "measure" for aggregated charts)
  or the length of a segment (vector field chart)
- **connection** — joins points sharing a value into a polyline or
  area
- **opacity** — transparency
- **area** — bubble size or other shape size
- **shape** — point glyph (circle, square, triangle, etc.)
- **angle** — pie wedge size or an alternative to position in a radial
  chart (the spokes on a radar chart are an angle encoding)
- **saturation, brightness** — color variants (combine with hue)
- **pattern** — SVG fill pattern on shapes OR line-dash style on lines

Some channels conflict: length, angle, and shape are mutually
exclusive because a single mark can't be all three. (The `text`
channel was retired from the UI when the Data Labels section was
introduced, but is retained as a legacy channel for back-compat: the
renderer still honors `encodings.text.field`, and tile-heatmap
detection treats it as an alternative to `hue`.)

### 3.3 Chart mode is emergent
The chart mode is computed from which channels are mapped:

| Encoding combination | Chart type |
|---|---|
| `x + y` | Scatter (or violin / box plot if toggled) |
| `x + y + connection` | Line chart (toggle to area swaps y → length) |
| `x + y + length` | Line-segment scatterplot |
| `x + y + length + angle` | Vector field |
| `x + y + area` | Bubble chart |
| categorical/ordinal `x + y + hue` (no glyph channels) | Tile heatmap |
| `x + length` (hue optional) | Bars-x (stacked when hue added) |
| `y + length` (hue optional) | Bars-y (stacked when hue added) |
| quantitative `x`, histogram toggle (no length) | Histogram (bars-x, count per bin) |
| quantitative `y`, histogram toggle (no length) | Histogram (bars-y, count per bin) |
| quantitative `x + y`, hue = "Point count" | Hexbin (points binned to hex cells, colored by count) |
| `x + length + connection` | Area chart (areas-x) |
| `y + length + connection` | Area chart (areas-y) |
| `angle` | Pie (single centered) |
| `x + angle` | Pies-x (grid along x) |
| `y + angle` | Pies-y (grid along y) |
| `r + angle` (no x/y) | Radar / spider chart |
| `area` (no x/y/r/angle/length, not geographic) | Structure layout, flat (packed circles by default; treemap / sunburst / chord / sankey via the Layout picker) |
| `connection + area` (no x/y, not geographic) | Structure layout, grouped / nested / flow (packed circles / treemap / sunburst / chord / sankey) |
| geographic coords, `connection` (region key; no x/y, no area) | Geo choropleth (region fill) |
| geographic coords, `connection + area` (no x/y) | Geo symbols (bubble map; area → bubble size at region centroids) |
| geographic coords, `x + y` (x=lon, y=lat) | Geo points (dot map) |

The three geo modes reuse existing channels (no new geographic
channels); geographic rendering is gated by the chart-wide MapConfig
(`coordSystem: "geographic"`), set via the "Maps" sidebar section.
When no MapConfig is active the geo modes never fire.

Geography levels: US States, US Counties, and World Countries are
implemented (US ZIP/ZCTA is not yet). The level's `"auto"` setting
detects the best-matching level by scoring the connection field's
values against each level's lookup table (ties and no-match fall back
to states; the dot map, which has no connection field, always
auto-resolves to states). The Geography level dropdown shows what Auto
resolved to ("Auto (US Counties)"); an explicit pick always wins.
County joins accept 5-digit FIPS codes (unpadded tolerated) and
state-qualified names ("Washington County, TX"); bare county names
that repeat across states — or the six within-state city/county name
pairs, unless suffixed "city" — deliberately stay unmatched rather
than guessing.

Geo marks support the **pattern** channel with the same semantics as
the cartesian renderers (per-category palette cycling, per-value
overrides / "None", hue-paired inks): choropleth region fills, dot-map
dots, and bubble-map bubbles (over their point-fill slot color) all
swap their fill for the pattern paint when the mark's row carries a
pattern category (`lib/geo/geoMarkStyle.ts` — `resolveGeoPatternDef`).
Geo fills apply no sat/bri modulation, so the resolved fill doubles as
the pattern background and the ink-lookup key.

**Hierarchy layouts** (packed circles, treemap, sunburst) reuse
existing channels the same way the geo modes do: `area` supplies each
row's size, and `connection` is the hierarchy key (which container
each row nests in — hidden from the legend, like the choropleth's
region key). All three are different arrangements of the SAME
mapping, so encodings can't distinguish them — the **Layout picker**
in the Connection panel's Structure section
(`connection.hierarchyLayout`, default packed circles; the two FLOW
layouts below share the same picker) gates mode detection the way the
histogram toggle gates bars. Everything below
(ID column auto-detection, derived variables, per-value editors)
applies to all three layouts; treemap rect areas and sunburst arc
spans are proportional to values by construction, so the Scale-by
option is packed-circles-only. Circle sizing follows the
Area channel's **Scale by** option (`AreaConfig.sizeBy`, see §4.3):
"Area" (the default) keeps circle AREAS proportional to values —
radius ∝ √value, the only mode where a group circle reads as the sum
of its children; "Diameter" makes the radius grow linearly with the
value, exaggerating differences on narrow-range data. The Area
panel's min/max pixel range doesn't apply in packed mode (the layout
computes radii), so the panel shows only the Scale-by choice there.
The size legend follows suit: in packed mode its swatch radii render
the chart's TRUE proportions (zero-anchored value^exponent scaled to
the maxRadius budget) instead of the min→max px stretch — so a
narrow value range shows honestly similar legend circles rather than
promising differences the chart doesn't draw. It remains hideable
per-channel in the Legend section like any other.
The expected data shape is an edge list (`Parent,Child,Value`, one row
per node). Recursive nesting comes from the **ID column** — a
connection value matching another row's ID nests inside that row's
circle, to any depth. By default the ID column is **auto-detected**:
the column whose values overlap the connection field's values
(`inferHierarchyIdField` — e.g. `Child`, because `Watermelon` appears
in both Parent and Child). When nothing overlaps, rows nest ONE level
under their connection value (pure two-level data). The Connection
panel's Structure section can override Auto with an explicit column or
"None — group one level" (the `HIERARCHY_ID_NONE` sentinel). Tree semantics live in `lib/buildHierarchy.ts`
(shared with future treemap / sunburst layouts): parents that never
appear as an ID become implicit containers (that's how top-level
groups arise), a value on an internal node is ignored (a parent circle
sizes from its descendants and can't be smaller than them), rows with
blank/unparseable values are dropped like unsizable `area` marks,
duplicate IDs sum, and parent cycles are cut rather than crashing.
`connection + area` with no x/y under geographic coords is still the
bubble map — packed circles stand down when a MapConfig is active.

**Flow layouts** (chord, sankey) read the SAME signature as a directed
graph instead of a tree: each row is one edge, `connection` = the flow
SOURCE, the **"Flow to"** column in the Structure section = the TARGET
(`connection.flowTargetField`), and `area` = the flow's weight (ribbon
/ link thickness — proportional by construction, so like treemap /
sunburst the Area panel shows an explanatory note instead of the px
range, and the size legend reads linearly, width ∝ value). The target
column **auto-detects** like the hierarchy ID column: the column whose
values overlap the connection field's (`Stop` when connection maps
`Start` over a shared city namespace), falling back to the first
categorical column when nothing overlaps (bipartite flows like
Country → Product). A **⇄ Swap direction** button exchanges source and
target in one click (it materializes the Auto-resolved target as the
explicit pick — there is no "reversed Auto" state — so a second click
swaps back; disabled while no target resolves). Duplicate
(source, target) rows sum; rows with blank endpoints or unparseable
values drop, like unsizable `area` marks (`lib/buildFlowGraph.ts`).
**Chord** renders the full edge list — self-loops and two-way pairs
included — as a ring of node arcs joined by directed ribbons colored
by their source node. **Sankey** requires an acyclic graph, so it
drops self-loops and then breaks cycles greedily (keep edges in
descending value order, drop any that would close a directed cycle —
big flows survive, small back-edges drop) and says so in a small muted
in-plot notice ("N flows hidden to break cycles"); multi-level columns
emerge from edge chains automatically. Mapping **hue to either
endpoint column** means "color by node": one categorical scale over
the UNION of both endpoint columns (first-appearance order, full
dataset rows), so a node that only ever appears as a destination keeps
a stable palette slot in every facet panel — and the hue legend, the
Color panel's swatch list, and the Pattern panel's category rows all
list that same union in the same order (anything else would show a
different palette slot than the drawn arc). Mapping **pattern to
either endpoint column** likewise means "pattern by node" over the
same union: node arcs / rects fill with the node's pattern tile
(background = the node's hue color when hue is also on the nodes,
else the Pattern panel's background color), and ribbons / links take
their SOURCE node's tile. Node and ribbon opacity are two flow-only
slots in the **Opacity menu** — **Nodes** (default 1) and **Ribbons**
(default 0.45), level-only (flow marks aggregate rows, so a per-row
field mapping is ill-defined) — and the Fill subsection hides in flow
modes because no flow mark reads the overall opacity. Hue on a NON-endpoint column (and
mapped saturation / brightness / opacity) is inert in flow modes —
edges aggregate multiple rows, so row-backed aesthetics are ambiguous
and marks keep the default fill; the legend still lists such fields
(known gap, see the implementation plan's deviations). Flows have no
nesting, so the hierarchy-derived variables (Top-level group / Nesting
depth) are NOT offered in flow modes. The flat signature (`area` with
no connection) under a flow layout has no edges to draw — the canvas
stays empty and the Structure section's hint says to map a source
column.

**Flow node labels** (the node names beside chord arcs / sankey rects)
style through the Labels menu's **Node titles** section (flow modes
only): a textless "Auto" row — the names come from the data — with the
same alignment / font / offset controls as the axis titles
(`labels.fontOverrides.nodeTitle` + `titleAlignments` /
`titleOffsets`). Each SET field layers over the legacy Text-channel
config (`channelConfigs.text`) field by field, so visuals styled
through the old Text panel render unchanged until a Node-titles field
overrides it; a Node-titles color override beats the Text channel's
per-value colors. Align's default (center) keeps the renderer's
automatic anchoring (away from the ring for chord, side-dependent for
sankey); Left / Right force every label's reading direction. Besides
the shared x / y offset, node titles get a **Distance from figure**
input (`titleOffsets.nodeTitle.distance`, default 0): it moves every
label along its away-from-the-figure direction — radially outward for
chord, away from the node rect for sankey — with negative values
pulling labels closer; x / y then shift in screen space on top.

**Chord ring axis** — Connection panel → **Show axis** (chord layout
only; checkbox, off by default): graduated value tick marks around the
ring showing each node's flow total (d3's classic chord group ticks —
every group shares ONE step so the ring reads as a single scale).
Enabling it reveals **Ticks / Tick Labels / Spine** subheaders
mirroring the x / y position panels: *Ticks* = the shared Format
control (custom d3-format; Auto = SI-prefixed calibrated to the step,
fixed decimals for fractional steps) + **Count** (target tick marks
around the FULL ring, default 100 — the axis is continuous, so it
takes a count like the continuous x / y axes, never the categorical
"Tick every" stride; the step snaps to a nice round flow value and
each node gets ticks proportional to its total) + tick-mark color /
thickness / length; *Tick Labels* = **Label every** Nth tick (default
5th; each group's graduation starts at 0 from its start angle) + the
shared tick-label font editor (unset fields inherit the base text
font); *Spine* = the thin arc drawn along each group's outer edge
(theme spine color / thickness — the circular analogue of an axis
line). Tick labels read radially outward and flip 180° past 6 o'clock
so they never render upside-down. The ring shrinks to reserve the
axis's radial extent (tick length + widest label), and the node labels
move outside the tick labels. State lives in `connection.chordAxis`;
`lib/chordAxis.ts` owns the tick math (a derived step that would emit
>200 ticks in one group re-derives so the main thread stays
responsive).

The tree layouts support the **pattern** channel two ways, mirroring
the color chain: a FIELD patterns row-backed marks — packed-circle
leaves, treemap tiles, and sunburst arcs (leaves AND named containers,
the same row-backed rule as the outline chain; implicit containers
keep the wash, unpatterned) — while the DERIVED sources ("Top-level
group" / "Nesting depth", offered in the Pattern shelf dropdown like
the other styling channels) resolve from tree position, so any styled
mark patterns, implicit containers included when a derived color
styles them. The pattern tile's background is the mark's drawn fill
whenever color varies the marks (a field hue OR a derived source),
else the Pattern panel's background color; ink pairing keys on the
pre-modulation color per the palette-ink invariant
(`useHierarchyScaffold.makeStyleResolvers` → `patternFor`). The
Pattern panel lists the derived categories (group names / "Level N"
rows) with the same auto-cycled glyph defaults the marks draw.

All derived-scale domains — marks, labels, and the sidebar panels —
come from ONE recipe: the full dataset's tree in insertion order
(`topLevelGroupNames` / `hierarchyDepthLevels`), never the laid-out
nodes. The layout sorts siblings by value and holds only the facet
subset, so a layout-derived domain would shuffle palette / pattern
slots between facet panels and away from the sidebar's override
swatches.

Packed circles also add **hierarchy-derived variables** (the
`measureSource` mechanism histograms use for Count/Density, §4.1), so
styling by structure never needs denormalized Root/Depth columns. Two
derived variables — **"Top-level group"** (`"rootGroup"`: the circle's
OUTERMOST ancestor, categorical) and **"Nesting depth"** (`"depth"`:
the circle's level, 1 = top-level, quantitative) — appear as options
in the PRIMARY encoding dropdowns (and the panels' mirrored "Vary by"
selects) for five channels: **Fill color, Fill opacity, Saturation,
Brightness, and Pattern**. Offered only in packed mode with a mapped
connection (no groups → nothing to derive). Per channel:

Both derived variables are DISCRETE on every channel (Nesting depth is
ordinal — never a gradient), so each offers a per-value editor:

- Fill color: one override swatch per group / per level, over the
  palette. Ordinal color (including Nesting depth) offers the theme's
  ordinal palettes first AND the categorical palettes — an ordered
  variable with few levels often wants distinct hues over a ramp; the
  chosen palette's colors snapshot into `ordinalPalette` either way.
- Fill opacity: one 0–1 value per group / per level
  (`OpacityConfig.overrides`); unset values spread evenly.
- Saturation / Brightness: one 0–1 value per group / per level
  (`SaturationConfig.overrides` / `BrightnessConfig.overrides`,
  consulted only by the packed renderer); unset values keep the even
  min→max spread (Min = the outermost level), so the fade remains the
  zero-config default and any level can be pinned individually.
- Pattern: one auto-cycled fill-pattern glyph per group / per level
  (`PatternConfig.overrides` per-category picker in the Pattern
  panel, categories = group names / "Level N" rows). Resolved from
  tree position, so any STYLED mark patterns — implicit containers
  included when a derived color styles them.

When any derived variable drives Fill color, containers join the
scale (replacing the gray wash) at the SAME opacity resolution as
every other circle — there is no automatic container translucency;
distinguishing nested levels (depth-driven opacity / brightness /
saturation, or nothing) is the user's choice. Derived variables are
mutually exclusive with a field on the same channel (picking one
clears the other), and produce no legend section (containers are
already labeled in-chart).

**Hexbins** are the scatter analogue of the histogram's derived
measure: when x and y are both quantitative, the Fill color dropdowns
(shelf and panel "Vary by") offer a derived **"Point count"** variable
(`measureSource: "hexCount"` — distinct from the histogram's
`"count"`). Picking it IS the mode switch — no toggle: points bin onto
a pointy-top hex lattice and each occupied cell renders as one hexagon
colored through the normal quantitative hue gradient over
`[0, maxCount]`, with a matching gradient legend section titled "Point
count". Binning happens in DATA space (ggplot2 `geom_hex` style), on a
normalized grid over the axes' domains: counts depend only on the data
and the bin count, so they are stable across canvas resizes, facet
panels, and exports, and the legend computes its domain from data
alone. The trade-off is that hexagons stretch to the plot's aspect
ratio (the lattice still tiles exactly). The **Bins** input in the
Color panel (default 20) sets the target hexagon columns across x;
user-pinned axis bounds crop points outside the domain before binning.
Losing the gating (unmapping x/y, or a type change) falls back to
scatter — the dangling "Point count" selection stays visible in the
dropdown so it can be cleared, and re-establishing the gating restores
the hexbins. When faceted, each panel bins its own rows over the
shared axis domains (cells align across panels), but each panel's
color scale spans its own max count — the same known divergence the
histogram measure has.

Modes are resolved in precedence order (first match wins); scatter is
the always-true fallback. Tile requires **both** axes to be
categorical/ordinal and **no** glyph-implying channel (length, angle,
shape, area, opacity, connection) — mapping any of those drops it back
to scatter. The histogram rows are driven by a per-axis toggle in the
channel config, not by an encoding; the renderer bins the quantitative
axis and counts rows per bin.

All of the above can be faceted across a categorical or ordinal
variable. Hue can be replaced or combined with opacity, saturation,
brightness, or pattern.

### 3.4 Quickstart bar
The icon bar above the encoding shelves gives one-click scaffolds for
each chart family (bar, scatter, line, area, pie, violin, tile, map,
packed circles, treemap, sunburst, sankey).
Each icon cycles through random *variations* (e.g., bars → vertical →
grouped → patterned stacked → horizontal). The scaffold assigns
eligible fields automatically and optionally drops in a hue encoding
for free if a spare categorical field is available. Each variation
declares which channels need which field types; a chart-type button is
greyed out if the dataset can't satisfy any variation. Quickstart is a
starting point only — not a recommendation system.

The **Map** icon is value-driven, not type-driven: the dataset's rows
are sampled (`lib/geo/detectGeoFields.ts`) for columns that join a
states or countries lookup table (names, USPS/ISO codes, FIPS — with
all-integer columns additionally requiring a geographic field name),
and for latitude/longitude column pairs (by name, with values in
coordinate range). Its variations are Choropleth (region → connection,
measure → hue), Bubble map (region → connection, measure → area), and
Dot map (longitude → x, latitude → y); each is satisfiable only when
the matching geographic fields were detected, and the icon greys out
when none were. A map scaffold installs a fresh geographic MapConfig
at the detected geography level; scaffolding any non-map family turns
a leftover geographic coord system off (other map settings are kept).

The **hierarchy / flow icons** scaffold the shared structure signature
(quantitative → `area`, categorical → `connection`) and select their
layout via `connection.hierarchyLayout` (pack / treemap / sunburst /
sankey). The tree scaffolds seed hue with the derived **Top-level
group** source (canonical hierarchy coloring); the sankey scaffold
points hue at the source column so nodes color over the endpoint
union, and is satisfiable only when a SECOND categorical remains for
the auto-detected flow target (the target detector never picks the
source column itself). None of the four roll opportunistic extras —
their hue is variation-seeded, and random pattern/shape fields
wouldn't land on anything these renderers draw.

---

## 4. Per-channel customization (sidebar panels)

**Panel visibility rule**: an encoding panel is visible when (a) the
channel is mapped, OR (b) the channel could meaningfully affect the
current chart type AND has a configurable default. Examples:

- Bar chart `x + length + hue`: area, angle, connection panels hidden
  (bars don't render glyphs / no per-row position). The Shape row and
  panel stay LIVE despite the length↔shape conflict: bar borders read
  the Shape panel's outline width (and the Color menu's Outline color),
  so bar modes are exempt from the conflict de-emphasis. The panel
  hides the Default-shape glyph picker there (no glyphs to apply it
  to); mapping a field to Shape still pops the conflict dialog.
- Scatter / violin / box: connection panel hidden when no connection
  encoding is mapped.
- Area chart: angle, shape panels hidden when those channels aren't
  mapped.
- Tile chart: angle, connection, area, length panels hidden when those
  channels aren't mapped. The Shape panel stays live for the outline
  width (cell borders read it, same chain as bars) but — like bar and
  hexbin modes — hides the Default-shape glyph picker, since these
  modes draw no point glyphs.
- Pie chart: length, connection, area panels hidden when those
  channels aren't mapped.

X-position, Y-position, and Facet panels are always available; users
can configure axis settings even before a field is mapped.

### 4.1 Color panel (the hue channel)
The hue channel's panel is labeled **"Color"** in the UI. The fill
palette section branches on field type:

- **Categorical** — palette dropdown sourced live from the active
  theme's Categorical Palettes. Per-value color override grid (click
  swatch → pick color). Each row also carries a circular-arrow button
  that opens a popover of the current palette's swatches (wrapping at
  6 per row, current color highlighted) — pick one to commit it and
  close. Stack mode (stack / group / overlay) for bars
  and areas. **Area charts** also get a separate "Line color" section
  with its own palette dropdown (lets the user pair a light fill
  palette with dark strokes); per-value line color overrides supported
  there too.
- **Ordinal** — palette dropdown sourced live from the active theme's
  **Ordinal Palettes** (a separate palette set from Categorical).
  Same per-value override grid and stack-mode toggle. Same separate
  "Line color" section for area charts.
- **Quantitative** — gradient picker (viridis, plasma, etc.) plus
  custom 2-stop or 3-stop gradients with explicit low/mid/high colors
  and optional pinned domain values. Each stop's value box shows the
  computed auto value as its greyed placeholder (data min / mid / data
  max) rather than the word "auto"; typing a value pins that stop.
  Diverging gradients (presets and saved) center their mid stop at 0
  whenever the data spans 0 — the palette's neutral marks the sign
  change — falling back to the domain midpoint for one-signed data.
  The stop rows read High → Mid → Low top-to-bottom (matching a
  vertical gradient legend, high values on top); the free-form
  manual-stops editor keeps its ascending Step 1..N order.
  Each High/Mid/Low row carries its own inline "reset" link, shown
  only when that row's color or pinned value differs from the
  palette's default; only the free-form manual-stops editor keeps a
  whole-palette reset button (its rows have no stable per-row
  default).
  Custom gradients (saved linear/diverging and manual stops) also get
  an **Interpolation** dropdown — the color space the scale blends
  through between stops: **RGB** (default; matches CSS gradients and
  all charts saved before the option existed), **HSB** (rotates
  through hue), or **OKLCH** (perceptually uniform; avoids RGB's
  muddy midpoints between distant hues). Hue-carrying spaces take the
  shorter arc around the wheel, and an achromatic stop (grey/white/
  black) borrows the other stop's hue so grey→blue ramps stay blue.
  The row is hidden for presets — those are continuous baked ramps
  with every in-between color already specified, so there is nothing
  for the option to control (editing a preset transitions to a custom
  gradient, at which point the row appears). The legend's gradient
  bar samples the live scale densely for its CSS gradient, so the bar
  tracks the chosen blend space instead of CSS's sRGB approximation.
  The gradient config **survives encoding round-trips**: switching the
  Color variable to a categorical field stashes the quantitative
  config (and vice versa — categorical per-value overrides stash when
  a gradient takes over), and mapping a matching-kind field again
  restores the stash instead of re-seeding the theme default.

**Color slots** — every colorable mark part gets its own subheader in
the Color panel, driven by a registry (`lib/colorSlots.ts`). Fill and
Outline come first (they keep their own storage as the `hue` /
`outlineHue` channels and are rendered via adapters); the remaining
slots — Line, Rug, Violin fill/outline, Density-curve fill/stroke,
Regression line / Confidence interval, Stem, radar Spine, geo-point
fill/outline — each store an optional
field mapping (palette + per-level overrides) or, when no field is
mapped, a single color seeded from the theme. Slots only appear when
their chart mode and feature gate apply (e.g. Rug requires the
histogram or density display to be on). Resolution is
**slot-config-if-present, else the legacy per-feature config field**
(e.g. `connection.strokeColor`, `histogram.rugColor`), so saved
visuals keep their colors unchanged until the user touches the slot.
Aggregate shapes (violin / box) resolve a mapped slot field against a
representative row — the first data row of the shape's category (or of
the panel, for the single-variable violin) — so "Vary by" works for
any field that's constant within the category, such as a facet field,
not just the category-axis field. A field that varies within the
category resolves from that first row.
The Opacity panel mirrors this structure with its own registry
(`lib/opacitySlots.ts`): a universal Outline (border) slot plus
per-part slots matching the color registry's gates; Fill opacity
reuses the overall `opacity` encoding.

### 4.2 Pattern panel
Behavior depends on chart context:

- **No connection mapped** (bar / area / scatter): SVG fill patterns
  (six pattern shapes). Per-value pattern picker. Ink and background
  color controls, defaulting to the Pattern defaults from the theme.
- **Connection mapped, no shape encoded** (line chart): swatches are
  line dashes (`dashed`, `dotted`, `dash-dot` — `solid` is implicit
  via the "None" button). Patterns drive line stroke style; points
  default to "None" until the user specifically picks a fill. With no
  pattern variable mapped, the default Line-dash row writes
  `connection.defaultDashPattern` (the field the line renderers read;
  its "Custom" option writes `connection.customDashPattern`, which
  wins when it parses) — storage deliberately SEPARATE from the
  Point-fill row's `defaultPattern`, so picking a dash never silently
  picks a point fill. With a variable mapped, per-category picks resolve through
  `pattern.dashOverrides` / `pattern.customDashOverrides`, auto-cycling
  DASH_CYCLE by category position when unset. When the pattern field
  varies WITHIN a line (e.g. a known-vs-projected column on a series
  spanning both), the polyline splits into runs of constant pattern
  value, each run rendered with its own category's dash; consecutive
  runs share their boundary point, and the connecting span takes the
  LATER run's styling (last-known → first-projected IS projection).
- **Connection mapped + shape encoded** (line with distinct points):
  BOTH a "Line dash" row and a "Point fill" row appear. Each row
  writes to independent overrides so picking a dash style doesn't
  apply a point fill. Points default to "None" until explicitly chosen.
- **Geo and STRUCTURE modes** (choropleth / bubble map, hierarchy
  trees, chord / sankey): always the FILL form, even though
  `connection` is mapped — there it's a KEY (region join / parent
  group / flow source), not a drawn line, and the marks render fill
  patterns that AUTO-CYCLE by category position. The panel's
  per-category glyphs show that auto-cycled default as selected, so
  the picker matches the drawn tiles (the compound form would show
  dash pickers with fills defaulting to "none").

**Custom dash patterns** — alongside the built-in dash swatches, a
"Custom" option opens an editable text input where the user types a
custom dash pattern as a comma-separated list (e.g., `2,2` for 2px
dash / 2px gap; `2,4,5,2` for an alternating pattern). The input is
placeholder-prefilled with a faint `2,2` to prompt the format.
Available EVERYWHERE a dash row renders: per-category rows with a
pattern variable mapped (`pattern.customDashOverrides`), the
no-variable default Line-dash row (`connection.customDashPattern` —
so the full-line dash and the range window below both take custom
patterns), and the regression-line row
(`x.regression.customDasharray`). None / a swatch / Custom are one
mutually-exclusive choice; a custom value that doesn't parse falls
back to the swatch pick. Custom dash isn't a built-in palette entry.

**Apply pattern to range** — directly under the NO-VARIABLE Line-dash
row (the dash picker chooses WHICH pattern; these rows choose WHERE
it applies) sits an "Apply pattern to range" checkbox plus **From** /
**To** text inputs. When on, ALL line dashes — built-in swatch or
custom dasharray — draw only within [From, To] along the axis the
line runs along; outside the window the line renders solid in the
same stroke — the known-vs-forecast look (solid actuals, patterned
forecast: pick a dash, set From to the forecast start, leave To
blank). While the range is on with no dash picked (and no parseable
custom value), a helper nudges the user to pick a dash style —
alone, the range draws nothing. Values are raw axis values like value-mode
annotation coordinates (numbers, dates, or categories); blank =
unbounded; a value that doesn't parse is treated as unbounded;
From > To swaps. One GLOBAL window per chart
(`connection.dashRange`) shared by scatter connection polylines and
area line-mode edges; the boundary points are interpolated so the
solid and dashed segments meet exactly, and the alternate-color
underlay only backs the dashed part. With a pattern VARIABLE mapped
the rows are hidden and any stored window is ignored by the
renderers — the variable itself says where each dash applies, and
the two windows would conflict. The regression line has its own
independent window (`x.regression.dashRange`) with the same rows in
its Pattern-menu subheader. Fits are per panel when faceted (same
values, each panel's own scale).

**Fill dash gaps** — every Line-dash section carries a "Fill dash
gaps" checkbox (`connection.dashGapFill`). Checked, the gaps between
dashes are painted by a solid underlay so a dashed line reads as one
CONNECTED two-color line — and the section reveals editable
**gap-color swatch rows, one per COLOR-encoding category** (gap
colors pair with line colors, and line colors come from hue). Each
row shows the category's current gap color as its placeholder and
writes `connection.dashAlternateColors` keyed by HUE value; an
edited row grows a "reset" button that removes the override
(clearing the text input does too). With no hue encoding
there's one line color, so a single "Gap color" row writes
`connection.dashGapColor` instead. The default gap color resolves
like AREA PATTERNS pick their ink — the palette's paired pattern-ink
options (`resolveDashGapColor`): per-hue-category
`dashAlternateColors` override (legacy visuals keyed by connection
group still resolve) → the single `dashGapColor` → the pattern
channel's per-category Color pick (`pattern.inkColors[patternValue]`)
→ the palette-paired pattern ink for the line's drawn color
(`inkForHueColor` against the same palette the hue scale used —
ordinal hue fields resolve from the ordinal palette) → the default
pattern ink (`defaultPatternInk`, theme-seeded, else built-in
near-black). Deliberately NOT the chart background:
background-colored gaps are indistinguishable from empty gaps.
Unchecked, no underlay renders, the swatch rows hide, and the line is
truly dashed with empty gaps. The stored value is tri-state: `null`
(default) = AUTO — gaps are filled, EXCEPT when the pattern encoding
maps the SAME field as the hue encoding (there the dash restates the
color split, so true gaps are the default and filling is opt-in).
Toggling the checkbox back to the auto value clears the stored choice
so the changed dot goes back out. Applies to scatter connection
polylines and area line-mode edges alike.

### 4.3 Shape, Saturation, Brightness, Opacity, Length, Angle, Area
Each channel exposes scaling controls (min/max), per-value overrides
where it makes sense, and any channel-specific knobs (e.g., shape
outline width). Theme defaults seed the ranges so new charts come up
with sensible visuals.

**Saturation / Brightness** follow the field's type, like Opacity and
Area do: a quantitative / temporal / numeric-ordinal field modulates
continuously and gets the min/max range editor; a categorical (or
non-numeric ordinal) field gets a **per-category level editor** — one
0–1 input per category, pre-filled with the even min→max spread the
renderer applies, each row individually pinnable
(`SaturationConfig.overrides` / `BrightnessConfig.overrides`, the same
storage the packed-circles derived panels use). Unset categories keep
the spread; the legend resolves through the same scale so it always
matches the marks.

In bar modes the **Length** panel swaps its inert px min/max range for
a **Bar gap** control (`LengthConfig.barGapPx`): the gap between bars
in PIXELS. Bar width is whatever remains of each category slot, so the
one value sets width and gap together. BarPlot converts the pixel gap
to d3's band-padding fraction per panel (p = g·n / (range − g), with
inner and outer padding alike), which keeps the gap uniform across
facet panels of different widths. Auto (stored as null, cleared via
the empty input or reset) is the proportional 15%-of-slot gap.
Histograms ignore it — their bars always abut.

The **Area** panel additionally carries a **Scale by** choice
(`AreaConfig.sizeBy`) that applies everywhere the channel sizes marks
— scatter bubbles, geo bubble maps, packed circles:
- **Area** (default, stored as an absent key): value → circle AREA
  (radius ∝ √value via a power-0.5 scale). True proportions.
- **Diameter**: value → radius linearly. Exaggerates differences —
  legible on narrow-range data, at the cost of area honesty (a
  doubled value quadruples the ink). The size legend follows the
  same scale, so legend swatches stay consistent with the marks.

### 4.4 Connection panel
Connection is the line/area glue. Controls:

- **Chart type toggle** (Line / Area) — visible whenever connection is
  mapped. Switching to Area swaps `y → length` so the existing
  area-detection fires, and sets `connection.fill = "area"`. Switching
  to Line reverses the swap. Auto-sets hue stackMode to "stack" when
  switching to Area.
- **Line thickness** — px.
- **Show points** — `all`, `none`, `first-only`, `last-only`,
  `first-and-last`, or `every-n` with stride N. Drives marker
  visibility along each line.

In the **structure modes** (packed circles / treemap / sunburst /
chord / sankey), connection is a structural key, not a drawn line, so
all line-styling sections stand down and the panel shows a
**Structure** section instead: a **Layout** radio (Packed circles /
Treemap / Sunburst / Chord / Sankey — §3.3) plus layout-dependent
fields. Tree layouts get the **ID column** select whose default "Auto"
shows what was detected (e.g. "Auto — using Child"), with "None —
group one level" and explicit columns as overrides. Flow layouts get
the **Flow to** select (same Auto pattern — "Auto — using Stop") and
the **⇄ Swap direction** button (§3.3; disabled while no target
resolves). A stored target equal to the connection field (reachable by
swapping, then remapping connection in the shelf) is treated as Auto
everywhere. Without a mapped connection the field controls give way to
a hint to map one (the Layout radio stays — it applies to the flat
signature too).

### 4.5 Facet panel
Visible when `facet` is mapped. Controls:

- **Rows / columns** — explicit grid dimensions. Max for each is the
  number of levels in the facet variable.
- **Share axes** — separate toggles for sharing the x-axis or y-axis
  across panels in the same row or column. When shared, all axes have
  the same extent; tick labels render only on one row / column edge.
  Default is shared.
- **Size panels by category count** — when checked, panels with more
  categories on the relevant axis get proportionally more width / height
  so categories stay evenly spaced across panels. Requires the axis
  in question to NOT be shared and to have only one row or column
  with that variable. Greyed out otherwise.
- **Size panels by unit** — same idea, but for quantitative axes:
  panels with a larger axis range get proportionally more space. E.g.
  panel A's y is 0–10 and panel B's y is 0–20 → B is twice as tall.
  Same not-shared, one-row/column-only constraints.
- **Gap X / Gap Y** — moves panels further apart or closer together.
  Panels expand or contract to keep total layout area constant, until
  panels are touching; after that, they slide over each other into
  overlap (ridgeline plot territory).
- **Panel order** — custom ordering of panels by the facet variable's
  levels.

### 4.5a Hide empty panels (facet grid)
The facet Row and Column option panels each carry a **Hide empty
panels** checkbox in their "Custom sizing" subsection — one config
bit (`FacetConfig.hideEmptyPanels`) mirrored into both panels, shown
only when BOTH `facetRow` and `facetCol` are mapped (the row × col
cross-product is the only source of empty panels). In pie mode it
surfaces only in the column panel: the row panel early-returns with
its "no row axis" hint before reaching the checkbox.

Default off. Off — or on with no empty cross-product cell — the grid
renders as always: full cross-product, top and left header strips, no
per-panel titles. When the toggle is ON and at least one row × col
combination has no data, the empty cells are dropped and the
survivors compact (`compactNonEmptyGrid` in
`lib/resolveFacetPanels.ts`). The layout adapts to how evenly the
survivors distribute:

1. **Columns even** — every column has the same non-empty count →
   columns compact into a dense grid. The top (column) strip
   survives; each panel gets a per-panel title showing its ROW value.
2. **Rows even** (columns uneven) — the mirror image: the left (row)
   strip survives; per-panel titles show the COLUMN value.
3. **Neither even** — survivors flow row-major (original grid
   traversal order) into a near-square wrap grid (the same auto shape
   as wrap-mode facet). NO strips; each panel's title combines both
   values as "row · col" (space-middot-space separator).

Tie-break: when both directions are even but the grid isn't full
(e.g. a pure diagonal), columns win. The all-empty degenerate case
(possible when a facet level's partner-field values are all null)
falls back to the normal uncompacted grid, same as the fully-dense
no-op case.

Invariants that hold under compaction:

- **Panel keys stay `${rowValue}|${colValue}`** — annotation scoping
  (`facetKeys`), per-panel axis overrides, and `data-panel` selectors
  are unchanged. An annotation scoped to a dropped panel simply
  doesn't render.
- **Share groups and per-row/col axis overrides key on ORIGINAL facet
  values, never layout position.** With shareY = "Per row", two
  panels sharing a facet-row value share their y domain even when
  compaction places them at different layout heights. (PlotCanvas
  routes every such lookup through `panelFacetValues` /
  `panelGroupKeys`.)
- **Per-panel titles reuse the wrap-mode facet-label band** and are
  styled by the Labels panel's **Panel titles** row — a dedicated
  `facetPanelTitle` font slot that layers over `facetTitle` the same
  way the per-strip Column/Row title slots do. Font, alignment, and
  offset each fall back to the facet-title setting when unset, so an
  untouched Panel titles row leaves the titles looking exactly like
  `facetTitle` (pre-existing visuals unchanged). The per-strip
  row/col title fonts never apply here, and wrap-mode per-panel
  labels keep using `facetTitle` directly — `facetPanelTitle` styles
  ONLY these compact-grid panel titles. The row is gated on the
  hideEmptyPanels CONFIG bit (matching the checkbox), not on the data
  actually having empty cells, so it doesn't appear/disappear as the
  data changes.
- The surviving strip is the only strip the solver reserves space
  for; a suppressed left strip leaves no width gap (see LAYOUT.md).

Known limitation (pre-existing across the cross-product machinery):
facet values containing a literal `|` can alias panel keys; under
compaction a collision would silently overwrite an entry in the
compact panels record.

### 4.6 Change indicators (the "dot trail")
Every encoding row and its panel show where the user has deviated from
the defaults, so it's obvious at a glance what's been customized —
and the indicators form a trail the user can follow down to the exact
setting:

- A small **dot** on the encoding row's settings chevron means
  something inside that panel differs from its default.
- Inside the panel, the same dot appears **after a subsection's
  header** when a control in that subsection is changed.
- The individual changed control's **label turns bold and purple**
  (the accent color), pointing at the exact setting that was altered.

"Default" means whatever the control shows untouched — usually the
active theme's value, or a built-in default for things not stored in
the theme (e.g., stacked-vs-overlay, line-vs-area). The comparison is
**live against the current theme**: switching themes re-evaluates every
dot. Mapping a field to a channel is NOT a change (no dot) — only
customizing a setting is. Chart-type toggles (line ↔ area) DO count.

---

## 5. Axes, scales, gridlines

### 5.1 Per-axis panel
The X-axis and Y-axis panels (under Encodings) configure:

- **Spine** — color, thickness.
- **Tick marks** — color, thickness, length.
- **Ticks: count + custom breaks** — the Ticks section sets the tick
  layout: **Count** picks the automatic tick density (0 = no automatic
  ticks), and **Custom breaks** (continuous axes only) pins extra
  ticks at listed positions, ADDED to the automatic layout — set Count
  to 0 and list breaks for fully custom ticks. Breaks outside the axis
  range are dropped, and a break coinciding with an automatic tick
  draws once. Tick labels simply follow the ticks — every tick gets a
  label; there is no separate label-position control.
- **Gridlines** — enabled toggle, color, thickness, custom count
  (default: match tick count). "Match tick count" follows the
  AUTOMATIC tick layout only — the Ticks section's custom breaks get
  no gridlines of their own. **Custom breaks** here (continuous axes
  only) pins extra gridlines at listed positions, drawn in addition
  to the automatic lines (match-tick or explicit count); a break that
  coincides with an automatic line paints once.
- **Adjust position** (end of Tick Labels, behind a divider) — X / Y
  pixel nudge that moves the whole axis (spine, tick marks, tick
  labels, title) without moving the gridlines, which stay pinned to
  their data positions. Same input convention as the data-labels
  nudge: positive X = right, positive Y = up (stored in screen
  coords, sign flipped at the input boundary). The legacy
  perpendicular `offset` field is read while the new `offsetX`/
  `offsetY` are unset and cleared on their first write.
- **Tick label angle**, **label stride** (every Nth).
- **Wrap text** (Tick Labels) — line-wraps long tick labels. X-axis
  labels wrap to their per-tick slot width; y-axis and radar r-axis
  labels wrap to a fixed font-relative max width (~8em). Wrapping
  breaks on spaces, splitting a word only when it alone exceeds a
  line. While on, the categorical auto-rotate stays off (wrapping
  replaces rotation as the overflow strategy); an explicit tick label
  angle still applies. The layout solver reserves matching multi-line
  room (line count below the x-axis, widest line left of the y-axis).
- **Alignment** (Tick Labels) — a left / center / right row (same
  glyph buttons as the Labels panel), shown while Wrap text is on.
  Wrapped labels align their lines within the wrapped
  block; the block itself stays anchored to its tick. Unwrapped
  (single-line) labels align within the axis's shared label column:
  y-axis labels align to a common edge of the column (as wide as the
  axis's widest label), radar r labels likewise right of the spoke,
  and x-axis labels — which have no column — anchor at their own tick
  (left starts the label at the tick, the time-axis style). The
  default is the axis's natural alignment — centered under an x tick,
  right-aligned against the y axis, left-aligned at the radar spoke.
  Rotated x labels flip that default with their anchor: negative
  angles naturally right-align, positive left-align.
- **Tick label format** — a dropdown of preset d3-format strings (e.g.,
  comma-separated thousands, percent, scientific, currency) that
  populates an editable text box. The user can pick a preset and then
  refine it as raw d3-format syntax.
- **Distribution overlay** — adds a violin or box plot on the value
  axis of strip plots (categorical × quantitative). The box draws its
  Tukey outliers as small open circles only while the underlying data
  points are hidden; when "Show points" is on the real points already
  mark those values, so the box suppresses its own outlier circles
  rather than double-drawing them.
- **Regression** (X position only) — offered when BOTH position axes
  are quantitative (the exact complement of the violin/box situation;
  the two sections never co-occur). "Add regression line" fits y-on-x
  by least squares — **Linear** or **Polynomial** with a degree of
  2–6 — and draws the fitted curve over the dots, clipped to the plot
  area and never extrapolated past the data's x-extent. **Position**
  picks whether the line draws in front of or behind the dots (front
  by default). **Line per group** fits one line per value of an
  explicit grouping variable (pre-filled with the hue field when one
  is mapped, otherwise blank; the pooled line draws until a variable
  is chosen) — when the grouping variable IS the hue field, each
  group's line inherits its hue color. **Confidence interval** adds a
  pointwise CI band for the mean response at a configurable level
  (default 95%); the band needs residual degrees of freedom, so a
  saturated fit draws the line only. Fits are per facet panel. Line
  and band styling live in the Color and Opacity menus under
  **Regression line** / **Confidence interval** subheaders — the
  Color panel's Regression line subheader also carries the line's
  width. The line's dash lives in the **Pattern** menu's Regression
  line subheader, with the same options per-category lines get (None /
  dashed / dotted / dash-dot / a custom dasharray string); per-group
  fits share the one dash choice. That subheader also carries "Apply
  pattern to range" (From/To x-values): the dash draws only within the
  window, solid outside — for marking the extrapolation/forecast
  region of the fit. Theme defaults: `regressionStroke`,
  `regressionCiFill`.
- **Reset to defaults** — pulls from the theme's per-axis gridline
  defaults.

### 5.2 Position scales
Built per-axis from the data: linear for quantitative, time for
temporal, point scale for categorical and string-ordinal, linear over
numbers for numeric-ordinal. Across facets, panels with shared axes
are aligned by their **axis spines** (the inner plot edges), so axis
labels and gridlines line up regardless of panel pixel width.

---

## 6. Layout & rendering

### 6.1 Unified renderer
A single SVG, single solver. The solver (`facetLayoutSolver.ts`) is a
pure function that takes the container size + encoding metadata and
emits rectangles for every visual element: each panel's outer cell,
each panel's plot inner, the shared title/subtitle/x-title/y-title
positions, optional scroll dimensions. The renderer (`PlotCanvas.tsx`)
consumes this spec, draws shared chrome, then iterates panels and
delegates each panel's marks to a per-mode renderer.

**Layout priority**: the inner plot rect is the primary alignment
target; padding around it adjusts to the actual rendered tick-label
and title sizes per axis. If one panel needs more space because of
longer tick labels, ALL panels in its row / column get the same outer
padding so the inner rects stay aligned.

### 6.2 Per-mode renderers
- **BarPlot** — vertical (`bars-x`) or horizontal (`bars-y`) bars
  aggregated by category. Stack / group / overlay behavior is
  **per-channel**: every mapped color-like channel (hue, pattern,
  brightness, opacity, saturation) carries its own `stackMode`, and
  the `layoutSlices` engine composes them — `group`-mode channels
  partition the category axis into nested sub-bands (precedence
  **hue > pattern > brightness > opacity > saturation** orders
  outer→inner), while `stack`/`overlay`-mode channels partition the
  measure axis within each leaf sub-band. "Grouped by color, stacked
  by pattern" is hue=group + pattern=stack. `computeBarMeasureMax`
  is leaf-aware so the axis bound matches the bars. Data labels show
  per-bar values.
- **ScatterPlot** — points at (x, y), sized by area, colored by hue,
  shaped by shape. When `connection` is mapped, renders polyline
  overlays (line chart). The Connection panel's "Show points" control
  is the place where point sampling lives — it's a Connection
  feature, not a scatter-wide one.
- **AreaPlot** — stacked or overlaid filled regions. Line vs area
  fill toggle controls outline-only vs filled rendering, and exposes
  independent line and area colors.
- **PiePlot** — single centered pie or grid of pies along x / y.
- **TilePlot** — heatmap grid with hue per (x, y) cell. Cells tile
  FLUSH (zero band padding); like the treemap mosaic, separation comes
  solely from the outline stroke, which follows the universal mark
  outline (the Shape panel's width, the Color menu's Outline color) —
  width 0 gives an entirely gapless grid.
- **HexbinPlot** — quantitative x × y binned onto a hex lattice in
  data space (`lib/hexbins.ts`, shared with the legend), one hexagon
  path per occupied cell, filled through the quantitative hue
  gradient over `[0, maxCount]`. Axis scales are built exactly like
  ScatterPlot's quantitative branch (same domain math the binning
  replicates), so cells align with gridlines; hexagons are the
  affine image of the normalized lattice (they stretch to the plot's
  aspect ratio but still tile). See §3.3 for the mode trigger.
- **RadarPlot** — polar chart: `r` (radial distance) + `angle`
  (spokes), points joined into closed polygons per connection series.
- **GeoChoroplethPlot / GeoSymbolPlot / GeoPointPlot** — the three
  geographic modes (region fill, centroid bubbles, lon/lat dots).
  All draw over a shared **GeoBasemap** (d3-geo projection + region
  outlines) and are gated on MapConfig (§3.3).
- **PackedCirclesPlot / TreemapPlot / SunburstPlot** — the three
  hierarchy layouts, all thin wrappers over `useHierarchyScaffold`
  (tree building from `lib/buildHierarchy.ts`, derived channel
  sources, the per-node fill chain — hue → sat/bri → opacity — the
  scatter outline chain via `resolveShapeColors`, hover tooltips, and
  the axis-less cartesian coord). Each renderer owns only its d3
  layout call and mark emission: `pack` → circles (container labels
  on the top rim, leaves centered), `treemap` → rects (LEAF labels
  only, centered — no container header strips by design; grouping
  reads through color), `partition` → arcs (labels at arc centroids
  when the arc can hold them; sunburst draws its own polar geometry
  like the pie renderer, so canvas traits stay cartesian).
  Labels render only when they fit, and are STYLED by the Data Labels
  section (§6.5): the **Value** field picks each leaf's text (default:
  the node's name from the ID column — so flat / anonymous-grouped
  variants have unlabeled leaves until a Value field is mapped, which
  is also how those leaves GAIN labels), formatted through the decimals
  option; **Color** applies the full label color stack (single color,
  palette-by-hue-field with per-value overrides, gradients, conditional
  rules); **Size** scales each leaf's font across [sizeMin, sizeMax]
  (fit checks use each label's own size), plus font family / weight /
  italic / underline. Containers always show their NAME — a container
  aggregates many rows, so a value field doesn't apply — but take the
  same color/size styling (resolved against their row when row-backed,
  else the single fallback color). Color and Size also offer the
  hierarchy-DERIVED sources (the label analogue of the mark channels'
  derived variables, offered only in tree modes with a mapped
  connection): Color takes **"Top-level group"** (categorical — every
  label colored by its outermost ancestor, implicit containers
  included) or **"Nesting depth"** (ordinal — per-level colors, with
  the same per-value override swatches as a field); Size takes
  **"Nesting depth"** with the TOP level at Max and the deepest level
  at Min — big group titles, small leaf labels; swapping Min/Max
  inverts (deliberately opposite the sat/bri "outermost = Min"
  convention, and noted in the Size panel).
  EVERY mark's border — leaf, row-backed container, implicit
  container — resolves through the one outline chain (`outlineHue`
  when the node has a row, else the Shape outline color, always at
  the Shape outline width; width 0 hides borders). No hidden
  container rim. Without derived colors, packed-circle / sunburst
  containers keep the light wash fill (not yet themeable). The
  TREEMAP is a FLUSH leaf mosaic: zero padding, no container marks
  at all (with no gutters they'd be fully covered anyway) — tile
  separation comes solely from the outline stroke, so outline width
  0 gives an entirely borderless mosaic, and grouping reads through
  leaf colors. Faceting lays out each panel independently.
- **ChordPlot / SankeyPlot** — the two flow layouts, thin wrappers
  over `useFlowScaffold` (graph building from `lib/buildFlowGraph.ts`,
  the union-domain node color scale, edge styling, hover tooltips,
  the axis-less cartesian coord). `chord` (d3-chord `chordDirected`,
  so the two directions of a node pair stay distinct ribbons) → a
  node-arc ring with directed ribbons, self-loops included, node
  labels outside the ring when they fit; `sankey` (d3-sankey) →
  node rects in flow columns joined by links in their source node's
  color at the Ribbons opacity slot (default 0.45 — the translucent
  wash; node rects draw at the Nodes slot, default 1), labels beside
  nodes (flipping to the inside at the last column), cycle-broken
  with the in-plot notice (§3.3).
  Both own their geometry like sunburst does, so canvas traits stay
  cartesian.

### 6.3 Aggregation
Bars, areas, pies, and tile aggregate values per category. If
multiple rows share the same category (or x+hue combination for
stacked charts), their values are summed for the rendered mark.
Scatter and scatter+connection do NOT aggregate — they render one
mark per row.

### 6.4 Title positioning
A single `TITLE_LABEL_GAP_PX` constant (currently 25) controls the
default distance between any axis title and its tick labels.

**Y-offset sign convention (all offset inputs):** every sidebar input
that nudges something vertically — title/facet/legend-title offsets,
data-label X/Y offsets (including first/last endpoint overrides), the
caption Y offset — reads positive = up, negative = down (math
convention, friendlier for non-web users). Stored config values remain
in screen coordinates (positive = down); the sign flips only at the
input boundary, so saved charts are unaffected. This includes the
axis "Adjust position" Y input. The one exception that keeps its own
semantics is the inside-legend X/Y (fractional coordinates, not a
nudge).

User-set per-title offsets (`xAxisTitle`, `yAxisTitle`, `title`,
`subtitle`) shift the title in pixels with **asymmetric** auto-grow
behavior:

- **Moving the title TOWARD the plot**: no plot adjustment. The title
  moves into existing margin space, eventually overlapping axes or the
  plot itself — fine, the user can intentionally place the y-title to
  the right of the axis if they want.
- **Moving the title AWAY from the plot**: the canvas adjusts so the
  title stays in view. The plot shrinks to give the title room rather
  than letting it clip the canvas edge.

Titles respect alignment toggles (left / center / right) and the
y-title can be set to render horizontally instead of rotated -90°.

### 6.5 Data labels
Data labels are a separate layer drawn on top of the chart marks.
They respect alignment toggles (left / center / right glyph
buttons), offer position adjusters in px (apply to the whole label
group along x or y), and have these controls:

In the TREE layouts (packed circles / treemap / sunburst) labels are
placed by the layout itself, not this overlay layer — the panel hides
its position rows and the position / overlap / background fine-tuning
there, and a note says so. Value, Color, Size, and Text Properties
still apply (see §6.2); Value defaults to each row's name. Chord /
sankey label styling is a planned follow-up.

Packed circles additionally get a **Text Position** subheader with one
"Wrap label around" checkbox per CONTAINER level (top level circle,
second level circle, … — levels come from the drawn hierarchy, the
deepest all-leaf level excluded; with no grouping circles the panel
shows a hint instead). A checked level draws its group names on an arc
around the OUTSIDE of the circle (a `<textPath>` over an invisible
baseline arc at the rim plus a small gap); unchecked levels keep the
default placement inside the top rim. Arc placement is
COLLISION-AWARE (`lib/packArcLabels.ts`): each label starts from its
circle's most exposed side (the direction away from its parent's
center — outward for top-level circles) and rotates around the rim in
10° steps until its annular band clears every non-ancestor circle,
every already-placed arc label, and every rim label (ancestors are
exempt — a nested label legitimately sits inside them). Labels that
land on the LOWER half flip their path direction so the text still
reads left-to-right upright (the baseline shifts outward there so the
glyphs occupy the same band). Wrapping the TOP level reserves a gutter
around the pack extent so the outermost arc text doesn't clip at the
panel edge. No clear window — or text longer than ~a
half-circumference — means no label, same convention as the rim fit
check (`arcWrapLevels` in `DataLabelsConfig`).

- **Label format** — every mapped Value takes a per-field format (the
  same preset dropdown + custom d3 spec the axes use), stored in
  `DataLabelsConfig.fieldFormats` keyed by field name. A single mapped
  field shows one format control under the Value row's disclosure;
  "Multiple variables…" shows one per selected field. A set format wins
  over the shared `decimals` fallback, and — because both modes share
  the same store — a format set in one mode carries over to the other.
  The format applies everywhere that field's label renders: row-based
  labels (scatter / lines), aggregated slice labels (bars / areas /
  pies / tile cells), and hierarchy leaf labels. Missing values still
  skip the label entirely (a null measure never renders as "0%").
  A mapped Value field is AUTHORITATIVE: on aggregating charts
  (bars / areas / pies / tiles), slices whose Value cells are all
  blank render NO label — they never fall back to the slice's
  measure. Sparse Value columns are the mechanism for labeling one
  arbitrary point (beyond first/last-per-series) without manual
  annotations, so a blank means "no label here". The measure
  fallback applies only when no Value field is mapped (or it equals
  the measure field), where labels show the slice's aggregated value.
- **Size** — the Default size input always shows; the Min / Max
  pixel-range inputs appear only when a size source is mapped (a field,
  or the tree layouts' derived "Nesting depth"), since the range only
  takes effect then. Default size still applies to values the mapped
  source can't size (non-numeric).
- **Which labels** — All labels / First per series / Last per series /
  First and last per series. Endpoint selection is position-ranked along
  the chart's primary axis (rightmost = last for vertical charts,
  bottom-most for horizontal), not row-order-ranked; "series" is the hue
  field (bars/areas) or connection field (line charts), with no mapped
  series treated as one implicit group. A one-point series counts as
  "last". Legacy saves with the old "Only show last label per series"
  toggle read as "Last per series".
  **First and last** is the only mode with two label populations, so it
  is the only mode that splits controls — the splits live where those
  controls normally live, not in this subsection:
  - Under **Value** (multi-field mode), "Label text" becomes **First
    label text** and **Last label text** (e.g. `{value}` on firsts,
    `{value} {series}` on lasts to directly label lines). An empty box
    inherits the shared arrangement, shown as the placeholder. There is
    still exactly ONE "Label format" section — per-field formats are
    shared across both ends. Endpoint templates only affect row-based
    renderers (scatter / lines); bar and area labels are pre-formatted
    from their slice measure and ignore them.
  - Under **Position Adjustment and Alignment**, the Alignment control
    and the Adjust-position X/Y inputs each become First-label /
    Last-label pairs. Wrap text stays a single shared toggle.
  In the single First / Last modes nothing splits: the layer-wide
  template / offset / alignment drive the one rendered label set, and
  any endpoint overrides left over from a first-and-last session are
  ignored.
- **Avoid overlapping labels** — colliding labels spread apart
  vertically (up or down), each staying as close to its own anchor as
  the minimum gaps allow, preserving vertical order. Stacked end-of-line
  labels are solved exactly (least total displacement); scattered label
  fields fall back to a best-effort downward sweep and may still collide
  when densely packed.
- **Bar label position** — center / inside-base / inside-end /
  outside-end (only meaningful for bars).
- **Text color rules** — conditional overrides (e.g., white text on
  dark heatmap cells, black on light).
- **Per-variable colors** (multi-field labels with 2+ variables) — the
  Color panel replaces the single base color stack with one color slot
  per label variable. An UNCONFIGURED slot inherits the label's base
  color chain — so with a field mapped on the layer's Color channel,
  its "Vary by" dropdown reads "Main Color mapping (field)" and the
  variable's segments follow that mapping; picking it again after a
  change clears the stored slot back to inheriting. Without a Color
  mapping the default reads "Single color" (behaviorally identical
  there). "Single color" / a mapped field store an explicit per-slot
  config as before. Wrap text applies to colored labels too: the
  colored pieces line-break at the same points the plain label would
  (`wrapSegments` splits a piece that straddles a break, keeping its
  fill), with each line's start position derived from the label's
  alignment.

When data labels are enabled, the solver reserves extra right-margin
space if the rightmost label would extend past the plot edge. The
amount is estimated from the longest formatted value × font size ×
0.55 × alignment fraction (full width for left-anchored, half for
center, none for right-anchored), minus the existing default right
margin. Same heuristic the legend uses for its dynamic width. With an
endpoint selection active, the reserve is computed per active endpoint
profile (its template / offset / alignment) and the sides take the max
— so a wide `{value} {series}` last-label template gets the right-edge
room it actually needs.

---

## 7. Labels (titles)

**Font sizes are points.** Every font-size number in the app — titles,
tick labels, data labels, legends, captions, annotations, the text
channel — is a point size, matching what Office/print tools mean by
"size 12". Rendering converts once at the resolution boundary
(`lib/fontUnit.ts`, 1pt = 4/3px per the CSS definition; stored configs
are never converted — the numbers' unit is pt by definition). Combined
with the physical export sizing + DPI stamping (§6), a chart exported
at 6×3in with size-12 axis labels drops into a presentation with text
exactly matching 12pt body text. Layout and measurement code stays in
px; the pt→px conversion happens inside `resolveTitleFont` /
`resolveTextFont` / `resolveLabelSize` (and `resolveTickFontSizePx`
for per-axis overrides), so anything downstream of those resolvers
never sees pt.

The Labels panel covers chart title, subtitle, x-axis title, y-axis
title, and facet/legend titles. Each title has:

- A text field (auto-populated from the encoded field name on first
  map; user overrides stick).
- An alignment control (Left / Center / Right glyph buttons).
- Font override (collapsed disclosure with family / size / color).
- Position offset (X / Y in px) — see §6.4 for the auto-grow rule and
  the Y sign convention (positive = up).
- Y-axis title only: a "Read horizontally" toggle that un-rotates the
  title from -90°.

The panel is organized into four collapsed-by-default subsections:
**Primary titles** (the Shift+Enter hint, Title, Subtitle), **Axis
titles** (X-axis, Y-axis), **Facet titles** (present only when a
facet channel is mapped; a grid split shows the Column and Row title
rows plus — when Hide empty panels is on — the textless **Panel
titles** row, see §4.5a; otherwise the single Facet title row), and
**Legend titles** (present only when legend channels are active).
Each subsection header carries the standard changed dot (§4.6) when
any row inside deviates in STYLING — a font override, a non-center
alignment, a non-zero orientation, a position offset, or the y-axis
"Read horizontally" toggle. Typed title TEXT is content, not styling,
and never lights a dot.

Facet **row** titles (the left-strip labels — the grid-split Row
titles row, and the single Facet title row when only the facet-row
axis is mapped) additionally expose a **Vertical alignment** control
(top / middle / bottom, default middle) alongside their alignment
control, which is relabeled **Horizontal alignment** there. It lines
the title up with the panel's own y-axis tick LABELS — top with the
top-most label, bottom with the bottom-most, middle centered — so on a
categorical y-axis "bottom" sits level with the last category label
(inset half a step from the plot edge, matching the `scalePoint`
padding), not below it. Because each row aligns to its own labels,
rows of differing heights line their titles up as chosen. A non-middle
value lights the changed dot like any other styling deviation. Column
and panel titles sit in thin bands where top/bottom is meaningless, so
they keep the single "Align" control only.

Every facet-title row additionally exposes an **Orientation** number
input (degrees, clamped to -180…180, default 0, "°" suffix) directly
below the alignment control(s). It rotates the facet titles about
their anchor point — e.g. 90° reads a wrap panel's title vertically so
it can label the panel's side — and applies to wrap panel titles, grid
column / row header strips, and compact-grid panel titles alike. In a
grid split the per-strip / per-panel rows layer over the shared facet
angle exactly like alignment (a per-strip value wins; unset falls back
to the shared facet-title angle). The rotation is paint-time only: the
layout solver's title band does NOT grow for the rotated extent, so
steep angles are typically paired with a position offset to place the
title where it should sit (same contract as facet-title offsets). A
non-zero orientation lights the changed dot. Non-facet titles do not
offer the control (the y-axis title keeps its dedicated "Read
horizontally" toggle instead).

---

## 8. Legend

Position options: left, right, top, bottom, inside. Inside placement
uses two number inputs labeled "X" and "Y" (0–1, relative to plot
rect corners).

Channels mapped to the **same field** combine into one legend section
with composed swatches (color + shape + pattern + opacity). The
combined-section title defaults to the field name; users can
override per-channel.

Per-channel visibility lives in the "Legends shown" toggles. Every
mapped channel defaults to shown, EXCEPT the Size (area) legend in
the flow and hierarchy modes (sankey, chord, packed circles, treemap,
sunburst): there the size encoding IS the diagram's geometry, so the
Size legend starts unchecked. The toggle remains — re-checking it
brings the legend back, and that explicit choice persists with the
visual (mode defs declare this via `legend.areaHiddenByDefault`,
resolved through `resolveLegendHidden` in `lib/labelsConfig.ts`).

Legend column width is dynamic — sized to the longest stringified
value, capped at 360px. Below that cap, labels fit without ellipsis;
above it, they truncate.

In line-chart context (combined legend with pattern in the section),
swatches include both the shape pattern and a dash line passing
through the shape — same as the rendered visual.

The "Gradient legend style" toggle (quantitative hue only) switches
between a gradient bar and sampled swatches; both honor the legend's
orientation setting (horizontal swatches lay out in one no-wrap row).

When "Show gradient bar" is selected, the subsection grows bar-styling
controls:

- **Bar length** (px, clear-to-auto) — the bar's height when the
  legend is stacked, its width when horizontal. Auto keeps the
  historical sizing (8rem minimum height vertical; full legend width
  horizontal).
- **Corner radius** (px, default 2) — 0 gives square corners.
- **Tick length** (px, default 0 = no ticks) — above 0 draws a tick
  mark at each break stop, extending outward from the bar toward its
  labels (below a horizontal bar, right of a vertical one). **Tick
  thickness** (default 1px) and **Tick color** (default a neutral
  stone gray) appear only once ticks are on.

The Label formatting subsection additionally offers **Label
alignment** (left / center / right, via the shared AlignmentControl)
whenever a gradient bar is active: under a horizontal bar each break
label anchors its left edge / center / right edge at its stop; beside
a vertical bar the labels align within the label column. The default
(unset) is the historical look — centered under a horizontal bar,
left beside a vertical one.

**Swatch outline** (Color Swatch Shape subsection, below a divider):
a color + width pair drawn as a border around every color swatch —
keeps pale swatches (e.g. the white midpoint of a diverging gradient)
visible against the legend background. Width is the switch: 0 (the
default) draws no outline, so there's no separate toggle. The color
pipes in from the marks' outline color (Color menu → Outline), falling
back to `#cccccc`; picking a color stores an override and "reset"
returns to the piped-in value. Both controls are always visible while
the group shows. The group hides — and the stored setting goes inert —
whenever the outline-color channel is encoded, because the swatch
strokes are then a faithful key for that encoding. The area/radar
split-outline (line-color borders) also wins over it per swatch.

For **left-aligned** legend section titles, the title text indents to
line up with the LABEL text below (past the swatch + gap), not the
swatch's left edge.

---

## 9. Data labels

(Behavior described in §6.5; the panel covers value field mapping,
formatting (decimals, currency / percent / scientific), color, size,
and all the position / alignment / filter controls listed there.)

---

## 10. Tooltips

Toggle on / off. The "Fields shown" list contains a checkbox for
**every variable in the dataset** so the user can decide what goes in
the tooltip — both mapped fields AND unmapped fields are eligible.
For aggregating chart types (bars / areas / pies / tile), the tooltip
shows the aggregated value for mapped fields when those rows are
checked. Plus, there's a custom-HTML escape hatch with template
syntax for users who want to write their own tooltip body, and a CSS
textarea for styling the container. Both textareas are visible only
while "Use custom HTML template" is checked, and neither the template
nor the CSS applies while it's unchecked (contents are retained,
inert). Enabling the toggle seeds empty HTML/CSS textareas with the
default template and default CSS so the user edits from a working
starting point (boxes with existing content are left alone); a
"reset" link below each box — shown only when its content differs
from the default — restores that default.

---

## 11. Annotations

A top-level "Annotations" section in the sidebar. Users can add
**rectangle**, **circle**, and **line-segment** annotations to
highlight regions of the chart. Each annotation's editor is
individually collapsible: a chevron in its header row toggles the
body, while the name box and remove link stay visible so a long list
remains scannable. Existing annotations start collapsed when the
panel mounts; a freshly added annotation starts expanded. Each
rectangle has:

- A name (free text, shown in the panel list).
- **Adjust by** dropdown — Percent (0–100) or Values (data units).
  - **Percent**: xMin/xMax/yMin/yMax are plot-area-normalized (0–1,
    with 0,0 at the bottom-left spine corner).
  - **Values**: same fields are interpreted as data values along
    whichever encoding drives each axis (`x`/`y` for scatter,
    `length` for the measure axis in bars/areas, etc.). Numeric axes
    use the linear/time scale; categorical/string-ordinal axes
    present a category dropdown and the rectangle spans full band
    edges, not just point centers.
- Fill color + fill opacity.
- Border color, thickness, opacity, dash style.
- Layer toggle: **Behind chart** (under marks) or **In front** (over
  marks).

**Circles** (`lib/circleAnnotationGeometry.ts`) are defined by a
center (x, y) and a radius, with the same Percent / Values coordinate
toggle. A circle always renders as a true on-screen circle;
`radiusAxis` selects which axis the radius is measured against in
Values mode (a data-unit radius against a categorical axis can't be
placed and renders nothing). **Line segments**
(`lib/lineSegmentAnnotationGeometry.ts`) run between two endpoints,
each in Percent or Values coordinates. Both share the rectangle's
fill/border/layer styling controls.

All three shapes render per-panel in PlotCanvas, using each panel's
own position scales in Values mode and clipping to the panel's plot
area. The exception is radar: value-mode circles are rendered inside
RadarPlot itself (via `computePolarCirclePixels`, since RadarPlot owns
the radial scales), and value-mode line segments are skipped on radar
entirely; percent-mode shapes still render normally there.

Annotations are per-chart and persist with the visual.

---

## 12. Theme

The Theme panel switches between system themes (Light, Dark) and
user-created custom themes. The Settings page hosts the theme editor.
Theme settings:

- **Categorical palettes** — list of named palettes, each with colors
  and (optional) per-color pattern inks. Set a default palette.
- **Ordinal palettes** — separate list of named palettes from
  categorical, applied when a user maps an ordinal field to hue. Same
  structure (colors + optional pattern inks); has its own default
  palette setting.
- **Linear and diverging gradients** — for quantitative hue.
- **Defaults** — default fill, default shape, default radius, default
  opacity, fonts (separate for titles and text).
- **Gridlines** — separate X and Y gridline color/thickness defaults.
- **Tickmarks, spines, background colors, text encoding font,
  distribution overlay defaults, connection thickness, scale-channel
  min/max ranges** — all theme-controlled.
- **Data label defaults** — font size, weight, and style (italic /
  underline) used by the Data Labels layer. Applied when a chart is
  created or re-themed; the Data Labels panel's reset links restore
  these theme values. Themes saved before these fields existed fall
  back to the built-in defaults (11pt, weight 500, plain).

Custom themes can be set as the user's default; new charts pick that
up automatically. The Hue panel reads palettes from the active theme
live, so palettes added in Settings appear in the dropdown of open
charts immediately.

---

## 13. Aesthetics

A small catch-all panel:

- **Chart background color** — transparent (default), theme default,
  or custom.
- **Scroll mode** — "Fit" (canvas matches container, panels shrink to
  fit) or "Scroll" (preserve minimum panel/category sizes, scroll if
  needed). Avoids squishing very long or wide visuals so much that
  axis labels overlap.
- **Aspect ratio** — a "Fix aspect ratio" checkbox that, when on,
  reveals Length and Width inputs (default 1 : 1). The plot area holds
  that Length : Width shape regardless of viewport size — the chart
  shrinks the longer dimension to fit rather than stretching to fill.
  The shrunk figure centers in the chart area, and the legend keeps
  its normal position relative to the figure (the figure + legend
  pair centers in the viewport).
  Faceted charts apply the shape to each panel individually. While
  on, the ratio overrides the Facet panel's Custom sizing (pixel
  panel width/height), proportional panel weights — differently
  sized panels can't all honor one shape — and scroll-mode panel
  minimums (panels shrink to fit instead of scrolling over blank
  canvas). Motivating case: hexbin
  plots — 1 : 1 makes the axes equal length, so hexagon cells render
  as regular hexagons instead of squashed ones.
- **Draw order** — which overlapping point marks paint on top
  (scatter, dot map, bubble map). "Dataset order" (default) keeps each
  renderer's native paint order: scatter draws rows in dataset order
  (later rows on top); the geo maps draw largest circles first so
  small bubbles stay visible. "Sort by field" stable-sorts marks by
  any dataset field before painting — ascending puts the highest
  values on top, descending the lowest; ties keep dataset order, and
  rows the field can't rank paint first (bottom) so they never win an
  overlap. Paint order only: connection lines,
  scales, and aggregations are unaffected. Sorting the data tray
  never changes draw order — the tray sort is view-only.

---

## 14. Persistence & state

All editor state lives in Jotai atoms and persists to the browser
(no server / external database). Most state persists to localStorage:
encodings, channel configs, labels, legend, tooltip, data labels,
annotations, theme, and the Visuals library. Each atom has a versioned
migration list so future schema changes don't break old saves.

Datasets (parsed CSV rows) are the exception — they persist to
**IndexedDB** (DB `vis-components`, store `kv`), not localStorage.
They can be large, and pooling them into the shared ~5 MB localStorage
budget previously starved thumbnails and silently dropped big uploads
on quota overflow. IndexedDB is durable, browser-built-in, and far
larger. Loads prefer IndexedDB with a synchronous localStorage
bootstrap for first paint and tests; a one-time migration moves any
legacy localStorage datasets blob into IndexedDB on first load.

Visuals are listed in a Visuals library (separate page) — load,
rename, duplicate, delete, organize into folders. Folder organization
is drag-and-drop as well as button-driven: sidebar visual rows and
grid cards drag onto sidebar folders (or "All visualizations" for the
root), cmd/ctrl-click and shift-click build a sidebar multi-selection
that drags as a set, and folders drag onto other folders to re-nest
(cycles and no-op moves are rejected — no highlight, drop ignored).
Selecting a folder in the sidebar shows the visuals of its entire
subtree — descendant folders included — in both the grid and table
views. The folder sidebar is drag-resizable via the handle on its
right edge (208–480 px; width persists across reloads, independent
of the editor sidebar's width). Embedded iframes
sync via an embed-instances mechanism so live previews update when
the source visual's dataset version changes.

### Single-file distribution & bundled examples

`pnpm build` emits ONE self-contained `dist/index.html` (JS + CSS
inlined, unminified so checked-in diffs stay reviewable) meant to be
shared by email/chat and opened straight from disk. Under `file://`
the router switches to hash-based URLs (`index.html#/editor/new`);
served over http(s) it keeps clean paths. The header shows a version
chip (`v1.0`, from package.json via a compile-time define) whose
tooltip is the build timestamp, so any shared copy self-identifies.

Builds can carry **bundled examples**: Settings → Sharing →
"Download examples bundle" exports the author's current library
(visuals with previews, datasets, folders, custom themes) as
`examples.json`; saved over `src/seed/examples.json` and rebuilt, the
bundle hydrates storage on a recipient's FIRST launch only. A library
that already has visuals is never touched, and a recipient who
deletes the examples stays clean (an applied-seed marker keyed on the
export timestamp prevents re-seeding until a genuinely new export
ships). The checked-in seed is empty, which makes seeding a no-op.

---

## 15. Worth flagging (places to question)

These are intentional design decisions worth pinning explicitly:

1. **Area-mode opt-in via `length`** — `x + y + connection` produces a
   line chart, not an area. Adding hue to color lines doesn't promote
   to area. The Connection panel's "Area" toggle is the escape hatch
   (it does the y→length swap behind the scenes).
2. **Hue stack mode default is "stack"** — for bars and areas with
   hue. Scatter ignores it. Switching line → area also forces stack.
3. **Default pattern on points in line charts** — when pattern field
   is mapped in a line chart, point fill defaults to "None"; user
   opts in per-category via the Point-fill swatches. Lines auto-cycle
   dash styles regardless.
4. **DASH_CYCLE is 3 entries** (`dashed`, `dotted`, `dash-dot`); the
   "None" button maps to solid. Custom dash patterns extend this via
   the "Custom" text input on every dash row (per-category, the
   no-variable default row, and the regression line).
5. **Tooltip Fields list always shows every dataset field** — mapped
   or not. Aggregating modes show aggregated values for mapped
   fields.
6. **Title position offset auto-grow is asymmetric** — moving toward
   the plot, no adjustment. Moving away from the plot, canvas adjusts
   so both stay in view (§6.4).
7. **Data label right margin auto-grows** when labels extend past the
   plot edge, but no auto-grow for left, top, or bottom (the y-tick
   label / y-title spacing IS computed within the existing margin;
   the canvas just doesn't expand for that).
8. **Pie modes suppress the unused axis's shared title** so a stale
   axis title from a previous chart configuration doesn't surface on
   pies-y, etc.
9. **Per-channel stack/group/overlay composition** — every mapped
   color-like channel carries its own `stackMode` and hosts its own
   toggle (labeled "Layout" when 2+ stack channels are mapped,
   "Stacking" when one is). Precedence — hue > pattern > brightness >
   opacity > saturation — no longer picks a single winning mode; it
   orders the nesting: `group`-mode channels subdivide the category
   band outer→inner, `stack`/`overlay`-mode channels compose on the
   measure axis within each leaf. A newly-mapped inner channel
   defaults to `stack`, so adding pattern to a color-grouped chart
   yields grouped-by-color / stacked-by-pattern.
10. **Change indicators compare live, from a single source** — the row
    dot, subsection dot, and bold-purple control label (§4.6) all
    compare the current config against the same theme-derived defaults,
    so the three levels can't disagree. "Default" tracks the *active*
    theme, not the value at chart creation, so re-theming re-evaluates
    every indicator. Adding an encoding never dots; only customizing a
    control does. The one deliberate gap is the shared font-editor's
    internal fields, which roll up to their section's dot rather than
    bolding individually.
11. **Categorical spacing distributes evenly per panel** — categories
    space at `panel width / N` with half-step edge margins (d3's
    `padding(0.5)`) on EVERY axis, faceted or not, shared or not; the
    step stretches and scrunches with the panel, two categories sit at
    the quarter points, and a lone category sits centered. When labels
    crowd they auto-tilt, and the chart scrolls only when "Allow
    scrolling" is on in Aesthetics. The earlier faceted first/last-tick
    pixel anchoring (fixed 12px inset on shared axes) was removed
    2026-07-08: it squished the first tick against the axis spine and
    left one-category panels uncentered, and the cross-panel alignment
    it bought already holds under `padding(0.5)` because panels sharing
    an axis have identical domains and identical panel widths (the
    solver keeps column widths / row heights uniform). The
    `firstTickPxOffset` scale option remains available but no caller
    passes it.

---

## 16. Code-audit goals

Once this doc is finalized, the audit should produce a report covering:

- **Drift**: places where the code's actual behavior diverges from
  what this doc describes.
- **Redundancy**: same logic in multiple files / paths that could be
  centralized.
- **Regression risk**: tests pinning contradictory behaviors;
  features where toggling one path breaks another silently.
- **Open items**: features described in this doc that aren't yet
  implemented (these are the "todo" list).
