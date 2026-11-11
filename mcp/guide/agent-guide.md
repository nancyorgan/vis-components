# Zafiro agent guide

This guide documents, at length, the rules the MCP server's instructions and
tool descriptions carry. No tool or resource serves it. Zafiro is encodings-first: you
say which field goes to which channel, and the chart type follows from that.
You never pick a chart type first.

## Channels and what they make

A channel is a visual property a field can drive. The channels are `x`, `y`,
`length`, `hue` (color), `outlineHue`, `area` (size), `shape`, `pattern`,
`connection` (lines joining points, or a hierarchy), `angle`, `r`, `opacity`,
`saturation`, `brightness`, `facet`, `facetRow`, `facetCol`. Each accepts some
data types; `create_chart`'s `variation` description lists the exact
variation names. `family` (or a `variation` by name, which implies
its family) in a spec picks a variation's seeding; the encodings still
decide what draws. In `edit_chart`, a `variation` re-shapes the chart as
that variation (stacked to grouped bars, a sankey to a chord) and keeps its
titles, legend, labels and theme; one the encodings can't make is refused
with what it needs.

What a set of encodings draws. A setting named here goes in the spec's
`settings`.

| Encodings | What Zafiro draws |
|---|---|
| `x` + `length` | vertical bars; add `hue` for grouped or stacked bars (`stack`), `pattern` for patterned stacks |
| `y` + `length` | horizontal bars; add `hue` for stacked |
| `x` alone (quantitative) + `channelConfigs.x.histogram.enabled: true` | histogram |
| `x` alone (quantitative), `family: "density"` | density curve (filled: its second variation) |
| `x` + `y` | scatter; add `area` for bubbles, `shape` for shape-coded points |
| `x` + `y` + `channelConfigs.connection.axisStem: "x-axis"` (or `"y-axis"`) | lollipop: points with stems to the axis |
| `x` + `y` + `connection` | line chart (`connection` is the series field; one line per level) |
| `x` + `length` + `connection` | stacked area; add `hue` for overlaid areas |
| `x` + `y` + `length` | vector field: a segment at each point (add `angle` for direction) |
| `x` + `y` + `length`, `family: "combo"` | bars with points; add `connection` for bars with a line |
| `y` categorical + `x` quantitative + `hue` (two levels), `family: "dumbbell"` | dumbbell: the two points of each category joined (`shape` and `area` optional) |
| `x` categorical + `y` quantitative, `family: "violin"` | violin or box plot (its variations) |
| `x` + `y` (both categorical) + `hue` | tile heatmap |
| `x` + `y` (both quantitative), `family: "hexbin"` | hexbin: hexagonal density |
| `angle` (+ `hue` for the slices) | pie; `x` or `y` categorical makes one pie per level |
| pie + `channelConfigs.angle.donutHoleRadius` (5–90, percent of the radius) | donut |
| `angle` + `r` + `connection` | radar; `family: "radar"` variations fill it or draw dots |
| `area` + `connection` | packed circles; `variation: "Treemap"` or `"Sunburst"` for those |
| `area` (the flow value) + `connection` (the source column), `variation: "Sankey diagram"` or `"Chord diagram"` | flows; the target column is found from the data (a warning names it; `channelConfigs.connection.flowTargetField` picks another) |
| `hue` (the value), `variation: "Choropleth"` | regions colored by value; the region column (US states, counties or countries) is found from its values and goes on `connection`, or name it there yourself |
| `area`, `variation: "Bubble map"` | sized circles on the regions, as for a choropleth |
| `variation: "Dot map"` | points on a map: longitude and latitude columns are found and go on `x` and `y` |
| any of these + `facet` (or `facetRow` + `facetCol`) | small multiples |

A bar's value goes on `length`, not `y`. A category on `x` with a measure on
`y` draws points, not bars; points with stems make a lollipop, and `x` + `y`
+ `length` makes a vector field, not a combo chart (use `family: "combo"`).

## Start from the primary comparison

- The first question is the comparison, not the chart. If the request has no
  comparison in it, ask: "What is the primary comparison you're trying to
  facilitate?" Say "facilitate", not "make".
- The primary comparison is two dimensions, normally `x` and `y` (on a polar
  chart, `angle`). Even one variable is compared across something.
- Every preposition adds one encoding: X versus Y *across* A, *among* B,
  *within* C, *between* D, *by* E. Each is a new `hue`, `area`, `pattern` or
  `facet`. As prepositions chain, you are adding ingredients.
- When everything is important, it can all appear, but there is one `x` and
  one `y`, so one comparison has to be primary.
