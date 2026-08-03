# Layout Algorithm

How the chart layout works, end-to-end. Sibling to APPLICATION.md — that
doc describes WHAT the editor does, this one describes HOW the layout
math works under the hood. If the implementation diverges from this doc,
the doc wins (and we update either it or the code).

Scope: this doc covers **cartesian** layout; polar chrome (`POLAR_MARGIN`
in plotLayout.ts) and map projection sizing are not covered here.

---

## 1. Architecture

**One pure solver** ([facetLayoutSolver.ts](src/contexts/chartBuilder/lib/facetLayoutSolver.ts))
emits a typed spec for every rectangle on the canvas. **One renderer**
([PlotCanvas.tsx](src/contexts/chartBuilder/components/viz/PlotCanvas.tsx))
consumes the spec and draws everything in a single SVG. Single-panel is
the `rows=1, cols=1` case — no separate code path.

Coordinate model: SVG-native. `(0,0)` at top-left, y grows downward.
The canvas is the SVG viewport. Everything is positioned in canvas
coordinates.

---

## 2. The reservation cascade

```
Canvas
├─ Outer reserves (around the whole grid)
│  ├─ top:    chartTitle + subtitle + topGrow
│  │            (topGrow = max(titleAwayGrow, subtitleAwayGrow) =
│  │             max(0, -chartTitle.offsetY) / -subtitle.offsetY)
│  ├─ bottom: bottomGrow  (max(0, xTitle.offsetY) — shrinks plot to give
│  │                       x-title-offset its "title stays, graph shrinks" effect)
│  ├─ left:   leftGrow + extraLeftMargin
│  │            (leftGrow = max(0, -yTitle.offsetX);
│  │             extraLeftMargin = data-label overflow for right-aligned labels)
│  └─ right:  max(extraRightMargin, xTickRightOverhang)
│               extraRightMargin = data-label overflow for left-aligned labels
│                                  with positive xOffset
│               xTickRightOverhang = half-width of the rightmost x-tick label
│                                    that spills past inner.x1 on a CONTINUOUS
│                                    x-axis (see §5); 0 for band axes
│
├─ Inner grid = canvas - outer reserves
│  ├─ Distributed across cols by colWeights[c] (= max xWeight in col c,
│  │    OR 1 under shareY + categoryCount, OR 1 under !proportionalSizing)
│  └─ Distributed across rows by rowWeights[r] (= max yWeight in row r,
│       OR 1 under !proportionalSizing — shareX does NOT collapse rows)
│
└─ Per-cell chrome (subtracted from each cell to get inner plot rect)
   ├─ top:    facetLabelBand (FACET_LABEL_HEIGHT_PX = 20) + BASE_MARGIN.top (16)
   ├─ bottom: BASE_MARGIN.bottom (64) + bottomFloor
   │            For interior rows under shareX: SHARED_INTERIOR_AXIS_RESERVE (4)
   ├─ left:   BASE_MARGIN.left (76) + leftFloor
   │            For interior cols under shareY: SHARED_INTERIOR_AXIS_RESERVE (4)
   └─ right:  BASE_MARGIN.right (24)
```

`bottomFloor` comes from `estimateExtraBottomMargin` (§5).
`leftFloor` comes from `estimateExtraLeftMargin` PLUS a `requiredLeftFloor`
that ensures the y-title has room from the canvas edge.