- If the request names a comparison, build a first version with it, then edit
  that same chart. Secondary comparisons wait until the person has seen the
  first version; then you may invite one ("Would you like to facet by
  region?") without recommending it.
- A first version is the simplest chart that lets the reader make the primary
  comparison, for the data as it is.

## Pick encodings by data type

Position is best for every type. After that the order depends on the type.
Hue is very good for names and bad for numbers; length is good for a value and
bad for categories, even ordered ones. Use the ranking to place the
comparisons the person asked for, never to override an encoding they named.

| Rank | Quantitative | Ordinal | Nominal (Zafiro: categorical) |
|---|---|---|---|
| 1 | position (`x`, `y`) | position | position |
| 2 | `length` | density | `hue` |
| 3 | `angle` | `saturation` | `pattern` |
| 4 | slope (`connection`) | `hue` | `connection` |
| 5 | `area` | `pattern` | containment |
| 6 | volume | `connection` | density |
| 7 | density | containment | `saturation` |
| 8 | `saturation` | `length` | `shape` |
| 9 | `hue` | `angle` | `length` |
| 10 | not `pattern` | slope | `angle` |
| 11 | not `connection` | `area` | slope |
| 12 | not containment | volume | `area` |
| 13 | not `shape` | not `shape` | volume |

Source: Trilliant Health Data Visualization Style Guide, General Visualization
Training.

- **Categorical** (nominal): things called by name with no intrinsic order:
  countries, companies, people. Alphabetizing or ranking them uses another
  variable, or can be requested by the user ("Alphabetize the state names":
  `fieldLevelOrderSpecs`).
- **Ordinal**: an intrinsic order without a measurable distance: 1st, 2nd, 3rd.
- **Quantitative**: ordered, with measurable distances.
- **Temporal**: dates and times. Time goes on `x`.

## Claims become comparisons

People bring hypotheses ("show that the growth came mostly from Medicaid").
Don't reject it and don't confirm it: mold it into a comparison. One dataset
can't prove causality; it can show an association. Say: "I can't prove
causality, but I can help with the comparison between Medicaid and commercial
growth," and keep leaning back to the comparison.

## Data is not edited for aesthetics

Don't drop outliers or nudge values to make a point clearer. Say: "This visual
is better served by preserving all of the values. If you'd like to emphasize a
trend, I can add a regression line."

## Bar axes start at zero

A bar is read by its length. A bar axis that starts above zero changes the
ratio, so the bars no longer compare what they appear to compare. Refuse it and
offer something that does not use length: points, a dumbbell, a lollipop, or a
line. A shorter axis is valid when the point is the differences rather than the
amounts; just don't use `length` for it. Zafiro does not stop a bar axis from
starting above zero, so this refusal is yours to make.

## Dual axes: two figures

Zafiro has no dual axis. Offer two separate figures, normalizing the values in
each variable so that they can share an axis, or displaying the two competing
variables on `x` and `y` as a scatterplot, possibly with data labels at each
point to label the third value.

## Keep text horizontal

Time goes on `x`. Many categories go on `y` (horizontal bars or lollipops)
rather than angled labels on `x`. Beyond that, whatever reads best.

## Titles

Every chart gets titles.

- A main title: a generic one is fine ("Comparison of A and B"), or the
  person's words.
- Axis titles from the field names or the person's words. Add a unit only when
  the field name or the person states it; otherwise ask rather than guess.
- Variable names make accurate but plain titles (`value_basis`). Offer to turn
  axis, legend and facet titles into sentence case; don't do it unasked.
- Leave data values as they are; don't recase them.
- In replies, put field names in backticks so underscores don't render as
  formatting.

## Colors come from the theme

Use the theme's palettes (`list_settings` with the chart's id shows them).
Send a hex color only when the person gives one, or when the palette has no
color for what they ask (a red on an all-green palette). Label text that should
match its series uses the theme's text palette, not the mark colors.

## Settings behave like the editor's panels

`settings` reaches every stored setting by the paths `list_settings` lists.
A setting does what its panel does: a new annotation gets the theme's style
and a name, a data-label value fills its position from the chart's axes and
gets its labels, an "Order by" spec computes the order, a palette id brings
its colors, thickness by field seeds every level, numbers clamp to the
input's range, and a value equal to its default is stored as unset. A refusal
names the setting that unlocks it; read it and change that setting rather than
retrying. Read a chart (`get_chart`) before replacing one of its lists.

## Year axes

A year field on an axis prints as "2,019" by default. Give that axis the format
`d` (`axes: {x: {format: "d"}}`).

## No redundant legends

When a field is already on an axis, a legend repeating it adds nothing. If the
same field is also on `hue` (to color bars by a threshold, say), hide that
legend with `settings: {legendConfig: {hidden: {hue: true}}}`. If the same
variable is encoded with multiple channels, like color and shape, keep the
default that combines them into a single legend.

## Lollipops

A lollipop is a point with a stem; the point is the emphasis, the stem connects
it to the axis. In Zafiro it is a scatter with stems: the category on one
position, the value on the other, and `channelConfigs.connection.axisStem`
pointing at the value's axis (`"x-axis"` when the value is on `y`). A stem
shows length, so it starts at zero unless the person asks for another baseline
(`"custom-y"` with `axisStemCustomY`). Say it is built as a scatter with stems.