**Strip headers vs. per-panel facet-label bands.** Grid mode's
column/row header strips (`columnHeaders` / `rowHeaders`) are outer
bands at the grid edge (`columnHeaderHeight`, default 20;
`rowHeaderWidth`, default 80); the `facetLabelBand` above is per-cell
chrome. They are geometrically independent, and grid mode may combine
ONE surviving strip with per-panel facet-label bands under hide-empty
compaction (previously the two were never passed together). A strip
whose input is omitted reserves no width/height — a suppressed left
strip leaves no gap. Compacted grids stay dense (or wrap-ragged,
exactly like wrap mode's last row), so the per-cell math below is
unchanged.

---

## 3. Alignment by construction

The single most important invariant: **the inner plot rects across panels
are aligned by their spines, not their pixel widths**.

- `leftFloor` and `bottomFloor` are GLOBAL — computed as the MAX of every
  panel's needed extra margin. Every panel reserves the same chrome
  regardless of which has the longest labels.
- Same-row panels share `inner.y` and `inner.height` (always).
- Same-col panels share `inner.x` and `inner.width` (always under uniform
  sizing; varies under proportional + shareY=false).
- Result: tick marks line up across panels, gridlines line up across
  panels.

---

## 4. Share-axes semantics

| Flag | Effect on chrome | Effect on scale |
|---|---|---|
| `shareX=true` | Interior rows shrink their bottom chrome to `SHARED_INTERIOR_AXIS_RESERVE` (4px). Only bottom row draws x-axis labels/title. | All panels build their x-scale from the FULL dataset rows. Tick marks and gridlines at same x-value align horizontally across rows. |
| `shareY=true` | Interior cols shrink their left chrome to 4px. Only leftmost col draws y-axis labels/title. | All panels build their y-scale from the FULL dataset rows. Tick marks and gridlines at same y-value align vertically across cols. |
| `shareX=false` | All rows reserve FULL bottom chrome (`BASE_MARGIN.bottom + bottomFloor`) — they each need room to draw their own labels. Only bottom row draws the shared x-axis title (the title is a single rendered text per chart, never per-row), but all rows draw their own x-axis labels. | All panels uniquely build their x-scale from the data set rows that are subset by that panel. Tick marks and gridlines do not necessarily align horizontally across rows unless they are identical across panels.|
| `shareY=false` | All cols reserve FULL left chrome (`BASE_MARGIN.left + leftFloor`) — they each need room to draw their own labels. Only leftmost col draws the shared y-axis title, but all cols draw their own y-axis labels. | All panels uniquely build their y-scale from the dataset rows that are subset by that panel. Tick marks and gridlines do not necessarily align vertically across cols unless they are identical across panels.|

Default is `shareX = shareY = true` (per `channelConfig.ts`).

Mark renderers pick up the scale-sharing via `scalesRowsOverrideX` /
`scalesRowsOverrideY` props, which PlotCanvas sets to `dataset.rows`
(the full dataset) when the corresponding share flag is on.

---

## 5. Margin estimation

Two pure helpers in [estimateMargins.ts](src/contexts/chartBuilder/lib/estimateMargins.ts).

**`estimateExtraLeftMargin`** → extra px beyond `BASE_MARGIN.left (76)`:

```
labelPx = longestYLabel × charWidthFactor (0.55) × fontSize + 4
titlePx = if y-title-rotated:  fontSize + 24
          if y-title-horizontal: estimateLongestLineWidth(titleText) + 16
labelAreaAllowance = labelPx (rotated y-title) or max(labelPx, 40 + fontSize) (horizontal)
needed = labelAreaAllowance + titlePx + 24
extra = max(0, needed - 76)
```

**`estimateExtraBottomMargin`** → extra px beyond `BASE_MARGIN.bottom (64)`:

```
labelVerticalPx = labelWidth × |sin(angle)| + fontSize × 1.4 × |cos(angle)|
titlePx         = fontSize × 1.4 × lineCount + 6                (0 if no title)
titleLabelGap   = 25                                            (0 if no title)
tickReserve     = 10
needed = tickReserve + labelVerticalPx + titleLabelGap + titlePx + 8
extra  = max(0, needed - 64)
```

**Polar base margins.** The `- 76` / `- 64` above are the DEFAULT base each
floor sits atop; the solver passes the ACTUAL per-cell base via
`baseMarginPx`. Polar modes (`coordFamily: "polar"`) collapse the cell margins
to `POLAR_MARGIN` (top 4, right 8, bottom 8, left 8) — but `pies-y` and
`pies-x` still draw a real cartesian axis (categorical y / x band). For those,
the base handed to the estimator is `POLAR_MARGIN.left`/`.bottom` (8), so the
floor grows off 8 rather than the phantom 76/64 the polar path never
reserved. A true polar chart (pie / radar) has no cartesian tick labels, so
the estimator returns 0 and the collapsed 8px base stands.

The 1.4 line-height multiplier accounts for ascender + descender + leading.
The 25 `titleLabelGap` matches `TITLE_LABEL_GAP_PX` in the solver — without
it the title would clip ~2-5px past the canvas bottom (was Bug #8).

Both helpers use the 0.55-char-width estimator as a fallback. **In
production, PlotCanvas pre-measures the longest label per axis via
`canvas.measureText` and passes the measured width to the solver, which
uses it in preference to the estimate** (Bug #7). The 0.55 estimate is
20-30% too wide for narrow fonts like DM Sans / Inter; measurement gives
exact pixel parity. When the axis sets an explicit d3-format spec
(`AxisConfig.customFormat`, e.g. `"$,"`), PlotCanvas formats the
representative min/max BEFORE measuring, so the reserve matches the
on-screen label (`"$140,000"`, not the raw `"140000"`).

**X-tick right overhang.** Unrotated x-tick labels are center-anchored on
their tick. On a continuous axis d3 lands the last tick at (or near) the
domain max — i.e. at `inner.x1` — so ~half the label width spills past the
plot's right edge into the `cellMargin.right` (BASE_MARGIN.right = 24) chrome.
A wide label like `"$140,000"` overruns 24px and clips its last character.
The solver's `xTickRightOverhang` (computed over bottom-row panels only)
reserves `max(0, rightExtent − cellMargin.right)` on the outer right, where
`rightExtent` is `w/2` unrotated, `0` for negative-angle (end-anchored,
leaning up-left away from the edge), and `w·|cos|` for positive-angle
(start-anchored) labels. It's a per-panel flag (`SolverPanelInput.
xAxisContinuous`) so band axes — whose edge ticks inset by half a step —
opt out and don't over-reserve.

---

## 6. Proportional sizing

Activated when `proportionalSizing=true` (UI: "Size panels by category
count" or "Size panels by unit").

```
xWeight (per panel) = if proportionalSizingByUnit: data range on x
                      else:                        # x-categories
yWeight (per panel) = if proportionalSizingByUnit: data range on y
                      else:                        # y-categories

colWeights[c] = max(xWeight for panels in col c)
rowWeights[r] = max(yWeight for panels in row r)

innerWidths[c]  = availableInnerW × colWeights[c] / sum(colWeights)
innerHeights[r] = availableInnerH × rowWeights[r] / sum(rowWeights)
```

`proportionalWeightSource` flag distinguishes the two modes:

- `"categoryCount"` (default): weights are integer category counts.
- `"axisRange"` (by-unit): weights are quantitative ranges (can be sub-1
  fractional values, e.g. data range 0.01–0.25).

### Share-axes × proportional interaction

When the user shares an axis, every panel builds its scale from the
FULL dataset rows (not just its own filtered subset — see §4 "Effect on
scale"). PlotCanvas **mirrors this for weight computation**: under
shareX, `xWeight` is computed from the full dataset's x-values per
panel — making every panel see the same `xWeight` — and so colWeights
become naturally uniform. Same for shareY → uniform rowWeights.

This means proportional sizing and share-axes "Just Work" together
without solver-side special cases. The solver is dumb about
share-axes for weight purposes; the smarts live in PlotCanvas where
the full dataset is in scope.

Practical consequences:
- shareX + proportional: x-spacing uniform across rows (because shared
  x-axis already guarantees that). xWeight uniform → cols same width.
- shareY + proportional: y-spacing uniform across cols. yWeight uniform
  → rows same height.
- shareX=false + proportional: per-panel `xWeight` varies → cols can
  vary in width by category count (or quant range under by-unit).
- shareY=false + proportional: per-panel `yWeight` varies → rows can
  vary.
- The "1-col proportional tall stack" use case (default shareX=true,
  user wants varied row heights): shareX doesn't constrain yWeight,
  so per-panel y-category counts still drive different row heights.

### Weight floors

- For category count: `Math.max(1, count)` — a no-category panel still
  reserves 1 slot.
- For axis range: `Math.max(1e-9, range)` — only protects against
  divide-by-zero. The actual floor value doesn't matter because the
  solver distributes by ratio. A previous floor of 1 silently flattened
  sub-1 ranges into uniform widths.

---

## 7. Title positioning

```
chartTitle.y = TITLE_RESERVE × 0.7 + offsetY + titleAwayGrow
                                              ^^^^^^^^^^^^^
                                              cancels negative offsetY,
                                              keeps title in view

subtitle.y   = TITLE_RESERVE + SUBTITLE_RESERVE × 0.75 + offsetY + subtitleAwayGrow

xTitle.y     = plotBottom + xTitleGap + min(0, offsetY)
                                        ^^^^^^^^^^^^^^^
                                        positive offset absorbed by plot growth
                                        (negative still shifts title toward plot)

yTitle.x     = plotLeft - yTitleGap + offsetX
                                      (negative offsetX → leftGrow + canvas adjust)
```

Where:

```
xTitleGap = TICK_LINE_PAD (6)
          + xLabelVerticalPx   ← uses real rotated extent: labelW × |sin| + fontSize × 1.4 × |cos|
          + TITLE_LABEL_GAP_PX (25)
          + xTitle.fontSize

yTitleGap = max(24 + fontSize/2,
                longestYLabelPx
                + TICK_LINE_PAD (6)
                + TITLE_LABEL_GAP_PX (25)
                + (yTitleHorizontal ? 0 : fontSize/2))
                  ↑ rotated y-title's bbox-half-extent
```

`longestYLabelPx` comes from PlotCanvas's `canvas.measureText` measurement
when available; otherwise the 0.55-char-width estimate.

---

## 8. Asymmetric offset behavior (away from plot)

This is the trickiest part of the algorithm. Two cases diverged
intentionally:

### Chart title offset UP (toward away)

Per APPLICATION.md §6.4: canvas grows at the top; **plot moves DOWN** to
give the title room. Title's screen-y stays at its natural position
(the `titleAwayGrow` cancellation in the formula above keeps it there);
the plot's outer reserve grows.

### X-title offset DOWN (positive offsetY, away from plot)

Canvas matches container (no growth). `outerReserves.bottom =
bottomGrow = offsetY`, which subtracts from `inner.height` → plot's
bottom edge moves UP by `offsetY` → graph shrinks. The title's `y` is
computed as `plotBottom + xTitleGap + offsetY`; because `plotBottom`
moved up by `offsetY`, the `+ offsetY` exactly cancels the shift,
leaving the title at its natural screen position. Net: title stays
put, graph shrinks. Matches the user intent: "title is moving down,
but we're keeping the full display in the viewport."

### X-title offset UP (negative offsetY, toward plot)

Multi-phase, implemented June 2026:

- **Phase 1** (`|offsetY|` ≤ `extensionRoom`): `bottomGrow` becomes
  NEGATIVE (clamped at `-extensionRoom`), which makes `outerReserves.
  bottom` shrink → `inner.height` grows → the plot's bottom edge moves
  DOWN by `|offsetY|` toward the title. Title stays at its natural
  screen y.
- **Phase 2** (`|offsetY|` > `extensionRoom`): `bottomGrow` clamps at
  `-extensionRoom` (plot's bottom is at viewport-bottom minus the
  buffer). Excess offset moves the title UP via the
  `+ offsetY` term in `xTitle.y = plotBottom + xTitleGap + offsetY`.
  Title visually advances over the plot.
- **Phase 3** (title would clip viewport top): the solver detects the
  desired-title-y vs `VIEWPORT_BUFFER_PX + ascender`, computes the
  excess as `phase3TopGrowFromXTitle`, and adds it to
  `outerReserves.top`. Plot's top edge shifts DOWN, plot shrinks from
  top. Title is then clamped at the buffer by `clampBaselineY`. The
  user sees title at viewport top + buffer, plot below it with a
  proper gap — Phase 3 visual separation. Approximation: uses
  `containerHeight` instead of computed `canvasH` (exact for fit
  mode; slightly over-shrinks in scroll mode, acceptable).

`extensionRoom = max(0, BASE_MARGIN.bottom + bottomFloor − VIEWPORT_BUFFER_PX)`.
For a default chart with an x-title that's ~75 px past the natural
plot.bottom before Phase 2 kicks in.

### Y-title offset RIGHT (positive offsetX, toward plot)

Symmetric multi-phase, implemented June 2026:

- **Phase 1** (`offsetX` ≤ `leftExtensionRoom`): `leftGrow` becomes
  NEGATIVE → plot's left edge moves LEFT toward title. Title stays at
  natural screen x.
- **Phase 2**: `leftGrow` clamps at `-leftExtensionRoom`. Title moves
  RIGHT into / over the plot via the `+ offsetX` term.
- **Phase 3** (title would clip viewport right): `phase3RightGrowFromYTitle`
  computed similarly to x-title's top-grow, added to
  `outerReserves.right`. Plot's right edge shifts LEFT, plot shrinks
  from right. Title clamped at the right-side buffer.

`leftExtensionRoom = max(0, BASE_MARGIN.left + leftFloor − VIEWPORT_BUFFER_PX)`.
For a chart with a y-title that's ~66+ px past the natural plot.left.

### Chart title and subtitle

These titles sit at the canvas TOP, above the plot. Their multi-phase
treatment is asymmetric to the axis titles because the area ABOVE the
plot is already title chrome — there's no neutral chrome region to
"extend into" the way an axis title can extend the plot toward
itself. Behavior:

- **Negative offsetY** (away from plot, title moves up): `titleAwayGrow`
  / `subtitleAwayGrow` grow `outerReserves.top` → plot moves DOWN
  away from title. Title stays at natural screen-y. Standard since
  before May 2026.
- **Positive offsetY** (toward plot, title moves down): title shifts
  down freely, can overlap with the plot. `clampBaselineY` prevents
  it from clipping the canvas bottom (10 px buffer). No plot-shrink-
  from-bottom companion behavior — that would require adding to
  `bottomGrow` and intertwine with x-title's bottom-grow path
  (deferred; existing behavior is generally usable).

### Y-title — left direction (away)

- **Negative offsetX** (title moves LEFT, away from plot): `leftGrow`
  adds to outer reserve's left → plot's left edge moves RIGHT →
  plot shrinks from left. Title stays at natural screen-x.

### Offset TOWARD the plot (overlap case)

No canvas/plot adjustment. Title moves into existing margin, may overlap
axes or chart. Intentional — user can deliberately place the title over
the chart if they want.

### Viewport buffer (implemented)

`VIEWPORT_BUFFER_PX = 10`. Every title's primary-axis screen position
is clamped at the end of the title-positioning math so its bounding
box stays at least 10px from the corresponding canvas edge:

- **Chart title / subtitle / x-title** — clamped via `clampBaselineY`,
  which accounts for the ascender (~`0.8 × fontSize` above baseline)
  and descender (~`0.2 × fontSize` below). Baseline-y is constrained to
  `[BUFFER + ascender, canvasH − BUFFER − descender]`.
- **Y-title rotated** — `clampRotatedTitleX` clamps `center.x` to
  `[BUFFER + fontSize/2, canvasW − BUFFER − fontSize/2]` so the
  ±fontSize/2-wide bbox doesn't clip the canvas left/right edge.
- **Y-title horizontal** — `clampHorizontalYTitleX` clamps `anchor.x`
  (text-anchor "end") to `[BUFFER + textWidth, canvasW − BUFFER]` so
  the leftmost rendered character can't fall off the canvas left
  edge.

The clamp is a no-op for normal layouts; it only kicks in when the
user offsets a title aggressively. No layout reflow happens when
clamping fires — the title just stays at the buffer position. (A
fully integrated response — where the plot also adjusts when the
title would clamp — is part of the multi-phase open follow-up below.)

---

## 9. Canvas sizing

```
minCanvasH = outerReserves.top + outerReserves.bottom + facetLabelHeight
           + BASE_MARGIN.top + BASE_MARGIN.bottom + 20
canvasH    = max(containerHeight, naturalHeight, minCanvasH)

minCanvasW = outerReserves.left + BASE_MARGIN.left + BASE_MARGIN.right + 20
canvasW    = max(containerWidth, naturalWidth, minCanvasW)
```

The canvas matches the container in fit mode. `outerReserves.bottom`
includes `bottomGrow` (from positive x-title offsetY), which shows up
in `minCanvasH` and subtracts from `inner.height` — so the offset
shrinks the plot rather than growing the canvas. See §8.

`naturalHeight` / `naturalWidth` come from `estimateNaturalDims`: the
canvas size needed to honor `minPanelPx` (scroll-mode floor) AND the
per-panel weight max × `minPxPerCategory`. When `gapY < 0` (ridgeline),
the natural calc suppresses growth — user opted into overlap, so cells
compress to fit. Same idea for `gapX < 0`.

If `canvasH > containerHeight`, the renderer wraps the SVG in a scroll
container — but only when `minPanelPx > 0` (i.e. "Scroll" mode in the
Aesthetics panel). In "Fit" mode (default), the canvas matches the
container and cells compress.

---

## 10. Negative gap (ridgeline)

`gapY < 0` means cells overlap cumulatively in the vertical direction.
`cellYForRow(r) = sum(cellHeights[0..r-1]) + r × gapY`. A negative gap
pulls each successive cell BACK by `|gapY|` per row, so by row N the
cell starts `N × |gapY|` above where it would under positive gap.

Same idea for `gapX < 0` across cols (rare but supported — true
ridgeline charts are usually 1-col, but `gapX < 0` does the analogous
left-shift across cols if you want it).

`naturalGridH = 0` is forced when `gapY < 0` so the natural-canvas
calculation doesn't over-grow assuming positive gaps stacked between
cells.

**Panel-size freeze at gap=0** (implemented May 2026 per user
feedback): once a gap turns negative, the panel SIZE no longer
inflates with further-negative gap values. In `computeInnerDimsArrays`
we use `Math.max(0, gap) × (n-1)` when distributing the inner space,
so cell heights/widths stay at their gap=0 values once we cross into
overlap territory. The negative gap then ONLY drives cumulative
cell-position overlap (in `cellYForRow` / `cellXForCol`), without
inflating panels. Pre-fix, more-negative gaps would "give back" space
and visually inflate the panels — odd UX when dragging the gap slider.

**Canvas extends at top for extreme overlap** (implemented June 2026
per user feedback): at extreme negative gapY (e.g. ≤ -80 for a
4-row stack with cellHeight=64), the cumulative cell shift drives
upper rows above `y = 0`, where they clip off the canvas. The solver
now detects this by simulating the cell positions and computes
`ridgelineTopGrow = max(0, naturalGridOriginY − minCellY)`. The
grid origin shifts down by that amount, canvas height grows by the
same, and scroll wrapper triggers if canvas exceeds container. All
panels remain visible regardless of gapY. Note: the cumulative-
negative-gap math naturally REVERSES the panel-y order at extreme
overlap (last data row ends up at top of stack); this is inherent to
"cells shift cumulatively toward origin" semantics and is accepted
as the visual cost of unbounded ridgeline support.
---

## 10b. Pixel-precise panel-size overrides

In addition to the automatic distribution (proportional / equal-split)
and the ridgeline gap behavior, users can specify **exact pixel
dimensions** for every panel via the **Panel width** / **Panel height**
inputs in the Facet panel. When set:

- Every panel's `inner.width` (or `inner.height`) is fixed to the
  specified value, regardless of proportional weights or rows/cols.
- The canvas grows to honor the override even in "Fit" mode. If the
  resulting canvas exceeds the container, the renderer wraps the SVG
  in a scroll container.
- Override wins over proportional sizing AND over equal-split.
- Blank / `null` falls back to automatic distribution.
- One exception: in the grid/share shapes where proportional sizing is
  *meaningful* (see `rowSizingMeaningful` / `colSizingMeaningful` in
  channelConfig.ts — the same predicate that decides whether the sidebar
  shows the sizing toggle) and the sizing mode is not "off", a stored
  panel dim is ignored at render time. The UI clears the pixel input in
  that state (`useClearPanelDimWhenSizing`), so this only matters for
  stale values on loaded visuals. Everywhere else — including the
  default share="all", where sizing collapses to uniform weights — the
  pixel override applies. UI visibility and runtime gating share the
  helper, so they can't drift apart again.

Flow:
1. UI: `panelWidth?: number | null` and `panelHeight?: number | null`
   on `FacetConfig` ([channelConfig.ts](src/contexts/chartBuilder/lib/channelConfig.ts)).
2. PlotCanvas passes them as `panelWidthOverride` / `panelHeightOverride`
   on `SolverInput`.
3. `computeInnerDimsArrays`: when an override is set, `innerWidths` (or
   `innerHeights`) is `new Array(n).fill(override)` instead of the
   weight-based distribution.
4. `estimateNaturalDims`: the override sets a floor for the natural
   grid dimension, so `canvasW` / `canvasH` grow → scroll wrapper
   appears when needed.

Use cases:
- Matching a print / export specification ("each panel must be exactly
  400×300 px").
- Fine-tuning a chart's visual rhythm after the auto-distribution gets
  it close.
- Locking dimensions while iterating on other settings (e.g. data
  labels, annotations) so layout doesn't drift.

---

## 11. Quantitative label representation

For quant axes, PlotCanvas can't see d3's tick formatter at solve time
(scale is built later in the mark renderer). It passes a
`toPrecision(4)`-formatted min/max as the representative tick labels
for margin estimation — close enough to d3's "nice" tick widths, but
doesn't blow up on raw values like `148.50000000001` (Bug #6).

This only affects the MARGIN ESTIMATE — actual rendered tick labels are
whatever d3 picks at draw time.

---

## 12. Title-offset symmetry — RESOLVED

All four titles now follow the "plot edge moves AWAY from title; title
stays at natural screen position" convention when the user offsets a
title AWAY from the plot:

- Chart title up (negative offsetY): `topGrow` adds to outer top
  reserve → plot top moves down → graph shrinks from top.
- Subtitle up: same via `subtitleAwayGrow`.
- X-title down (positive offsetY): `bottomGrow` adds to outer bottom
  reserve → plot bottom moves up → graph shrinks from bottom.
- Y-title left (negative offsetX): `leftGrow` adds to outer left
  reserve → plot left moves right → graph shrinks from left.

The "toward plot" direction for each is unchanged — title moves freely
into the plot area, can overlap chrome / marks.

The viewport-buffer clamping and the multi-phase toward-plot behavior
are implemented too — see §8 (June 2026).

---

## 13. Magic numbers worth flagging

These are constants in the solver / margin estimator that don't have
explicit justification in the doc but materially affect layout:

| Constant | Value | Where | Why |
|---|---|---|---|
| `BASE_MARGIN.top` | 16 | plotLayout.ts | Above plot, below facet label |
| `BASE_MARGIN.right` | 24 | plotLayout.ts | Right of plot |
| `BASE_MARGIN.bottom` | 64 | plotLayout.ts | Below plot — accommodates tick labels + some title room |
| `BASE_MARGIN.left` | 76 | plotLayout.ts | Left of plot — accommodates tick labels + some y-title room |
| `FACET_LABEL_HEIGHT_PX` | 20 | PlotCanvas.tsx | Per-panel facet-label band |
| `TITLE_RESERVE` | 36 | plotLayout.ts | Above chart, for chart title |
| `SUBTITLE_RESERVE` | 22 | plotLayout.ts | Below chart title, for subtitle |
| `SHARED_INTERIOR_AXIS_RESERVE` | 4 | facetLayoutSolver.ts | Interior row/col chrome under share-axes |
| `TITLE_LABEL_GAP_PX` | 25 | facetLayoutSolver.ts AND estimateMargins.ts | Gap between tick labels and axis title |
| `TICK_LINE_PAD` | 6 | facetLayoutSolver.ts | Gap between plot edge and tick labels |
| `charWidthFactor` | 0.55 | estimateMargins.ts | Avg sans-serif px-per-char per fontSize unit |
| `MIN_TITLE_X` | 12 + fontSize/2 | facetLayoutSolver.ts | Floor for y-title's distance from canvas left edge |
| `DEFAULT_MIN_PX_PER_CATEGORY` | 20 | facetLayoutSolver.ts | Scroll-mode floor: each category gets ≥20px |
| `DEFAULT_MIN_PANEL_PX` | 200 | facetLayoutSolver.ts | Scroll-mode floor: each panel gets ≥200px |

---

## 14. Things I'm less sure about

- **`SHARED_INTERIOR_AXIS_RESERVE = 4px`** — magic number, no
  justification. Might be too thin (interior axis spines clip?) or too
  generous.
- **`fontSize/2` in yTitleGap formula** — compensates for rotated
  y-title's bbox half-extent when `text-anchor="middle"`. I think this
  is right but haven't proven it from first principles.
- **Shared interior reserve under `shareX + shareY` in 2×2** — top-left
  cell has full chrome on top + left; bottom-right cell has full chrome
  on bottom + right; the other two have full chrome on two adjacent
  sides + SHARED on the other two. Asymmetric but works in practice.
- **Quant range floor of `1e-9`** — protects divide-by-zero in
  `colWeightSum`. For mixed scales (millions vs 0.01) the proportional
  split could produce sub-pixel cells. There's no minimum-pixel-per-panel
  enforcement in fit mode.
- **Title alignment** — chart title / subtitle / x-title / y-title each
  have left/center/right alignment along the plot grid extent. Y-title's
  alignment options (top/center/bottom) map to its y position via a
  ternary in the title-position formula. Hasn't been stress-tested
  against the asymmetric offset behavior.

---

## 15. Fixed aspect ratio

The Aesthetics panel's "Fix aspect ratio" option pins every panel's
inner plot rect to a user-chosen shape. It reaches the solver as
`SolverInput.aspectRatio?: number | null` — the desired
**height / width** ratio (PlotCanvas computes it as Length ÷ Width from
`ChannelConfigs.aspectRatio`). `null` / `undefined` / `≤ 0` = off.

**Ratio wins.** At the top of `solveFacetLayout`, when the ratio is
active the input is shadowed once so every downstream reader sees a
neutralized configuration:

- `panelWidthOverride` / `panelHeightOverride` → `null` (§10b pixel
  overrides are bypassed),
- `proportionalSizing` → `false`, and
- `minPanelPx` → `0` (scroll-mode panel minimums are forced to fit
  mode — a shrunk-to-ratio panel can't honor them, and fit mode avoids
  a scroll wrapper over mostly blank canvas; the ratio never triggers
  scrolling).

A uniform per-panel shape can't coexist with differently sized panels
sharing row/col tracks, so the ratio simply takes precedence rather
than trying to reconcile.

**Shrink rule.** The solver first computes the uniform inner
width/height arrays exactly as it would with the ratio off (equal
split of the available grid space). Then, with `w` / `h` the resulting
per-panel inner dims and `r` the ratio:

```
w·r ≤ h  ?  heights := w·r  :  widths := h/r
```

i.e. the binding dimension keeps its solved size and the other
SHRINKS to match. Because the neutralized input guarantees uniform
arrays, constraining index 0 and filling the arrays is exact.

**Never grows.** A dimension is only ever reduced — the ratio never
requests more space than the ratio-off solve produced, so it can't
force scroll mode or push chrome around.

**Leftover space.** The freed pixels are NOT redistributed to panels —
gaps and chrome keep their ratio-off sizes, and per-cell origins are
still cumulative sums of the SHRUNK cell dims — but the grid is
CENTERED in the freed space: the solver shifts the grid origin by half
the slack per axis, and strip headers follow the shift. The slack (the
space unused by the placed grid: the shrink plus any ridgeline
overlap, since the used extent is measured with signed gaps) is
exposed as `FacetLayoutSpec.figureSlack`. ChartCanvas consumes it via
`currentRenderedFigureSlackAtom`: edge legends are pulled toward the
figure by half the slack with a PAINT-ONLY `transform` (a real
negative margin would grow the flex-1 chart area and feed back into
the solve), so the `[figure][legend]` ensemble centers in the
viewport; inside-mode legends get slack-adjusted `insideExtras` so
they anchor to the figure's plot corners. Ratio off → `figureSlack`
is `{x: 0, y: 0}` and all of this is an exact no-op.

Applies per panel under faceting, and — unlike the §10b pixel
overrides, which are facet-only — to single-panel charts too. That's
the headline use: a 1:1 ratio gives equal-length axes, so hexbin cells
render as regular hexagons.
