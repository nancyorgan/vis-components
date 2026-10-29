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
button under Data in the left menu bar, or **paste** delimited text
into the data tray. The tray header's "Paste data" button opens a
dialog with a text box; so does pressing Cmd/Ctrl+V anywhere on the
page that isn't a text field, when the clipboard holds tabular text
(a tab or a second line), with the clipboard text already in the box.
The header's "Drop a CSV to upload, or Paste data" invitation shows
only while NO data set is loaded: once there is data in the tray the
user has plainly found their way in, and the strip keeps just Reshape
and Collapse/Expand. Dropping a file onto the tray and the Cmd/Ctrl+V
paste keep working regardless.
The delimiter is auto-detected — a spreadsheet selection arrives
tab-separated, a CSV's contents comma-separated, a single column has
no delimiter at all — and the first row is the header, as with a
file. Under the text box the dialog previews the PARSED result live
as a small table — every column, numbers right-aligned, the first
six rows (with "first 6 shown" when
there are more), scrolling sideways when wide — or the parse
complaint, and refuses a paste with no data rows. With no
visual open it asks for a data set name (required; a name another
data set already carries only WARNS — see "Data set names" below) and
creates the data set on the spot; with
a visual open there is no name field — the parsed rows go to the
same Add-data prompt a dropped file reaches, which collects the name
on its "start a new visualization" branch. A pasted version carries
"Pasted data" where a file's version would carry its filename. Size
and cost gates below apply to pasted text byte-for-byte as they do
to a file.

When uploading INTO an
existing visual, they're asked: add as a new dataset *version* (live
iframes embedding this visual update automatically), OR detach into a
brand-new visual. New datasets get their type-inferred fields and
become available across the workspace; field types can be adjusted by
the user as appropriate, and those adjustments are reflected in the
visual. New dataset versions are **additive** (`lib/datasetCompat.ts`):
a version must keep every column the dataset already has, with the
same inferred type, but it MAY bring net-new columns — those are
merged into the dataset's field list and become mappable like any
other field. Dropping a column or changing an existing column's type
is still rejected, and the upload dialog names the offending columns;
the net-new columns are reported separately as an informational note,
not as a blocker.

**A fresh file into a working copy.** A reshape and a derived variable
are functions of the data; a hand edit is a patch on cells (§2.1,
§2.1b, §2.1c). A working copy's versions are judged and replayed
accordingly (`lib/versionReplay.ts`, `store/appendImportVersion.ts`):
the upload is checked against the columns of the IMPORT the data
set's latest chain descends from (follow `editedFrom` to a version
without one), not the latest version's — so the original wide file is
never "incompatible" with its own reshaped or derived copy — and, once
appended as an imported version, every version of that chain a reshape
or a derived variable made is re-done over it in chain order, one new
version per step with the same stand-in file name and `transform`,
hand-edited versions skipped. The last replayed version becomes
latest, so the chart snaps onto the fresh data with its columns
intact, and the raw upload sits one step below it, downloadable as
imported. The dialog previews it ("Will re-apply: reshape (wide →
long), “Growth”."). A step the fresh data can't feed — a variable
reading a column a hand edit had added, a reshape over columns the
file lacks — is left out, named in the dialog ("Can't re-apply:
“Margin” (needs “Notes”).") and on the last version the replay made
(`transform.skipped`, tagged "couldn't re-apply" in the version list);
anything mapped to it follows the missing-field path, and the rest
still replay. A net-new column rides through the replay like any other
column (a melt drops it from the long table as it does any column in
neither list). A data set holding only imports has no steps: the
upload simply becomes latest, as it always did.

Uploads are also checked for cost, in `lib/datasetLimits.ts`. A file
over 100 MB is REJECTED outright (the self-host server enforces the
same limit independently); one over 25 MB imports with a note that
charts may be slow. Separately, a data set over 50,000 rows, or with
any column holding over 5,000 distinct values, imports with an
advisory note suggesting the user pre-aggregate the data before
importing. These cost notes are advisory ONLY: the data is imported
whole, and the tool never bins, caps, or samples a column on the
user's behalf — a wide-open category axis is a legitimate thing to
ask for, and silently reducing it would misreport the data. Both
apply in browser-local and server mode alike, since the browser is
the real constraint.

Cost notes appear in a **centered modal that stays until the user
dismisses it** ("Got it"; Escape also closes, a backdrop click
deliberately does not). The notice is held in `uploadNoticeAtom` and
rendered from `RootLayout`, ABOVE the router outlet — not by the
upload control, because choosing "start a new visualization"
navigates, and a note owned by the sidebar was unmounted before it
could be read. A rejection (over 100 MB) is different: it blocks the
import, so it stays inline next to the control that triggered it.

**Download data.** The dataset summary under the upload button (name,
then "N rows · N fields · vX of Y") ends with a purple, underlined
"download data" link that hands the bound dataset back as a CSV
(`lib/downloadDataset.ts`), so a dataset that only survives inside a
visual can be edited and re-uploaded. It exports the RAW rows of the
version currently shown (the preview version when one is pinned):
cells exactly as imported — "$1,234.56" stays "$1,234.56" — with no
cell conversion. A version a reshape or a derived variable made
(§2.1b, §2.1c) exports its stored rows, long or computed: those ARE
the data now; only an older visual's live reshape and derived columns
are left out, since they are per-visual and wouldn't survive a
re-upload.
Headers are the fields' CURRENT names; a renamed variable re-imports
through its `sourceNames` alias. An imported version downloads under
its own file name (`2024.csv`); a pasted one, and a version a hand
edit, a reshape or a derived variable made, under the dataset name
(slugified, `.csv`).

**Edit data (the tray's Edit dialog).** The tray header carries
**Edit** between Reshape and Collapse while a data set is loaded. It
opens a dialog with the version shown as a **grid of cells** — the
same RAW content "download data" produces (current field names,
cells as imported, no reshape / conversion / derived columns) — plus
a data set name box. The grid has plain spreadsheet manners
(`drawer/EditDataGrid.tsx`, model in `lib/editGrid.ts`): click a cell
to select it, drag or Shift+click / Shift+arrows for a range, click a
row number or a column name for the whole row or column; double-click,
Enter or simply typing edits a cell (Enter / Tab / arrows commit and
move, Escape cancels the edit — a second Escape closes the dialog);
Delete / Backspace blanks the selection; ⌘C / ⌘X / ⌘V move
tab-separated blocks to and from the clipboard, so a block copied
from a spreadsheet pastes straight in (a block pastes from the
selection's top-left corner and grows the table with new rows as
needed; a single value pastes into every selected cell); ⌘Z / ⇧⌘Z
undo and redo every change made in the dialog. A "+" past the last
column name adds a column (named "Column N" and selected; column
names are NOT edited in the dialog — a variable is renamed in the
Fields panel, §2.2), and the blank line under the data adds a row:
its "+" in the row-number gutter lands on the first cell, a click in
one of its cells lands on that column. Rows and columns are deleted
from a right-click menu (Shift+F10 or the Menu key from the
keyboard): right-clicking a row number, a column name or a cell
outside the selection selects it first, and the menu names what it
covers ("Delete 2 rows" from a row number, "Delete column" from a
column name, both from a cell). The toolbar keeps Undo / Redo only.
Each column header has a sort control (⇅ → ▲ → ▼ → off) that
reorders what is SHOWN only — the saved rows keep their import order,
so sorting to find a cell never reads as a change. A
column that writes its numbers a particular way — comma-grouped
"2,123,123", dollars "$1,234.56", accounting "(1,234)", percents
"14%" — keeps writing them that way: a number typed or pasted into it
is rewritten to match (`lib/cellFormat.ts`: "2222" → "2,222", "7" →
"$7.00", "5" → "5%"), with the column's decimal places or more when
more were typed (never fewer), while text and blanks are stored as
typed and a plain-number or text column enforces nothing. The
dialog refuses to save with a blank or duplicate column name, no
columns, or no non-blank row. Cells that differ from the data as the
dialog opened are outlined in the grid as in the table. Rows render
through a window, so a large data set opens instantly. Changing the
data never touches imported data, and a hand edit is one of three
changes that land the same way — a reshape (§2.1b) and a derived
variable (§2.1c) are the others; all three go through
`store/commitDatasetVersion.ts`: the first change to an imported data
set **creates a new data set** (the dialog says so; the name box is
prefilled `<name> (edited)`, and a colliding name warns as everywhere
else) whose v1 is a copy of the version shown (same file name, note
and upload time — and its own column list, `DatasetVersion.fields`,
when the change dropped or added columns, see §2.4) and whose v2 is
the edited rows, filename "Edited data", marked `editedFrom` v1
(`DatasetVersion.editedFrom`, optional and additive like
`keyAliases`; a hand-edited version records nothing else, where a
reshaped or derived one records its `transform`). The editor rebinds
to the new data set and every draft atom is left alone, so the
visualization simply continues on the edited data — encodings and
field overrides included — and the version badge reads `v2 of 2 ·
latest`. The imported data set is untouched; other visuals keep it,
and the orphan sweep (§2.4) collects it if none does. A change to a
data set that is ALREADY a **working copy** — one holding any version
made from another, hand-edited, reshaped or derived (`isWorkingCopy`,
`lib/datasetEdits.ts`) — **appends** a version to it (`editedFrom` the
version shown) rather than forking again — the dialog says so and its
button reads "Save new version"; the name box renames the data set
when changed.

Columns are matched to fields by `planEditedFields`
(`lib/datasetEdits.ts`): a header equal to a field's current name is
that field, a header equal to a field's FORMER name is that field
(the rows carry the former key and remap at view time, as for an
upload), the remaining headers and remaining fields pair up in order
as **renames** — such a pair renames the variable exactly like the
Fields-panel rename (old name appended to `sourceNames`, the open
editor's atoms rewritten through `renameFieldAcrossEditorAtoms`) —
and what is left is an added column (edited side) or a dropped one
(field side). A fork drops dropped columns and keeps a matched field's
stored type only when the new inference is compatible with it (the
version-upload leniency), taking the new inference otherwise; an
append keeps dropped fields (the field list is shared across
versions; they read empty for the new version) and pins every type.
A dropped-and-added pair reads as a rename by design (the grid does
not edit headers, so the pair arises from a deleted column plus an
added one): a rename carries the encodings along where a drop would
strand them.

Under the box a live summary reads the parse complaint, "No changes
yet." (Save disabled), or `N rows · M columns · X cells changed · Y
rows added · Z rows removed · added/dropped/renamed: …`. Save is
disabled until the text parses, differs from the seed, and a name is
present; the size gate applies as for a paste.

In the data table, every cell that differs from the chain's **base**
— follow `editedFrom` through hand-edited versions until one that
isn't: the most recent import, or the nearest version a reshape or a
derived variable made (it has a `transform`) — is outlined with a
dotted purple line (`.vc-edited-cell`, inset so it clears the cell
borders; `title` "Changed by hand"). Highlights therefore accumulate
across repeated edits of the copy and reset when a new version is
uploaded, reshaped or given a derived variable.
`alignEditedRows` (`lib/datasetEdits.ts`) pairs edited rows with base
rows: rows exactly equal to a base row (over the columns the base
has) anchor to it monotonically; the rows between two anchors pair by
best cell similarity when the gap is small (≤ 48 × 48), positionally
otherwise; a paired row outlines its differing cells, an edited row
with no partner (an added row) outlines every cell, base rows without
a partner count as removed (nothing to outline). A renamed column
compares under its current name (base rows go through
`resolveDatasetView`'s remap); an added column differs everywhere.
The base rows load lazily through `ensureVersionRowsLoadedAtom`
(`useEditedCells`); nothing is outlined until they arrive, and
nothing is outlined while an older visual's live reshape is applied
(melted rows are new rows — the table outlines by RAW row index,
sorting row indices rather than row copies so the mapping survives a
sort). The version popover tags hand-edited versions "· edited by
hand" (and reshaped / derived ones with what made them, §2.4).

**Data set names.** The id is a data set's identity; the name is a
label, and two data sets MAY share one. Every path that names a new
data set (the Add-data prompt's "start a new visualization" branch,
the Paste-data dialog) warns — amber, not blocking — when the name
another data set already carries (`nameCollides`: trimmed,
case-folded) is typed, so the user knows two entries will read alike;
the fresh-editor upload, which takes the filename with no prompt,
creates silently. The only refusal left is an upload whose hash
matches an existing same-named data set (a probable byte-identical
re-upload) that the store couldn't load to confirm — storing it would
be the very copy dedupe exists to prevent. The bound data set's name
in the summary line is a click-to-edit rename control (a pencil
appears on hover): Enter
or blur commits, Escape or an emptied box cancels, and a colliding
draft shows the same warning inline without blocking. The rename
writes the body through `mutateDatasetBodyAtom` with a refreshed
`contentHash`; the index derives from the loaded body, so the library
table and grid, the data-set filter, and the version badge show the
new name with no second write. There is no cascade — visuals bind by
id.

### 2.1b Reshape (wide → long, long → wide)
The tool wants long data (one observation per row), but users often
arrive with wide tables (one column per category — Monday, Tuesday,
…). A **"Reshape"** button in the data-table tray header (visible
whenever a dataset is loaded) shows/hides the reshape options panel
under Data in the left menu (expanding the Data section if
collapsed). The panel is a purple option box whose "Reshape"
subheader is a standard collapsible subsection (chevron; open by
default since the tray click should reveal the options). A
**Direction** toggle at its top picks the form: **Wide → long** (the
default, described first) or **Long → wide** (the inverse, further
down). What it holds is a **draft**: nothing changes
until **"Apply reshape"**, which melts the version shown and saves
the long table as a **new data version** (§2.4) — the same way a hand
edit (§2.1) or a derived variable (§2.1c) lands — then closes the
menu. **Cancel** (or the tray button again) closes it and drops the
draft; reopening starts a fresh draft from the stored state. The
lists hold the columns of the version shown:

- **ID columns** — checkboxes over every column; checked columns are
  kept as-is on every output row. Checking a column here withdraws it
  from Combine.
- **Combine** — checkboxes over the remaining (non-ID) columns; each
  checked column melts into one output row per input row. Columns
  checked in no list are left out of the reshaped table.
- **Combined variable name** (default `category`) — the new
  categorical column holding the melted columns' names — and **Value
  variable name** (default `value`) holding their cell values, both
  inside the Combine box. The boxes come prefilled with the defaults,
  and a blanked box falls back to its default (shown as the
  placeholder) rather than blocking the reshape. The value column's
  type is re-inferred from the melted cells; melt order follows
  column order, and empty cells melt to empty strings rather than
  being skipped.

**More than one pair — paired groups.** A right-aligned **"+ Add
another group"** link under the Combine box adds a second Combine
box ("Combine (group 2)") with its own checklist and its own pair of
name boxes (defaults `category 2` / `value 2`; the suffix counts up).
A column lives in one list only: checking it in any group withdraws
it from the other groups' lists, as an ID check withdraws it from
Combine. The groups melt **by position**: the first column of every
group lands on the same output row, the second on the next, and so
on — `sales_2023, cost_2023, sales_2024, cost_2024` with sales in
one group and cost in the other gives one row per year carrying both
values. A group shorter than the longest gets **blank cells** on the
rows past its last column, and the panel says so ("The groups differ
in size…"). The minted names of every group must differ from each
other and from the kept ID columns (`"year" is used by two groups.`).
A group with nothing checked mints nothing and is ignored; × on its
header removes it. Two unrelated groups of different sizes (people
and pets) are NOT what this is for — melt them all into one pair and
derive a "kind" column instead; pairing is for columns that belong
together. In the config the first group is the reshape's own
`meltFields` / `variableName` / `valueName` and the rest sit in
`extraGroups` (optional, additive, no storage bump).

A line under the boxes reads out what Apply would save (`2 rows × 3
columns → 4 rows × 3 columns.`); a half-configured draft (nothing to
combine, or a name colliding with a kept ID column or the other name
— surfaced as amber warnings) just leaves Apply disabled.

**Long → wide.** The Direction toggle's other setting swaps in the
inverse form — a pivot — for data that arrived long and wants a
column per category. Its lists hold the columns of the version
shown:

- **ID columns** — checkboxes over every column; rows that share the
  same ID cells become ONE output row (first-appearance order, ID
  cells from the first such row).
- **Split out** — checkboxes over the remaining columns; each
  distinct value of the checked column becomes a column of its own,
  in the order the values first appear. With two or more checked,
  their values together name the column ("2023 Q1"); a blank cell
  names its column "(blank)".
- **Fill with** — checkboxes over the remaining columns; the checked
  column's cells fill the new columns (blank where no row has that
  ID + split-out combination; each new column's type is re-inferred
  from its cells). With two or more checked, each new column is named
  by its value column too ("sales 2023", "cost 2023", "sales 2024",
  …) — the inverse of the paired groups above. Columns checked in no
  list are left out.

**More than one pair — groups.** A right-aligned **"+ Add another
group"** link adds a second Split out + Fill with pair ("Split out
(group 2)" / "Fill with (group 2)", × on its header removes it). The
groups share the ID columns: each group spreads its own split-out
values into its own columns, filled from its own value column(s), and
every group's new columns sit side by side on the same ID rows —
`day`/`sales` and `region`/`cost` give `monday, tuesday, north,
south`, which is what a paired-group melt (above) comes back out of.
A group with nothing checked in either list spreads nothing and is
ignored; a new column two groups both make is an amber warning
(`"monday" is made by two groups.`). Repeated rows are counted per
group ("… ID and split-out (group 2) cells"). In the config the first
group is the pivot's own `keyFields` / `valueFields` and the rest sit
in `extraGroups` (optional, additive). Two or more split-out columns
in ONE group are different: their values join into one column name
per combination (the cross product), where two groups give two
independent sets of columns.

A column lives in one list only, as in the wide → long form. Under
the lists the panel reads out the new columns ("New columns: 2023,
2024, 2025." — the first six, then "… and N more") and how many rows
repeat an earlier row's ID and split-out cells (the later row wins),
then the same counts line. A new column that takes a kept ID column's
name is an amber warning that disables Apply (`"2023" is already the
name of an ID column.`), as is a column that two different split-out
combinations both make. Apply saves the wide table exactly as the melt does
(below), with the pivot recorded in `DatasetVersion.transform.pivot`
instead (`lib/pivot.ts`, `pivotDataset`; the version list tags it
"reshaped (long → wide)", a replay names it "reshape (long → wide)"
and re-does it when the split-out and value columns are present).
The direction is a draft choice, not stored: each form keeps its own
draft, and the live melt an older visual carries seeds only the
wide → long form — applying a pivot from such a visual clears that
live melt, whose columns the pivoted version no longer has.

Where the version lands follows the one rule every change to the
data obeys (`store/commitDatasetVersion.ts`): the first change to an
imported data set **forks a working copy** — the panel says so, with
a name box prefilled `<name> (reshaped)` (a colliding name warns as
everywhere else) — whose v1 is the wide table and v2 the long one,
filename "Reshaped data", marked `editedFrom` v1 with the reshape
recorded in `DatasetVersion.transform.reshape`; the editor rebinds
and every draft atom is left alone. A change to a data set that is
already a working copy **appends** the long version to it (no name
box; the panel says "adds a new version"). Either way the stored
wide rows are never rewritten: the versions before the reshape keep
the wide columns as their own list (`DatasetVersion.fields`, §2.4),
so they still preview as the wide table, and the version list is how
a reshape is undone — pick the wide version, or delete the reshaped
one. The melt itself is `lib/reshape.ts` (`meltDataset`), run
through `lib/materializeTransforms.ts` (`bakeTransforms`), which
keeps every original cell exactly as imported ("$1,234" stays
"$1,234") and writes only the new columns. A reshaped version is
plain rows, but the reshape is recorded: a fresh wide file uploaded as
a new version of the working copy is checked against the wide import
and reshaped again onto a version of its own (§2.1, "A fresh file
into a working copy").

**Older visuals.** Visuals saved before reshapes became data versions
carry the reshape as per-visual config (`Visual.reshapeConfig`),
applied where the dataset view is resolved (`currentDatasetViewAtom`)
so the tray, field list, shelves, renderers and embeds all see the
long shape. That path is kept as it was — such a visual keeps
rendering, and the tray button reads "Reshape ✓" in the accent color
while its live reshape applies — and the live config seeds the
panel's draft, so Apply saves it as a version and clears it. A live
reshape composes with live derived variables (§2.1c) in the natural
order, derive → reshape → derive: a variable the reshape USES
(checked as an ID or Combine column) is computed on the wide table
before the melt and then behaves like any other wide column, every
other one after the melt; the panel lists the variables that can run
wide, ƒ-marked after the data columns (each ƒ reopens that variable's
edit popup — `derivedReshapeStages.ts` decides who runs where, and a
checked variable's earlier dependencies run wide with it). Apply
folds them all into the version — the reshape under
`transform.reshape`, the variables under `transform.added` — and
clears what applied from the config; a variable that couldn't apply
(a broken reference) stays live, with its editor's warning.

### 2.1c Derived variables
Users can mint new columns computed from existing ones — no new
data, just a more chart-friendly form of what's already there. A
skinny **"+"** column at the far right of the data-table header
opens the create popup; because it renders after the data columns,
it always stays rightmost, including after the derived columns it
creates. The popup asks for a **Name** first (its placeholder — the
first free "Variable N", or the current name when editing — is what
a blanked box saves as), then one of three **functions**:

- **Math** — a freeform formula over `{Variable}` tokens, numeric
  constants, `+ − × ÷`, and parentheses with standard precedence,
  e.g. `{A} + {B} / {C}` or `({A} - {B}) * 100`. Every referenced
  variable must be numeric: a formula reaching a column that holds
  text is an **error** — the amber issue names the offending column,
  row, and value, and Save stays disabled — so a math variable can
  never be minted over non-numeric data. Blank cells are missing,
  not text: they come out blank, as does a division by zero.
  Numeric results are serialized with float noise trimmed
  (`0.1 + 0.2` reads `0.3`).
- **Combine text** — a template in the data-label grammar
  (`Some text: {Region}` / `{A} / {B}`): tokens naming a present
  column substitute that row's cell, unknown tokens stay literal so
  typos are visible.
- **If / else** — condition rules checked top to bottom, first
  match wins, with an "Otherwise" fallback. Each rule row is
  **structured**: a left value box, a comparator dropdown (`=` `≠`
  `>` `<` `≥` `≤`), a right value box, an arrow, and the output box.
  Either value box takes a variable, a number, plain text, or a
  formula (`{A} / {C}`) — plain text that isn't an expression
  (`West`, `North East`) is quoted automatically, so users never
  type quotes. When the left box is exactly one `{Variable}` token
  naming a categorical or ordinal column (effective type, overrides
  included), the comparator dropdown offers only `=` and `≠`
  (ordering a category makes no sense; a stale ordering comparator
  reads as `=`); a number / date variable, or any calculation
  (`{A} + {B}`), keeps all six and an open right box. With at most
  200 distinct levels, that same lone-category case makes the right
  box a **dropdown of the column's levels** (discovery order, blank
  "Choose a value…" first; a column with empty cells also lists
  "(blank)", stored as the empty text literal `""`) instead of a
  text box, so a level can't
  be misspelled. The dropdown shows only while the right value is
  empty or one of the levels; clicking a variable button while the
  dropdown is focused swaps a text box back in holding that token
  (variable-vs-variable comparisons), and a stored right value
  that's no longer a level keeps the text box. Comparison semantics: `==`/`!=` compare numerically
  when both sides read as numbers and as strings otherwise; ordering
  is numeric-only; blank cells never match — except the blank test,
  the empty text literal `""`: `{A} == ""` is true for a blank cell
  (or a formula that came out blank) and `{A} != ""` for a filled
  one, while `{A} != "West"` stays false for a blank A, since blank
  is no value at all rather than "a value that isn't West". Outputs — the per-rule
  value and the "Otherwise" fallback alike — are templates in the
  Combine-text grammar: tokens naming a present column substitute
  that row's cell (so "otherwise keep `{B}`" passes B through),
  unknown tokens stay literal, and plain text is just text. A
  half-filled row (one side blank, or an output with no comparison)
  is a row-level error that blocks Save. Storage is still the
  condition STRING (`DerivedRule.condition`, e.g.
  `({A} / {C}) >= 0.5` or `{Region} == "West"`), composed from the
  three boxes by `lib/derivedRuleForm.ts` and split back when
  editing; the expression grammar (with `AND` / `OR`) is unchanged
  underneath, so evaluation and `{Old}` → `{New}` renames are
  untouched. A stored condition that isn't a single comparison (an
  older rule combining comparisons with AND / OR) shows as the
  previous single free-text box, with a note, so nothing is lost.
  Unparseable rules never fire.

A row of **variable buttons** — one chip per column the variable may
reference, the same row for all three functions, between the
Function picker and the body — inserts a `{Variable}` token at the
cursor of the box that last had focus (the function's first box
before anything is focused), so users never type braces. A live
preview shows the first rows' referenced cells beside the computed
result. Save is disabled while the draft can't apply (name
collision, parse error, unknown variable, non-numeric column in a
Math formula — shown as amber text). The numeric check reads the
whole column, not the previewed rows. The popup is one fixed width
and height regardless of function.

Saving computes the column and stores it as a **new data version**
(§2.4) — the one rule every change to the data obeys
(`store/commitDatasetVersion.ts`, driven here by
`store/useMaterializeVersion.ts`): the first change to imported data
forks a working copy — the popup says so and takes the copy's name,
prefilled `<name> (edited)` (a colliding name warns) — and a change
to a working copy appends a version (the popup says "adds a new
version"). The version's filename is "Derived data" and
`DatasetVersion.transform` records the definition (`added`,
`recomputed` or `removed`), so the version list can say what
happened (§2.4) and the column keeps its ƒ: `lib/versionTransforms.ts`
(`derivedVariablesOfVersion`) walks the version's ancestry
nearest-first for the variable that made each column, a recompute
shadowing an earlier definition and a removal ending the search;
`resolveDatasetView` marks those fields `derived` at view time
(`materializedDerivedAtom` is the editor's lookup), and the tray's
italic **ƒ** / the Fields panel's **ƒ** pill reopen that definition.
The computation runs through `lib/materializeTransforms.ts`
(`bakeTransforms`): Math sees the percent / dollar cell conversions
(§2.2) on a copy, and only the new column is written onto the stored
rows, every original cell kept as imported. The computed column is an
ordinary dataset column everywhere downstream — type overrides,
encoding dropdowns, tooltips, data labels, and the Fields panel's
inline rename (a rename reaches the stored definition and every older
version's own column list too, `renameFieldInVersions`, so the ƒ
survives it). Save is also refused when the definition computes
nothing (a reference the data doesn't have).

Editing a stored column (its ƒ) prefills the popup from the version
that made it, evaluates against the table minus that column (a
variable never reads its own), and saves a new version with the
column **recomputed in place** (`transform.recomputed`, same
position); a changed name is a variable rename the encodings and
sibling visuals follow, the old name kept in `sourceNames`. Columns
are frozen values — the trade for every version being plain,
inspectable rows: recomputing one does NOT recompute a later variable
that read it (it is just a column now). A new version uploaded to the
working copy gets the columns made again from their recorded
definitions (§2.1, "A fresh file into a working copy"). Deleting the variable (in the edit popup, confirmed) drops the
column in a new version (`transform.removed`); anything mapped to it
falls back to the normal missing-field behavior.

**Older visuals.** Visuals saved before derived variables became
data versions carry them as per-visual config
(`Visual.derivedVariablesConfig`, `lib/derivedVariables.ts`), applied
as the LAST stage of the view chain — after the live reshape and the
cell conversions, so Math sees plain numeric strings and expressions
may reference reshape-minted columns — except for a variable the
live reshape uses, which runs on the wide table before the melt
(§2.1b). That path is kept as it was: such a visual keeps rendering,
its variables evaluate in list order (a later one may reference an
earlier one), the Fields panel renames them live, and a variable that
CAN'T apply — a name collision with a real column, a referenced
column that disappeared — is skipped with a warning in its editor,
never an error. Saving ANY variable from such a visual — new or
edited — bakes the whole live set, live reshape included, into the
version it saves and clears what applied from the config (a variable
that couldn't apply stays live, with its warning); deleting a live
variable only edits the config, since the stored data never had its
column.

### 2.2 Field types
Every field is tagged with one of: `quantitative` (numbers),
`categorical` (distinct labels), `temporal` (dates), `ordinal` (ranked
categories). Types are inferred from the first ~50 non-empty values.
Users override per-field in the Fields panel with a dropdown — useful
when a numeric column like a zip code should be treated as categorical.

**Formatted numeric cells** infer quantitative like plain numbers:
dollar / comma-grouped cells ("$1,234.56", "($900)", "1,234") and
percent cells ("14%", "-2.5 %"). The conversion is a VIEW-time
transform (`lib/dollarCells.ts`, `lib/percentCells.ts`), never a data
rewrite: in every effectively-quantitative column (inferred, or
overridden to quantitative) the cells become plain numeric strings —
"1234.56", and percents become fractions, "0.14" — so scales,
aggregators, and Math formulas all read numbers. The data tray keeps
showing the imported text. A converted column carries a format hint
("dollar" / "percent") that the render path folds in wherever a Format
box is still Auto — axis ticks, gradient / size legends, data labels
render as "$1,234.56" / "14%" — without writing any config, so the
sidebar keeps showing Auto and a user-picked spec always wins.
Overriding such a field back to categorical (or ordinal) restores the
original "$1,234.56" / "14%" labels everywhere.

For categorical/ordinal fields, users can also pin a custom level
order (up/down arrows, drag, reverse) instead of the smart-sort default,
or compute one with "Order by" — Alphabetical or another variable's
aggregate, optionally scoped to one level of a third variable ("in the
2023 level of year"), ascending or Decreasing.

"Order by" stays ONE-SHOT: it computes an order and pins it like any
manual reorder, and nothing re-derives it when the data changes. The
picker's settings are nonetheless remembered per field (saved with the
visual), so closing the field's chevron and reopening it shows what the
levels were ordered by and lets the user change one knob instead of
starting over. A hand reorder — arrows, drag, reverse, reset — drops the
memory back to "—", since the pinned order is no longer the computed
one, and a remembered choice that no longer resolves (the variable was
deleted or retyped, the scope level is gone from newer data) shows as
unset rather than as a dangling selection.

**Renaming a variable** — clicking a field's name in the Fields panel
(a pencil sits beside it) opens an inline editor; Enter/blur commits,
Escape cancels. Committing an EMPTIED box is clear-to-default: a renamed
variable reverts to its original uploaded column name (a full
rename-back, configs included — `originalFieldName` reads
`sourceNames[0]`, which stays the upload name forever because renames
only ever append to the list); a never-renamed variable just closes the
editor. A rename is a property of the DATASET: the field takes
the new name and remembers the old one in `Field.sourceNames`, and
every config surface that stores the field's name — encodings, color /
opacity slots, per-field maps, label / tooltip templates, reshape
membership — is rewritten in one shot (`lib/renameField.ts`), in the
open editor AND in every saved visual bound to the dataset. Stored rows
are NEVER rewritten: per-version rows keep their original column keys,
and `resolveDatasetView` remaps a former-name key to the current name
at view time. Later uploads match columns on the current name OR any
former name (see §2.4). A name colliding with another field's current
or former name is refused inline. With a reshape applied, the two
minted columns aren't renameable here (their names are edited in the
Reshape panel); renaming a melted wide column instead rewrites its
occurrences as CELL VALUES of the variable column (hue colors,
per-value overrides, facet settings, pinned orders).

**Reordering variables** — a field row in the Fields panel drags by its
⠿ handle, and a column header in the data tray drags as a whole; the
drop gap is marked while the drag is on. Column order is a property of
the VISUAL (`Visual.fieldOrder`, `currentFieldOrderAtom`,
`store/useReorderField.ts` → `lib/reorderFields.ts`): a list of names
applied as the LAST stage of the view chain, after the reshape and the
derived variables, so EVERY column the table shows drags — a reshape's
minted columns and live derived columns included, reshape applied or
not. A drop writes the whole order as shown; a column the list doesn't
name (one added later) keeps its place after the ones it does, and a
name no longer in the table is ignored. Renaming a column renames it in
the list. Other visuals on the same data set keep their own order, the
data set itself is not rewritten, and the Edit dialog's grid follows
the data set's stored order, not a visual's. The order is saved with
the visual and covered by undo.

### 2.3 Visuals (save/load)
A "visual" is a named snapshot of: chart name, the dataset (and the
specific version it was authored against), field-type overrides, all
encoding-channel assignments, every channel config, label settings,
legend settings, data labels, annotations, and a thumbnail. Visuals
persist to localStorage with versioned migrations so older saves
remain backward-compatible. (Dataset ROWS are the exception — they
live in IndexedDB, not localStorage; see §14.)

**Undo / redo.** Every edit autosaves into the visual 800 ms after it
lands, so there is no "unsaved" state to discard; instead the editor
keeps an in-memory history of whole-draft snapshots. `⌘Z` / `Ctrl+Z`
steps back, `⇧⌘Z` / `Ctrl+Shift+Z` / `Ctrl+Y` forward, and the top
bar's Undo / Redo buttons (left of Export) do the same and show
whether there is anything to step to. The history covers everything
the visual saves — name, encodings, type overrides, every channel
config, labels, legend, tooltip, data labels, level orders, annotations,
caption, data table, map, reshape, derived variables, the chosen theme — but NOT
the dataset binding (changing the data set resets the stack), field
renames or dataset edits (those mutate the data set and sibling
visuals, not this draft), or the preview version. Changes landing
within 500 ms of each other merge into one step, so a slider drag or a
typed title undoes as a unit; the stack holds 100 steps, restarts when
a visual is opened or New is pressed, and does not survive a reload.
While a text field has focus `⌘Z` is left to the browser (it undoes the
typing in that field); click the chart, or use the buttons, to undo the
visual. An undo is an ordinary change to autosave, so the saved visual
always matches the screen. (`store/editorHistory.ts`; the draft
snapshot is the same 19 atoms `useSaveVisual` reads.)

**Save status.** Beside the name, the top bar says when the open visual
was last saved: "Saving…" mid-save, otherwise "Saved by Nancy at
9:25 AM" (a time for a save today, "on Oct 14" for an earlier one). It
reads the stored visual, so it is right the moment a visual opens, not
only after this session saves. The saver's first name appears only when
the server identifies its users (below); otherwise, and for visuals
saved before that, it reads "Saved · 9:25 AM". Hovering shows the full
name and date. An unsaved draft shows nothing.

**Who's here, and who saved.** When the app runs under a host with its
own sign-in, the host hands the server an `identify` hook
(`server/src/identity.ts`) and three things switch on; on the standalone
server and in browser-local mode none of them exist.
- `/api/config` names the signed-in user (`{ id, name }`), and the boot
  probe installs it (`lib/currentUser.ts`).
- **Presence.** The header shows an initials circle ("JD", "NO") left of
  New visualization for everyone with the same visual open in an editor,
  you included and last; hover for the name, and past four the rest fold
  into "+N". Each editor tab heartbeats `PUT /api/presence/:tabId` every
  15 s and gets back who is there; the server keeps this in memory and
  forgets a tab after 45 s of silence or when it closes. A never-saved
  draft is private: it shows only you and sends nothing. Hidden on
  phones, where the header has no room. Presence is a heads-up only —
  two people editing one visual are still last-write-wins.
- **`updatedBy`.** A save stamps the visual with its saver, and the
  server overwrites the client's claim with the requesting user. Only a
  write that CHANGES `updatedBy` is a save: a folder move or trash sends
  the stored saver back unchanged and keeps it, so moving Jane's chart
  doesn't credit you with her save. A duplicate is credited to whoever
  made it. Someone else's save while you have the visual open shows up on
  your next load, not live.

### 2.4 Dataset versions & cleanup
The editor header carries a **version badge** — the dataset name plus
`v2 of 3 · latest` — styled amber while a non-latest version is being
previewed. Clicking it opens a popover whose header names the dataset
and the version in use right now (`v2 · <upload time> · <note>`), then
lists every version newest-first with its upload timestamp and filename:

- **Switching versions** — picking a row sets `previewVersionIdAtom`
  (null = follow whatever is latest), so the editor re-renders against
  that version's rows. A "← Back to latest" link appears while an
  older version is being previewed.
- **Notes** — each version takes a free-text note, added / edited
  inline in the popover; an emptied note is dropped.
- **Deleting a version** — any version except the one currently active
  can be deleted, as long as more than one remains. The confirm
  prompt warns that iframes pinned to that version will show a
  "version not found" error; deleting the latest promotes the
  previous one to latest. There is no version rename (variables CAN be
  renamed — in the Fields panel, see §2.2). When other versions were
  made from the one being deleted (their `editedFrom`), the prompt
  adds that they lose their source and the data can't be recovered —
  the import under a working copy is deletable, not silently.
  Deleting the base of a
  hand-edit chain (§2.1, "Edit data") leaves the edited versions'
  `editedFrom` dangling: the table then outlines against the nearest
  surviving ancestor, or nothing when none is left.
- **Versions made from another** list with what made them after
  their filename (`describeVersionOrigin`, `lib/versionTransforms.ts`):
  a hand edit (§2.1) "Edited data · edited by hand", a reshape
  (§2.1b) "Reshaped data · reshaped (wide → long)" / "· reshaped
  (long → wide)", a derived
  variable (§2.1c) "Derived data · added “Trend”" / "· recomputed
  “Trend”" / "· removed “Trend”" — a reshape that folded an older
  visual's live variables in says both, and a version a replay made
  (§2.1) adds what it couldn't re-apply: "· couldn't re-apply
  “Margin”".

**Per-version columns.** `Dataset.fields` describes the LATEST
version, and every version without a list of its own shares it — the
invariant new uploads are checked against. A change that alters the
table's shape (a reshape, a derived variable added or removed, a hand
edit that drops or adds a column) gives every version before it the
list as it stood, in `DatasetVersion.fields` (`lib/versionFields.ts`,
`withNextFields`), so an older version still previews as its own
table; `resolveDatasetView` reads a version's own list first, and
the hand-edit outlines compare under it. A rename reaches those lists
(and the stored transforms) too, so an older version keeps answering
to the current name; deleting the latest version promotes its
predecessor's list to the data set's (`normalizeVersionFields`), and
a version carrying its own list is never counted when orphan fields
are pruned (below).

New-version uploads check column compatibility via **`diffFields`**
(`datasetCompat.ts`): every existing column must be present with the
same inferred type; net-new columns are additive. A renamed variable
matches on its current name OR any former name (`Field.sourceNames`),
current name first; when an upload carries both, the type-compatible
column wins the match and the other lands as an ordinary added column.
Rows are stored as uploaded — old-name keys included — and resolve to
the current name at view time.

Deleting a version calls **`pruneOrphanFields`** (`datasetCompat.ts`):
because additive uploads merge net-new columns into the dataset's
shared field list, removing the version that introduced a column
would otherwise leave that field orphaned in the Fields panel and the
encoding dropdowns. Column presence is judged by the union of row keys
across every remaining version that SHARES the list (one carrying its
own `fields` says nothing about it; a single row isn't authoritative —
the CSV parser omits trailing keys on short rows), a renamed field is
represented by its former names too (its rows still carry the old
keys), and pruning is skipped entirely when any counted version has
zero rows rather than risk dropping a live field.

Datasets have no library UI of their own, so unreferenced ones are
swept rather than managed: `sweepOrphanDatasets` (`lib/datasetSweep.ts`)
runs whenever visuals are purged from the Trash (moving a visual TO the
Trash sweeps nothing — it still owns its data set), dropping every
dataset no remaining visual references and no protected id names (the editor's current
dataset is protected — an upload not yet saved as a visual is live
work). Seed datasets from the ephemeral example overlay (§14) are safe
from it: the sweep judges them against the seed visuals that reference
them, and a swept store is written back through the same strip every
save uses. Alongside it, `runDatasetStoreCleanup` is a
**marker-guarded one-shot** run from `main.tsx` — after a persisted
seed, before the ephemeral overlay, which it must never see: it
collapses
byte-identical duplicate datasets (repointing visuals, embeds, and the
pinned dataset / version ids), deletes the orphan backlog that
accumulated before cascade-on-delete existed, and prunes historical
orphan fields. It runs once per browser per `CLEANUP_VERSION` (bump
the constant to re-run) and must never throw — a failure logs, skips
the marker so it retries next launch, and first paint proceeds.

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
exclusive because a single mark can't be all three; `r` conflicts
with `x` / `y` (polar vs cartesian position) and with `length` (a
radar places marks by r and draws no segment length, so Length is
de-emphasized while R is mapped and mapping it pops the override
dialog). (The `text`
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
| `x + y + length` | Line-segment scatterplot (default) — or, with Length → **Draw as: Bars**, a bar + marks **combo** (see below) |
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
| `x + y + length`, Length "Draw as" = Bars | Combo (combo-x / combo-y): bars of `length` plus the other position variable as marks on the same measure axis — a line when `connection` is mapped |
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

**Bar + marks combo.** `x + y + length` has two readings, and the
Length panel's **Draw as** toggle (`LengthConfig.render`) picks one.
The default, *Segments*, is the line-segment scatter above. *Bars*
makes Length draw bars exactly as `x + length` would, and the OTHER
position variable draws as scatter marks on the bars' measure axis —
joined into a polyline per Connection value when `connection` is
mapped (the classic bar + line chart, on ONE axis; there is no dual
axis). The measure axis auto-fits to cover both the bars and the marks
(faceted shared axes and the layout solver fold the marks in the same
way). Which way the bars run follows the position variables' types:
vertical bars (`combo-x`, x = category, y as marks) unless y reads as a
category and x is the lone quantitative position, which gives the
horizontal twin (`combo-y`). Both quantitative falls to vertical. The
combo modes are members of the bar family (bar gap, stack / group
modes, bar data-label placements, the Length legend hidden) and declare
scatter's line / glyph / mark roles for the marks layer, so the
Connection panel's line styling, the Line color / opacity slots, the
Default shape and the Area panel's default point size all apply to it.
The marks' points take their LINE's color, not the bars' Color
mapping: the Color panel's **Point fill** slot (`comboPointFill`,
§4.1) leads with *Auto* = the Line color (its mapping, else its single
color), and can vary by a variable or take a single color of its own.
Shape and Area cannot be MAPPED alongside Length (the shelf conflict
stands). Data labels annotate EITHER layer per label: under Position
and alignment every label gets a **Show on** choice — *Bars* or
*Line* (*Points* without a Connection) — defaulting by the variables
the label shows (the position variable drawn as marks, the Connection
field, the Line / Point fill slot fields → the line; anything else →
the bars) and stored in `DataLabelsConfig.fieldLayers` (§9). The
option appears only for that signature — plain bars and lone segments
never show it.
When no MapConfig is active the geo modes never fire.

Geography levels: US States, US Counties, US ZIP/ZCTA, and World
Countries are all implemented. The level's `"auto"` setting detects
the best-matching level by scoring the connection field's values
against each level's lookup table (ties and no-match fall back to
states; the dot map, which has no connection field, always
auto-resolves to states). The Geography level dropdown shows what Auto
resolved to ("Auto (US Counties)"); an explicit pick always wins.
County joins accept 5-digit FIPS codes (unpadded tolerated) and
state-qualified names ("Washington County, TX"); bare county names
that repeat across states — or the six within-state city/county name
pairs, unless suffixed "city" — deliberately stay unmatched rather
than guessing.

Country joins accept ISO 3166-1 codes in all three forms (alpha-2,
alpha-3, numeric) and names — and names join through an alias table
(`lib/geo/countryNames.ts`) as well as the atlas's own feature names,
because world-atlas renders SHORT forms ("Dem. Rep. Congo", "Central
African Rep.", "S. Sudan") while real CSVs carry full names
("Democratic Republic of the Congo") and common variants ("USA",
"UK", "Republic of Korea", "Russian Federation", "Czech Republic",
"Ivory Coast", "Burma", "Swaziland", "East Timor", "The Gambia",
World Bank forms like "Congo, Dem. Rep."). Every alias maps to
exactly ONE country — the two Congos can never cross-join, and
genuinely ambiguous forms (bare "Korea") are deliberately absent, so
they stay unmatched rather than guessing (same policy as county
names). The alias table doubles as the display source for the data
labels' "Full country name" format (§6.5).

ZIP/ZCTA is special in one way: its boundary data (~33k polygons,
8.6MB even aggressively simplified — no us-atlas equivalent exists)
does NOT ship in the default build. The level is fully plumbed
against a topology seam (`lib/geo/zctaTopology.ts`), and a build opts
in by generating the asset: `pnpm zcta` writes
`public/geo/zcta-500k.json` from the public Census source, Vite copies
it into `dist/` as a SIDECAR file, and the app fetches it the first
time a visual uses the level — never at boot, and never inlined into
the single-file `index.html` (which is also why a `file://` build
can't use it: a local page can't fetch a sibling). Alternatively a
host registers a runtime source via `setZctaTopologyLoader`. Without a
source the Maps section explains that ZIP/ZCTA data isn't available;
with one, ZCTAs join by 5-digit code under the dedicated "ZIP code"
region key (never FIPS — the two 5-digit families must not cross-join),
with numeric columns that lost leading zeros left-padded to 5 and
ZIP+4 values matched by their 5-digit prefix. Auto level detection
considers zcta last (states > counties > countries > zcta), and only
loads the heavy table when a source exists, the cheaper levels scored
poorly, and the column even looks ZIP-like (mostly 3–5-digit
numerics).

Points outside the projection: Albers USA (the default for US
geography levels) is US-only — it projects anything outside the US (and
its Alaska/Hawaii insets) to null, so such marks simply don't draw.
When that drops at least one mark, the Maps section shows a hint under
the Projection control — "N of M points fall outside the mapped area
and aren't shown" (dot map rows with a usable lon/lat; "regions" on
the bubble map, whose joined-region centroids can only drop under an
explicitly chosen Albers USA) — and, when Albers USA is the resolved
projection, names the fix (choose Natural Earth or Mercator). The hint
hides when nothing dropped, and under a focus region (focus forces a
world projection; marks panned out of a focus box are deliberate
framing, not lost data). Rows whose lon/lat can't parse never count —
they can't draw under any projection. Counting lives in
`useGeoOutsideCount` / `lib/geo/outsideProjection.ts`, which mirror
the renderers' skip logic exactly.

Missing data on the choropleth: a region with no usable measure value
paints with the **no-data fill** color (Maps section), whether the
region is entirely absent from the dataset (no row joins) or its row's
measure cell is blank/NA — both read as "no data" and look identical.
"Fill regions with no data" is ON by default; turning it off omits
every region that would paint as no-data — regions absent from the
dataset AND matched rows whose measure is blank/NA alike (a row whose
own pattern-channel category paints it still draws: that's an
encoding, not missing data; with no measure mapped there is no
"missing data", so every joined region draws). One predicate,
`matchedRowIsNoData` in `lib/geo/geoMarkStyle.ts`, decides "paints as
no-data" for the fill, the skip, and the auto frame below, so they
can't disagree. The toggle is honored under any focus too, so a
focused viewport with the toggle off shows just the data regions.

**Framing follows what's drawn.** "Whole map (auto)", the Focus
default, fits the projection to the level's whole geometry while every
region draws, and to just the regions drawn once the toggle is off —
joined AND carrying a usable value, so a Washington-only county
dataset, or a whole-US template with values only for Washington,
fills the panel with Washington instead of sitting in the corner of an
otherwise empty US. There is no
"one region" special case: two states frame two states, fifty frame
the US. The matched set is resolved over the whole dataset, so every
panel of a facet grid shares one frame; when nothing joins, auto falls
back to the whole geometry. Switching to Custom (and "Reset view")
seeds from that same data frame, padded a little, so Custom starts
from the view on screen (`useAutoFitViewport`); a short note under the
Focus control says the map is framing just the data regions and how to
get the whole map back. Only the choropleth's toggle affects framing —
the bubble and dot maps always frame the whole geometry.

The **world-countries backdrop** (neighboring countries drawn in the
no-data fill behind a non-world geography level) appears only when the
user's CHOSEN projection is a world projection (Natural Earth or
Mercator). Focusing — a named region or Custom (drag to center) —
internally forces a world projection so Albers USA can pan, but that
never adds the backdrop: an Albers-USA states map custom-zoomed stays
US-only (no Canada appearing). The backdrop is no-data paint, so each
map gates it on its own no-data toggle: the choropleth hides it when
"Fill regions with no data" is off (a Washington county map under
Mercator shows no purple Canada), the bubble and dot maps when "Show
basemap" is off.

An optional **no-data pattern** (chip picker under the no-data fill,
sharing the pattern channel's palette, plus an ink color that appears
once a pattern is picked) overlays those same no-data regions —
unmatched regions and blank/NA-measure rows — with the pattern drawn
over the no-data fill. It does NOT apply when no measure is mapped at
all (every region is "no measure" there, not "missing data"), and a
region whose row carries a pattern-channel category keeps that
encoding's pattern instead. The bubble map's region basemap paints the
same way; the world backdrop stays solid.

Geo marks support the **pattern** channel with the same semantics as
the cartesian renderers (per-category palette cycling, per-value
overrides / "None", hue-paired inks): choropleth region fills, dot-map
dots, and bubble-map bubbles (over their point-fill slot color) all
swap their fill for the pattern paint when the mark's row carries a
pattern category (`lib/geo/geoMarkStyle.ts` — `resolveGeoPatternDef`).

Geo measure fills also run through **saturation / brightness**
modulation, on the same anchored levels and the same
mapped-but-unresolvable → channel default fallback as everywhere else
(`resolveGeoFill` composes `resolveRowModulation`, the per-row helper
`resolveMarkAesthetics` uses). So a choropleth with hue on one
variable and brightness on another shades WITHIN each hue category,
matching what its legend shows. The modulation applies to whatever the
measure resolved to — a hue color, the opacity-only base fill, or (with
no measure mapped) the no-data fill for matched rows. Un-joined regions
never modulate: they stay on the flat no-data paint. Pattern-ink lookup
still keys on the PRE-modulation color, and a pattern whose background
isn't hue-driven modulates like the fill does.

Data labels on maps anchor to REGIONS via the Data Labels section's
**Geography** row (which replaces its X/Y position rows in geo modes) —
see §6.5.

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
(known gap — the legend section is drawn from the mapping, not from
what the flow renderer actually consumed). Flows have no
nesting, so the hierarchy-derived variables (Top-level group / Nesting
depth) are NOT offered in flow modes. The flat signature (`area` with
no connection) under a flow layout has no edges to draw — the canvas
stays empty and the Structure section's hint says to map a source
column.

**Flow node labels** (the labels beside chord arcs / sankey rects) are
styled from the **Data Labels** section (§6.5) — nothing about them
lives under Labels. Old visuals that styled them through the retired
Labels → "Node titles" section keep their look: that styling folds into
the visual's Data Labels config on intake (see §6.5).

**Chord ring axis** — Connection panel → **Show axis** (chord layout
only; checkbox, off by default): graduated value tick marks around the
ring showing each node's flow total (d3's classic chord group ticks —
every group shares ONE step so the ring reads as a single scale).
Enabling it reveals **Ticks / Tick labels / Spine** subheaders
mirroring the x / y position panels: *Ticks* = **Count** (target tick
marks around the FULL ring, default 100 — the axis is continuous, so
it takes a count like the continuous x / y axes, never the categorical
"Tick every" stride; the step snaps to a nice round flow value and
each node gets ticks proportional to its total) + tick-mark color /
thickness / length; *Tick labels* = the shared **Label format** control
(same preset dropdown + custom d3-format spec as the x / y Tick labels
section; Auto = SI-prefixed calibrated to the step, fixed decimals for
fractional steps) + **Label every** Nth tick (default 5th; each
group's graduation starts at 0 from its start angle) + the shared
tick-label font editor (unset fields inherit the base text font);
*Spine* = the thin arc drawn along each group's outer edge
(theme POLAR spine color / thickness — the circular analogue of an
axis line). Tick labels read radially outward and flip 180° past 6 o'clock
so they never render upside-down; the Tick labels **Make all tick labels
vertical** toggle (off by default) instead keeps every label upright in
screen space, centered just past its tick mark. The ring shrinks to
reserve the axis's radial extent (tick length + deepest label — the
widest label when radial, the label box's projection onto the tick
direction when vertical), and the node labels move outside the tick
labels. State lives in `connection.chordAxis`;
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
  A derived Fill color gets a **Color legend** exactly like a field
  would: a discrete section titled "Top-level group" / "Nesting depth"
  over the same tree-order domain the marks are scaled on (so swatch
  slots match the circles/arcs and the panel's override swatches),
  shown by default and toggled under Legends → "Legends shown" → Color.
  Hovering an entry highlights that group / level's marks.
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
color scale spans its own max count — a known divergence from the
single legend ramp. (The histogram measure used to share this
divergence; it now colors every panel over one global domain — see
§3.3's histogram note.)

Modes are resolved in precedence order (first match wins); scatter is
the always-true fallback. Tile requires **both** axes to be
categorical/ordinal and **no** glyph-implying channel (length, angle,
shape, area, opacity, connection) — mapping any of those drops it back
to scatter. The histogram rows are driven by a per-axis toggle in the
channel config, not by an encoding; the renderer bins the quantitative
axis and counts rows per bin. When Fill color / Fill opacity vary by
the bins' derived measure (Count / Density), the color scale is
GLOBAL: one `[0, max]` domain shared by every facet panel and the
legend ramp, where `max` is the largest per-panel bin (bin edges from
the pooled rows, density shares per panel) — so equal counts read as
equal colors across panels, the tallest bar anywhere hits the ramp's
high end, and a bar's color always matches where its value falls on
the legend. The measure AXIS still follows the facet share modes
independently; the color domain deliberately does not
(`histogramMeasureColorDomain` is the single seam).

All of the above can be faceted across a categorical or ordinal
variable. Hue can be replaced or combined with opacity, saturation,
brightness, or pattern.

### 3.4 Quickstart bar
The icon bar above the encoding shelves gives one-click scaffolds for
each chart family (bar, combo, scatter, hexbin, dumbbell, line, area,
pie, radar, violin, density curve, tile, map, packed circles, treemap,
sunburst, sankey, chord) — every registered chart mode has a button.
Each icon cycles through random *variations* (e.g., bars → vertical →
grouped → patterned stacked → horizontal). The scaffold assigns
eligible fields automatically and optionally drops in a hue encoding
for free if a spare categorical field is available. Each variation
declares which channels need which field types; a chart-type button is
greyed out if the dataset can't satisfy any variation. Quickstart is a
starting point only — not a recommendation system.

Some variations seed a channel with a field ANOTHER channel already
got instead of picking fresh (`hueFrom` / `connectionFrom`). The
**Dumbbell** icon's variations (horizontal, then vertical) map the
category axis, a quantitative value axis, hue, shape, and area, and
use `connectionFrom` pointed at the category axis: connection carries
the category-axis field so each category's endpoints (rows split by
the hue field) connect to each other — a freshly-picked connection
field would link points across categories and render a line chart
instead.

The **Combo** icon scaffolds the bar + marks combo (§3.3): a
categorical x, a quantitative Length (the bars) and a quantitative y
(the marks), with a categorical connection for the line in the "Bars
and line" and "Horizontal bars and line" variations and none in "Bars
and points". Its `lengthAsBars` knob writes the Length panel's Draw as
= Bars; every other variation that maps Length clears a leftover
opt-in, so a bar / area / segment scaffold after a combo renders as its
own family. Like bars, its showcase fill layers only pattern and a
color modulation (shape and area conflict with Length).

The **Density curve** icon scaffolds a single quantitative field on x
with nothing on the opposite axis (the density axis is implied), and
turns on the standalone KDE curve — the same
`distributionOverlay.showDensityCurve` config the manual Distribution
→ "Density" segment writes, so the sidebar reflects and controls the
scaffolded chart exactly as if the user had built it by hand. It also
stamps the axis's shared histogram config (histogram off — the two
displays are mutually exclusive — and `densityFill` per variation).
Its two variations are the stroked curve and the filled one ("Fill
under curve" on). No hue: the lone curve has nothing to color per
category, and the underlying points render only as the optional rug,
so opportunistic extras stay off.

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
  modes draw no point glyphs. Which modes those are is a declared mode
  trait (`canvas.shapeRole === "cell"`), like `canvas.lengthRole`
  below; the sidebar never gates on mode ids.
- Pie chart: length, connection, area panels hidden when those
  channels aren't mapped.

X-position, Y-position, and Facet panels are always available; users
can configure axis settings even before a field is mapped.

**Blank-means-auto number inputs** (panel width / height, facet rows /
columns, legend width, inside-legend X, gradient bar length, caption
width / height, title and label font sizes): a blank field
shows the resolved auto value greyed as its placeholder. The first
spinner click or arrow key steps from that displayed number — never
from the field's minimum or 0 — and focusing the field commits
nothing. Clearing the field returns it to auto.

### 4.1 Color panel (the hue channel)
The hue channel's panel is labeled **"Color"** in the UI. The fill
palette section branches on field type:

- **Categorical** — palette dropdown sourced live from the active
  theme's Categorical Palettes. Per-value color override grid (click
  swatch → pick color). Each row also carries a palette-icon button
  that opens a popover of the current palette's swatches (wrapping at
  6 per row, current color highlighted) — pick one to commit it and
  close. A down-chevron at the popover's bottom expands it with the
  theme's other palettes (categorical then ordinal, skipping any whose
  colors duplicate one already shown), each palette as its own
  whitespace-separated swatch group, so a color can be borrowed from a
  palette the chart isn't on; the chevron flips to collapse them and
  the popover reopens collapsed. Stack mode (stack / group / overlay) for bars
  and areas. **Area charts** also get a separate "Line color" section
  with its own palette dropdown (lets the user pair a light fill
  palette with dark strokes); per-value line color overrides supported
  there too.
- **Ordinal** — palette dropdown sourced live from the active theme's
  **Ordinal Palettes** (a separate palette set from Categorical).
  Same per-value override grid and stack-mode toggle. Same separate
  "Line color" section for area charts.
- **Other color encodings inherit Color's palette positions.** Any
  other categorical color encoding that varies by the SAME variable as
  Color — data labels (layer color and per-variable label colors), the
  color slots (connection line, rug, violin/box, density curve, stem,
  regression, map points), Outline, and the area/radar line palette —
  defaults each value to the entry at the same POSITION in its own
  palette as the value's Color pick holds in the Color palette. Color
  using the 2nd and 4th categorical colors gives the labels the 2nd and
  4th text colors; when the second encoding uses the same palette, it
  simply matches Color. A value with no Color pick, or a custom color
  that isn't in the Color palette, keeps its default position. The
  secondary encoding's swatch grid shows these inherited colors as its
  defaults (reset returns to them), and its own per-value edits still
  win. Nothing is stored: the inheritance is derived at render time
  (`linkColorConfigs`, `lib/linkedHueColors.ts`), so later Color edits
  flow through.
- **Quantitative** — gradient picker (viridis, plasma, etc.) plus
  custom 2-stop or 3-stop gradients with explicit low/mid/high colors
  and optional pinned domain values. Each stop's value box shows the
  computed auto value as its greyed placeholder (data min / mid / data
  max) rather than the word "auto"; typing a value pins that stop.
  Every stop row (preset steps, Low/Mid/High, and manual steps) also
  carries the palette-icon palette-popover button beside its swatch,
  offering the theme's default categorical palette (expandable to the
  theme's other palettes) so a gradient stop can borrow a theme color;
  picking one commits through the row's normal edit path (so editing a
  preset still transitions to a custom gradient).
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
fill/outline, the combo's Point fill (§3.3; *Auto* = the line color,
so points sit on their line in its color instead of the bars' Color
mapping) — each store an optional
field mapping (palette + per-level overrides) or, when no field is
mapped, a single color seeded from the theme. Slots only appear when
their chart mode and feature gate apply (e.g. Rug requires the
histogram or density display to be on). Resolution is
**slot-config-if-present, else the legacy per-feature config field**
(e.g. `connection.strokeColor`, `histogram.rugColor`), so saved
visuals keep their colors unchanged until the user touches the slot.

**Color rules** — Fill, Outline, and Line each end in a right-aligned
**"+ Add color rule"** link (no standing subsection: the swatches
above are the primary control, the rules the exception path). Each
rule is a condition box plus a color; the first matching rule's color
replaces whatever the palette, gradient, or single color would have
drawn for that mark. The grammar is the data-label text-color
grammar: `>`, `<`, `>=`, `<=` compare numbers; `==` and `!=` also
match text; a rule may open with a variable in braces (`{Profit} <
0`, see §6.5's `{Variable}` conditions) to test that variable in the
mark's rows instead. An implicit rule compares against the
subsection's own mapped variable — Fill's Color variable (a derived
source's value for Count / Density / Nesting depth), Outline's
variable, the Line slot's "Vary by" variable — so it never fires while
that variable is "— none —"; the `{Variable}` form fires either way,
which is how a single-color bar chart turns its losses red. The help
line under the rules says which it is. Storage: Fill rules live at
`channelConfigs.fillColorRules`, Outline rules on the Shape config
(`shape.outlineColorRules`), Line rules on the Line slot
(`colorSlots.line.colorRules`; the first touch writes a well-formed
slot, which then owns the stroke). Precedence: a fill rule applies
BEFORE saturation / brightness modulation (a rule-colored mark still
shades like its siblings) and under the Shape panel's per-category
fill overrides; an outline rule sits under the per-category stroke
overrides and over the Outline scale color; a line rule beats the
slot's scale color and single color. Every mark-drawing renderer
honors fill rules — bars, areas, pies, scatter / radar points,
heatmap cells, hierarchy nodes with a row, and the geo family — the
same set that honors outline rules; hexbins and flow diagrams have no
rule-aware fill, so Fill hides the link there. Categorical legend
swatches recolor by the implicit rules (a swatch has no rows for a
`{Variable}` rule); a slot legend applies that slot's own rules. Any
rule lights the subsection's and the menu's changed dot; an emptied
list does not. Renaming a variable rewrites its `{token}` in every
rule.
Every single-color swatch shown when "Vary by" is set to "— none —"
(the Fill panel's default fill, each color slot, and the Shape panel's
outline color) carries the same palette-icon palette-popover button
as the per-value override rows, offering the active categorical
palette's colors (the chart's picked palette when one is stored, else
the theme default) as one-click alternatives to the open-ended picker.
Swatches that color TEXT rather than marks — the shared font editor's
Color row (chart title, subtitle, axis titles, per-axis tick labels,
facet titles, chord ring tick labels), the caption's Text color, an
annotation's text color, and every data-label color (fallback color,
text-color rules, per-variable slots) — carry the same button but lead
the popover with the theme's designated TEXT palette (Settings →
Theme → Palettes → "Text palette"), which is typically darker shades
that stay legible at text sizes. Themes with no text palette fall back
to the default categorical palette, and the popover's chevron still
reaches every other theme palette either way.

The text palette is also the DEFAULT scheme when label color varies by
a CATEGORICAL variable, not just the popover's lead: mapping a
categorical field to the Data Labels Color channel — or picking one in
a per-variable color slot's "Vary by" — seeds that slot's palette from
it, since the mark palette's lighter slots rarely survive at text size.
It is a seeded default, so the Palette dropdown below re-picks freely
("Match chart colors" included), a palette already chosen is never
overwritten by a later re-mapping, and ordinal fields keep their
ordered ramp (the order carries meaning the text palette doesn't
encode).

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
  color controls, defaulting to the Pattern section of the theme.
  A **Scale** box under each Color picker zooms that category's tile
  (×0–×4 by 0.1; blank = ×1). Dots and stripes swell by the full
  factor while their spacing grows a little less (tile side ∝
  scale^0.85 — `PatternDef.spacingExponent`), so zoomed-in dots don't
  drift apart as fast as they grow; the crosshatch and checker magnify
  uniformly. Stored sparsely in `pattern.scales[category]` (`pattern.defaultScale`
  for the no-variable default pattern; `polygonScales` /
  `defaultPolygonScale` for the radar polygon fill) and baked into the
  `<pattern>` def's id, so the legend and the Pattern menu's chips
  render the same zoom as the marks. A stored 0 draws at ×0.1 — a
  zero-size SVG tile paints nothing, which would make the marks vanish.
  With no pattern variable mapped, the panel's **Default pattern**
  picker (`defaultPattern` + its ink) fills EVERY mark — scatter
  points, bars, area layers, and pie wedges alike (the pattern tile's
  background is each mark's drawn fill when hue is mapped, else the
  Pattern background color). Geo and structure modes keep their own
  pattern semantics and ignore it.
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
- **Filled radar** (radar mode with the Connection panel's "Fill
  polygon" on): a **Polygon fill** subsection joins Line dash and Point
  fill, with its OWN pattern pick — the series polygon body and its
  points are separate targets, so a hatched polygon can sit under
  plain dots. Same shape as Point fill: no variable → a default
  pattern swatch row + ink (`pattern.defaultPolygonPattern` /
  `defaultPolygonPatternInk`); variable mapped → per-category swatches
  + ink (`pattern.polygonOverrides` / `polygonInkColors`), defaulting
  to "None" until picked. The pattern tile's background is the
  polygon's hue fill (or the shared Background when hue is unmapped).
  Stays available with "No points" (the polygons remain); hidden while
  the polygon is unfilled (nothing to pattern). Radar points read the
  ordinary Point-fill state, defaulting to none like any line chart.
  The LEGEND mirrors the polygon: on a filled radar, hue / pattern
  swatches tile with the polygon pattern (default or per-category
  pick) over the hue color and drop the line-dash overlay, since
  radar polygons don't dash.
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
custom value), the range draws nothing on its own. While the range is on, the dash row
also grows a **Blank** option (`defaultDashPattern: "blank"`): inside
the window the line doesn't draw at all — a true gap in the line —
unless "Fill dash gaps" is on, in which case the window is painted by
the gap-color underlay alone (a solid run of the gap color, no
dashes). Blank only exists inside the range window: the swatch is
hidden while the range is off, turning the range off retires a stored
blank pick back to solid, and the renderers treat a lingering blank
with no active window as solid. A parsed custom dasharray still wins
over the swatch pick, blank included. Values are raw axis values like value-mode
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
channel's per-category Ink color pick (`pattern.inkColors[patternValue]`)
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

**Unresolvable mapped values fall back to the channel default.** When
a color-pipeline channel (hue, saturation, brightness, opacity) is
mapped but a row's/slice's value can't resolve through its scale
(blank/NA cell, value outside the scale's domain), the mark renders
with that channel's DEFAULT — hue → the default fill, sat/bri → the
default saturation/brightness level, opacity → the default opacity —
exactly as if the channel weren't mapped. One convention across every
renderer, row-based and group-based alike. (Geo maps are the deliberate
exception: an unresolvable mapped measure there means "missing data"
and takes the no-data fill/pattern instead.)

**Custom shape glyphs.** Every shape row (the Default-shape picker and
the per-category rows) offers the six built-in symbols plus the chart's
**custom glyphs** and a trailing **"+" chip** that opens an inline
editor: type a short text glyph (up to 3 characters — counted as
user-perceived characters, so one emoji is 1 — tinted by the mark's
fill color like a symbol) or **upload an image**
(downscaled to ≤128 px and stored as a data URL inside the visual;
rendered as-is — fill / outline / pattern encodings don't apply to
image glyphs, though opacity still fades them). Creating a glyph
selects it for the row that opened the editor; the glyph list is
shared chart-wide, so a glyph made on one row is a pick on every row
(but per-VISUAL — a new visualization starts with an empty list).
Emoji arrive by typing/pasting them directly, via the system emoji
picker, or via **`:shortcode:` expansion** (`lib/emojiShortcodes`, a
curated common set): a complete `:fire:` converts on the keystroke
that closes it, and a bare `:joy` left in the box converts when Add
is clicked. The input never truncates while typing — Add disables
(with a hint) when the resolved text exceeds the cap.
Internally shape references stay palette indices — index ≥
`CUSTOM_GLYPH_BASE` (1000, a fixed constant well past the built-ins, so
the palette can grow without shifting saved references; visuals v8→v9
rebased the old "6 = first custom" indices) points into
`ShapeConfig.customGlyphs` — so themes, saved visuals, and the
auto-cycle (built-ins only) are untouched. Deleting a glyph (× on the
chip) tombstones its slot rather than splicing, keeping other rows'
indices stable; anything still referencing the deleted slot falls back
to the circle. Custom glyphs render on chart marks (scatter/line
points, radar dots) and in the legends that show the shape encoding.

**Saturation / Brightness levels are ANCHORED on the palette color,
not absolute HSL components.** `0.5` (`MODULATION_ANCHOR` in lib/scales)
means "draw the base color exactly as the palette has it" — and returns
the base hex string untouched, so the legend's un-modulated swatch and
the mark's fill are literally the same color. Below 0.5 the component is
pulled toward 0 (grayer / darker), above it toward 1 (more saturated /
lighter), linearly on each side. The anchor is the same number for every
hue, which is the point: modulation used to ASSIGN the level onto the
HSL component, so it overwrote each palette color's own saturation /
lightness. Since every swatch has a different one, no level reproduced
the palette, and swatches outside the configured range were unreachable
at any level. Theme ranges default symmetric about the anchor
(0.15–0.85), so the middle of an even category spread draws the real
color with the outer categories bracketing it.

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
Histograms ignore it — their bars always abut — so the Length panel
shows no gap control there. What the Length panel offers is a declared mode trait
(`canvas.lengthRole`): `"mark"` (scatter — px min/max range when a
variable is mapped, the single default length when not),
`"measure"` (bars / areas — the variable IS the mark extent via the
axis scale), or `"none"` (pies, tile, hexbin, maps, the structure
layouts — the panel says the chart type doesn't draw length, instead
of showing scatter's inert default-length control).

With BOTH positions and Length mapped (no angle / r) the panel leads
with **Draw as** — a *Segments* / *Bars* toggle (`LengthConfig.render`,
absent = segments): Segments is the line-segment scatter, Bars the bar +
marks combo of §3.3. It shows on the segment scatter and on the combo
it turns into, never on plain bars (one position) or lone segments.
In the combo the panel then continues as a bar mode (Bar gap).

Whenever scatter draws line segments (a Length variable is mapped, or a
default length is set), the Length panel adds a collapsible **Segment
properties** subsection, modeled on Connection → Line properties:
- **Vary by** — "— none —" shows one **Thickness** input (px,
  default 3; 0 hides the segments). Picking a categorical / ordinal
  variable swaps it for one thickness row per level (in the Fields
  panel's level order), each seeded at the single thickness with a
  per-row reset. The stored `segmentThicknessField` IS the mode — no
  separate flag; "— none —" clears the field and the per-level map.
  Levels key on the stringified cell, like connection thickness.
- **Line cap** — a Round (default) / Square segmented toggle. Square
  maps to SVG's `butt` cap so segments end flush at their endpoints.

The Length legend's segment swatches follow the single thickness and
the line cap (the swatch box grows with the stroke).

**Angle** on the polar modes (radar, pies) groups its controls under
collapsible subsections (all start collapsed), so the panel opens as a
short list of headers.
Pies lead with the Pie / Donut chart-type toggle above the sections.
- **Angle extent** — the **Min** / **Max** sweep in degrees (a gauge on
  pies, a partial dial on radar).
- **Spokes** (radar only) — the spoke count (quantitative / temporal
  angle; categorical angle always gets one spoke per category) and the
  spoke line's thickness / dash via the shared Spine control. Spoke
  color lives in the Color menu's Radar spine slot.
- **Spoke labels** (radar only) — the perimeter labels at each spoke:
  **Label angle** (rotation), **Label format** (the same preset dropdown +
  custom d3-format / d3-time-format box the x / y axes use),
  **Label every** N spokes (labels thin out from the first spoke; the
  spokes themselves all still draw), and **Distance** — px moved
  radially away from the chart (the layout shrinks the radar to keep
  pushed-out labels inside the cell); negative values pull the labels
  onto the disc, where they anchor so they read toward the center.
Angle mapped to mark rotation (e.g. on a scatter) has only the
Min / Max range, so that layout stays flat with no headers.

The **Area** panel additionally carries a **Scale by** choice
(`AreaConfig.sizeBy`) that applies everywhere the channel sizes marks
— scatter bubbles, geo bubble maps, packed circles:
- **Area** (default, stored as an absent key): value → circle AREA
  (radius ∝ √value via a power-0.5 scale). True proportions.
- **Diameter**: value → radius linearly. Exaggerates differences —
  legible on narrow-range data, at the cost of area honesty (a
  doubled value quadruples the ink). The size legend follows the
  same scale, so legend swatches stay consistent with the marks.

A NON-numeric ordinal Size variable sizes by RANK: the levels spread
evenly from the min to the max radius in their level order — the
Fields panel's pinned order when the user has set one (first level →
smallest, last → largest), else first-seen order (never smart-sorted).
Reordering the levels under Fields therefore re-ranks the marks, the
size legend, and the Area panel's per-category default sizes together
(`makeAreaScale`'s trailing `pinnedOrder`).

### 4.4 Connection panel
Connection is the line/area glue. Controls:

- **Chart type toggle** (Line / Area) — visible whenever connection is
  mapped. Switching to Area swaps `y → length` so the existing
  area-detection fires, and sets `connection.fill = "area"`. Switching
  to Line reverses the swap. Auto-sets hue stackMode to "stack" when
  switching to Area.
- **Line thickness** — px, with a "Vary by" dropdown for a single
  value or one thickness per connection value. The floor is **0**, not
  a hairline: thickness is the switch, so 0 hides the line and leaves
  the points (and, in area mode, the fill) standing — there is no
  separate "show line" toggle. Per-value overrides clamp to the same
  floor (`MIN_LINE_THICKNESS` in `lib/connectionThickness.ts` mirrors
  the input's `min`).
- **Smooth line** — a checkbox plus an **Amount** slider (5–100%,
  shown only while the checkbox is on). One stored number,
  `connection.smoothing` in [0, 1]: checking the box seeds 0.6,
  unchecking writes 0, and the slider is the fine control (no separate
  boolean). Above 0 the polyline is replaced by a cardinal spline
  whose tension is `1 - smoothing` (`lib/linePath.buildLinePath`) — the
  curve still passes through every data point, but sharp turns round
  off and can overshoot slightly. Applies to scatter connection lines
  and area/line-mode layer edges; radar polygons ignore it.
- **Line cap** — a Round (default) / Square / Tick segmented toggle, for the
  OPEN ends of scatter connection polylines and area/line layer edges
  (dash segments included). "Square" maps to SVG's `butt` cap: the
  stroke ends flush at the endpoint's data position instead of
  extending half a stroke-width past it. "Tick" ends flush the same
  way and adds a perpendicular tick mark centered on each end of the
  line (the first and last point only — never at dash-run or range
  boundaries), in the line's own color, thickness, opacity and
  hover-highlight treatment: the whisker ends of a box-and-whisker
  plot, the ends of a range line. Picking Tick reveals a **Tick
  length** input (px); blank = auto, `max(8, 4 × line thickness)`,
  shown as the placeholder. Stored as `connection.lineCapTickLength`
  (`null` = auto). Ticks draw on line-mode layer edges only, never on
  filled areas. Radar polygons are closed, so caps never show there.
- **Show points** — `all`, `none`, `first-only`, `last-only`,
  `first-and-last`, `every-n` with stride N, or `custom` ("Custom Nth
  point"), which reveals a textbox of comma-separated positions along
  each line, counting from 1 at the first point (stored structured as
  `connection.pointIndices: number[]`). Custom adds no endpoint anchors
  and ignores positions past a line's end. Drives marker visibility
  along each line.

Thickness, smoothing, and line cap share the panel's **Line
properties** subsection, which is shown in line and area modes only.

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
- **Share axes** — separate segmented toggles ("Share X axis" / "Share Y axis";
  polar: "Share R axis" / "Share Angle axis") for sharing the x-axis or
  y-axis across panels in the same row or column. When shared, all axes have
  the same extent; tick labels render only on one row / column edge.
  Default is shared. Only for axes the mode draws (`canvas.cartesianAxes`
  — radar / pies swap in R / angle pickers; maps and the structure
  layouts draw no axis, so their facet panel has no share rows or range
  editors, only the panel size inputs). In grid mode the Facet (row)
  and Facet (col) panels EACH carry both a "Rows" and a "Columns"
  subsection (own axis listed first) — the share modes are grid-wide
  bits, so either panel can share or unshare either axis without
  hopping to the other. Pie rows have no axis: the row panel shows a
  one-line hint in place of "Rows" and still offers "Columns".
- **Size row heights / column widths by category count** — when
  checked, panels with more categories on the relevant axis get
  proportionally more height / width so categories stay evenly spaced
  across every panel. Labeled "Size panel heights / panel widths by …"
  when there is only one row (column). Shown when it
  can change anything: Share = None with 2+ panels, or Per row / Per
  column in a 2D grid; hidden under All panels (every panel identical).
  Under None, panels side by side can differ in height: the row takes
  its tallest panel's height and shorter panels sit inside it,
  bottom-aligned so the x axes share a baseline (columns mirror this,
  left-aligned). The panel's title moves down with it.
- **Size row heights / column widths by unit range** — same idea, but for
  quantitative axes: panels with a larger axis range get proportionally
  more space. E.g. panel A's y is 0–10 and panel B's y is 0–20 → B is
  twice as tall, whether they're stacked or side by side. The range is
  the axis as DRAWN (the auto-fit ends rounded outward to the tick grid,
  a pinned end exact), so one unit is the same number of pixels in
  every panel and a given tick value sits at the same height across
  the row. Same gating.
- **Axis range** — Min / Max inputs for the continuous axis (titled
  "Y axis range", "Angle axis range", …), shaped by
  its share mode: one overall range under "All panels", one per row /
  column under "Per row" / "Per column", one per panel under "None"
  (wrap mode keys these by facet value in `panelAxisOverrides`; the row
  / column panels list the rendered panels, labeled "row · column", and
  store each one's bounds under its row value and then its column value
  in `gridPanelAxisOverrides` — two keys, never a joined one — and with
  a single panel across the other direction the per-row / per-column
  editor already IS per panel). The rule across wrap, row, and column
  panels:
  a continuous axis (quantitative or temporal — never categorical /
  ordinal) can always be bounded, shared or not. Blank = auto-fit; a typed
  bound is kept exact (no `.nice()` rounding). The editor gates on the
  field the axis ACTUALLY reads — a vertical bar's y axis is its
  Length measure, so the editor shows even though Y position is empty,
  and a bar/area measure axis always counts as continuous (a
  histogram's count axis has no field at all). The size-by-unit toggle
  keeps the raw position-encoding gate, since its weights read that
  field.
  **Replace ticks**: every cartesian range entry (overall, per row /
  column, per panel) has a "Replace ticks" checkbox under its Max.
  Checking it opens a **Ticks at** box (comma-separated values; dates on a
  date axis) whose values REPLACE the tick layout of the panels that
  entry covers — the automatic ticks and the X / Y Custom breaks alike,
  unlike those breaks, which add to the automatic ticks. "Match tick
  count" gridlines follow the replaced ticks; values outside the panel's
  range aren't drawn (all outside → no ticks). Checked with the box
  empty = the normal layout. Stored on the same entry as the bounds —
  `ticks` on the overall / per-row / per-column entries, `xTicks` /
  `yTicks` on a per-panel one — with the same precedence; unchecking
  removes the list (and an entry left empty). The layout solver
  measures the replaced labels for the axis margin. Polar R ranges
  don't offer it.
- **Horizontal gap / Vertical gap** — the distance in px between
  neighbouring panels' plot areas (default 60). **0 means the plot areas
  touch**; negative values slide them over each other (ridgeline plot
  territory). Tick labels, axis margins and panel titles that sit between
  two panels live inside this distance, so a gap narrower than them lets
  them overlap the neighbour. Panels expand or contract to keep the total
  layout area constant down to 0; below 0 they keep their touching size
  and only overlap. (Before 2026-10-20 the gap ran between whole cells,
  plot plus axis chrome; saved visuals and imported bundles move onto the
  new measure by adding 30px — visuals v8.)
- **Edit facet titles →** — the last item of the facet Row / Column /
  wrap panels' "Panel spacing and sizing" subsection: a right-aligned
  text link that jumps to Titles → **Facet titles** (in a grid split,
  the first of the "(row)" / "(column)" / "(panel)" subsections that is
  rendered). It opens the Titles section and that subsection and scrolls
  it into view; if the target subsection isn't rendered (its Titles
  shown box is off) it opens Titles and scrolls to the section instead.
- **Panel order** — custom ordering of panels by the facet variable's
  levels.

### 4.5a Hide empty panels (facet grid)
The facet Row and Column option panels each carry a **Hide empty
panels** checkbox in their "Panel spacing and sizing" subsection — one config
bit (`FacetConfig.hideEmptyPanels`) mirrored into both panels, shown
only when BOTH `facetRow` and `facetCol` are mapped (the row × col
cross-product is the only source of empty panels). Pie mode included:
the row panel's "no row axis" hint replaces only its Rows subsection,
not the Panel spacing and sizing block.

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

- **Panel keys stay `${rowValue}|${colValue}`** in memory — the
  `data-panel` selectors and the key every scope check matches against
  are unchanged. (What is SAVED for a grid panel is its `{ row, col }`
  pair — see "Saved keys are structured" under storage — which maps
  onto that key.) An annotation scoped to a dropped panel simply
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

- **Spine** — color, thickness. **Set spine at 0** (checkbox): moves
  THIS panel's own spine — the same line the Color/Thickness rows
  style — to the PERPENDICULAR scale's zero instead of the plot edge.
  On the X panel the horizontal spine drops to y = 0; on the Y panel
  the vertical spine moves to x = 0. Shown only when the perpendicular
  position variable (its direct field, or the `length` measure when
  that axis is the implied measure axis) is quantitative with data
  below 0 — or while already checked, so it can always be unchecked;
  hidden on the histogram count axis (the binned perpendicular axis is
  bands, so 0 has no pixel). Only the spine line moves; ticks, labels,
  and title stay at the edge (and the edge-anchored ticks drop their
  spine-thickness inset, since there is no spine stroke at the edge to
  clear). The spine-replaces-coincident-gridline rule (below) tracks
  the moved position: the gridline at the zero crossing is dropped,
  and the plot-edge gridline comes back. When 0 falls outside the
  perpendicular resolved domain (e.g. a pinned min above 0), the spine
  falls back to the plot edge rather than vanishing. Stored as sparse
  `AxisConfig.spineAtZero` on the axis whose spine moves; resolved in
  `components/viz/coords/cartesian.tsx` (the only place holding both
  scales), so it applies to every cartesian renderer and faceted
  panels alike. Cartesian only — radar/polar axes never see it.
- **Tick marks** — color, thickness, length (Ticks section). Where the
  rows sit below other controls (the chord ring axis), they open with a
  standard "Tick marks" group header behind a divider.
- **Ticks + Scale: count, min / max, custom breaks** — the **Ticks**
  section holds the tick density (**Count** picks the automatic tick
  density, 0 = no automatic ticks) and the Tick marks rows. The
  **Scale** section, right after Ticks and before Tick labels, holds
  the domain controls: **Min** / **Max** (continuous axes; blank =
  auto-fit — no separate "Scale range" heading, the section title
  names it), **Custom breaks**, and the mirrored-axis group below. It
  carries its own changed dot (min / max, custom breaks, mirror
  settings) and is omitted when none of its groups apply (e.g. a
  categorical axis that can't be mirrored). **Custom breaks**
  (continuous axes only) pins extra
  ticks at listed positions, ADDED to the automatic layout — set Count
  to 0 and list breaks for fully custom ticks. Breaks outside the axis
  range are dropped, and a break coinciding with an automatic tick
  draws once. Tick labels simply follow the ticks — every tick gets a
  label; there is no separate label-position control.
  **Scale range and breaks on a faceted visual**: the X / Y Scale
  section's Min / Max is the global default for every panel; a range set in the Facet
  panels (overall, per row/column, or per panel) overrides it for the
  panels it covers. The help text says so while the visual is faceted.
  Custom breaks apply to every panel, except one whose facet range entry
  has Replace ticks checked — those replace the panel's ticks outright.
  **Count composes with Min / Max**: while the domain is auto-fit
  (either bound blank), Count is a density hint and the ticks snap to
  round "nice" values, so the exact number may differ. Once BOTH min
  and max are pinned (Scale Min / Max, or a facet range override), the
  axis lays out exactly Count evenly spaced ticks from min to max
  inclusive — 0.04–0.24 with Count 6 gives 0.04, 0.08, 0.12, 0.16,
  0.20, 0.24 — and "Match tick count" gridlines follow the same
  layout. Exception: while Count is still at its default (5, never
  touched) and the round "nice" ticks already land on both pinned
  ends, the axis keeps those nice ticks, so a facet panel pinned to a
  sibling panel's auto range shows the same breaks as that sibling.
  On a DATE axis the even ticks snap to the calendar unit the
  step reads as (year starts for a ten-year step, month starts for a
  six-week one, midnight for a daily one), so 1949–2019 with Count 8
  reads 1949, 1959 … 2019 rather than the stray hours leap days would
  leave. The ticks step by a WHOLE number of that unit from the first
  boundary after min (1950–2019 with Count 8 reads 1950, 1960 … 2010,
  2019, never 1980, 1989, 1999 from rounding each tick), so a date axis
  may draw one more or one fewer tick than Count; an END within a hair
  of a boundary snaps onto it, a deliberate mid-year end keeps its own
  value. Typed and picked dates (min, max, Custom breaks) are
  local-calendar days, the same clock the axis ticks on. Date bounds
  are entered as YYYY-MM-DD or picked from a small calendar whose
  Month and Year are SEPARATE dropdowns over a day grid (never the
  browser's one long "Month YYYY" list). The dropdowns set the bound
  straight away: with a date set they move it to the same day of the
  chosen month / year (clamped to the month's length); on a blank
  field the picker opens on January of this year and a choice sets
  the 1st of that month. A day click refines the day. A blank clears
  the bound. Pinned bounds are also respected exactly on bar / area
  measure axes (the auto-fit rounding-outward applies only to blank
  ends).
- **Use a mirrored axis** (Scale section, its own ruled mini-section
  below Custom breaks; bar charts' IMPLIED measure axis only — the
  field-less position axis the `length` measure feeds, so the X panel
  on horizontal bars and the Y panel on vertical ones). For opposed
  counts that are NOT negative — expenses vs. profit, covered vs.
  out-of-pocket, a population pyramid — the axis runs through 0 and a
  two-option **Direction** variable sends each row's bar to one side:
  the variable's FIRST level (pinned Fields order, else first-seen)
  draws on the negative side (left / down), the second on the positive
  side; the helper text names which is which, and reordering the
  levels under Fields swaps them. Only variables with exactly two
  distinct values are listed (a chosen variable that stops qualifying
  stays listed, disabled, so the picker never goes blank). The sign is
  applied at render time
  (`applyMirrorSign` negates the negative level's measures before
  aggregation, and the diverging-stack ledgers do the rest), so the
  data stays positive and every displayed value — tick labels (the
  format spec applies to the magnitude), data labels, tooltips — shows
  the magnitude. While on, **Left max / Right max** (Lower / Upper on
  a vertical measure axis) replace Min / Max: each pins how far its
  side extends (blank = auto-fit from that side's data), and a
  mirrored **Custom breaks** box replaces the plain one — each
  magnitude pins a tick on BOTH sides (`50, 100` → ±50, ±100), still
  additive to Count. Faceted panels sharing the measure axis share the
  mirrored floor / ceiling (`mirrorRows` in `shareScales.ts`). The
  category axis's Spine section offers "Set spine at 0" while the
  perpendicular axis is mirrored. Stored as sparse
  `AxisConfig.mirror` (`MirrorAxisConfig`); unchecking clears it. With
  the box checked but no valid direction, bars render unmirrored and
  only the side maxes apply. Gated on the `canvas.supportsNegativeMeasure`
  mode trait — the flag is inert on every other renderer, and the
  section stays visible while checked so it can always be turned off.
- **Gridlines** — enabled toggle, color, thickness, custom count
  (default: match tick count). "Match tick count" follows the
  AUTOMATIC tick layout only — the Scale section's custom breaks get
  no gridlines of their own. **Custom breaks** here (continuous axes
  only) pins extra gridlines at listed positions, drawn in addition
  to the automatic lines (match-tick or explicit count); a break that
  coincides with an automatic line paints once. **The spine replaces a
  coincident gridline**: this axis's gridlines run parallel to the
  opposing axis's spine, so one can land exactly under it (an
  x-gridline at the left spine, a y-gridline at the bottom spine) and
  the translucent gridline antialiases against the spine edge into a
  blurry double line. Whenever the opposing spine is visible
  (thickness > 0), any gridline its stroke covers is dropped — the
  spine draws there instead. The test compares the gridline against
  the opposing spine's drawn position (the plot edge, or its zero
  crossing under "Set spine at 0"), and the tolerance is half the two
  strokes' combined width. Cartesian coordinates only (`Axis`'s `opposingAxis`
  prop, passed from `components/viz/coords/cartesian.tsx`); polar and radar axes
  have no opposing spine.
- **Adjust position** (end of Tick labels, behind a divider) — X / Y
  pixel nudge that moves the TICK LABELS only. The control sits in the
  Tick labels section, so nothing else follows it: the spine, tick
  marks, axis title, and gridlines all stay where they were. Same
  input convention as the data-labels nudge: positive X = right,
  positive Y = up (stored in screen coords, sign flipped at the input
  boundary). The legacy perpendicular `offset` field is read while the
  new `offsetX`/`offsetY` are unset and cleared on their first write.
  The radar **R** panel has the same control: it moves the r-tick
  labels along the 12 o'clock spoke, and the rings and spokes stay put.
  X and Y each carry their own reset link, shown only while that value
  is non-zero; resetting one keeps the other's nudge.
- **Angle** (Tick labels) — tick label rotation in degrees. Blank =
  auto: a categorical / ordinal x-axis rotates its labels to -45° when
  two NEIGHBORING labels would collide (half of each label's measured
  width plus a quarter-em gap exceeds the spacing between their ticks;
  `lib/autoLabelAngle.ts`), every other axis stays level. One wide label
  beside short ones therefore fits where it wouldn't beside another
  wide one — the test is per neighbor pair, not widest-label-vs-band.
  The renderer publishes the angle it resolved and the blank field
  shows it as its placeholder (so the spinner steps from -45, not 0).
  Any typed number is explicit and wins outright, INCLUDING 0: a
  **set to 0** link appears beside the field while auto has rotated
  the labels, and pins them level; **reset** on an explicit value
  returns the field to auto. Stored 0 meant auto before visuals v6 —
  that migration (and the seed / bundle-import paths, which carry no
  storage version) clears it to blank. The tick density control
  (**Count** / **Tick every** / **Label every**) lives in the **Ticks**
  section on every axis, the radar r axis included — r's Ticks section
  holds only that control, since the radar draws no r tick marks; r
  has no Scale section (no r ranges or breaks).
- **Wrap text** (Tick labels) — line-wraps long tick labels. X-axis
  labels wrap to their per-tick slot width; y-axis and radar r-axis
  labels wrap to a fixed font-relative max width (~8em). Wrapping
  breaks on spaces, splitting a word only when it alone exceeds a
  line. While on, the categorical auto-rotate stays off (wrapping
  replaces rotation as the overflow strategy); an explicit tick label
  angle still applies. The layout solver reserves matching multi-line
  room (line count below the x-axis, widest line left of the y-axis).
- **Characters** (Tick labels) — shown while Wrap text is on. Blank
  ("Auto") keeps the width-based wrap above. A number sets a target
  line length instead: each line breaks at the space or internal
  hyphen NEAREST that many characters (same rule as Data Labels'
  Wrap text → Characters), explicit line breaks are honored, and a
  single word longer than the target stays whole rather than being
  split. Applies to x, y and radar r axes; the solver pre-wraps with
  the same target so reserved room matches.
- **Align** (Tick labels) — a left / center / right row (same
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
- **Tick label format** — the **Label format** row: a dropdown of preset d3-format strings,
  grouped **Numeric** (comma-separated thousands, whole numbers,
  percent), **Currency** (whole dollars, dollars and cents, and
  Thousands / Millions / Billions — `$,.1~fK`, `…M`, `…B`),
  **Scientific** (scientific notation, SI prefix, and plain-number
  Millions / Billions — `,.1~fM`, `,.1~fB`) and **Temporal**, plus a
  Literal "as-is" option, that populates
  an editable text box. The user can pick a preset and then refine it
  as raw d3-format syntax. The Temporal group's **Year Mixed** preset
  (`year-ends`) is the house style for year-only axes: the first and
  last tick spell the year in full and the ticks between abbreviate it
  with a typographic apostrophe — 2020 ’22 ’24 ’26 ’28 2030. It reads a
  year as a Date, a plain number (never coerced through a date, unlike
  `%Y`, which turns a bare 2020 into 1970) or a numeric category; the
  ends are the ends of the tick set as drawn — Custom breaks, facet
  replaced ticks and a categorical stride included — and one or two
  ticks print in full. Legend gradient breaks get the same ends
  treatment; everywhere else (data labels, tooltips) there are no ends
  and every year prints in full. A d3 spec ending in an uppercase `K`, `M` or
  `B` divides every value by that scale and prints the letter after it
  ("$12.5K", "$1.2M", "$1.2B"): ONE scale for every label, unlike the
  SI-prefix preset, which d3 picks per value (and spells billions "G").
  The letter works on any numeric spec (`,.0fM` → "7M"). The dropdown keeps
  SHOWING the preset the box's text came from, so the pair reads as
  "the preset I picked" over "my edit of it": an exact match wins,
  otherwise the spec is split off the literal text around it (`,.0f kg`
  → Whole numbers, `€literal` → Literal) and matched, and an empty box
  reads as Auto. Box text no preset accounts for — a hand-written spec,
  or a preset this chart doesn't offer — shows a display-only **Custom
  (edited below)** entry; picking it changes nothing. Every format
  dropdown in the sidebar — x / y / r tick labels, the chord ring
  axis's Tick labels, radar Spoke labels, per-field data labels, legend
  measure labels — offers this ONE preset list (`formatPresetGroups`,
  rendered by `FormatPresetOptions`); only the countries-level
  Geography group (§ maps) is conditional.
  The box also takes literal text around the value (a help line under
  it says so — "Text around the value goes in the same box: `,.0f kg`,
  `literal%`, `€literal`." — and the box's hover tooltip spells it out), so whole-number
  percents (3 meaning 3%) need no derived variable: `literal%` prints
  "3%" (also a preset, "Literal + %"), `literal units` prints "3 units",
  `€literal` prints "€3", and text after a d3 code is appended too
  (`,.0f kg` → "1,234 kg"; a d3 code never contains whitespace, so the
  split is at the first space). The text is kept verbatim — the space
  in `literal units` is the gap, `literal%` has none. Time-format codes
  are used whole (`%Y years` already prints its text). A DATE axis's
  Auto labels share ONE format, chosen from the finest calendar
  component across its ticks: year starts read "1949 … 2019", a set
  with a month start among them reads "Jan 1988 … Oct 1988", day starts
  "Mar 5, 2024", then "… 09:00", "… 09:00:15" (never d3's per-tick mix
  of "1988", "Jul" and "04 PM"). Literal on a date axis means the value
  straight from the data column: the column's text SHAPE is read from
  its cells and every tick prints in it — a column of "1947", "1948" …
  labels ticks "1949", "1959" (never "1949-01"), a column of "7/15/1988"
  labels them M/D/YYYY. A tick landing
  exactly on a cell prints that cell; only a column whose cells don't
  share a recognised shape falls back to ISO text at the tick set's
  granularity ("1988", "1988-07", "2024-03-05"). A lone date elsewhere
  (a data label) prints ISO at its own granularity. The explicit
  form `prefix{spec}suffix` covers the rest: `{}%` wraps the Auto
  labels ("0%", "5%", "10%"), `~{,.0f}` puts text before a d3 code. An
  empty value stays empty (never a bare "%"). Everything is the ONE
  stored string the user typed (`parseFormatSpec`), so saved visuals,
  themes, undo, and the "changed" dot need no new fields; the dollar /
  percent cell hints (§ 2.2) fill the *spec* half when it is Auto and
  keep the text.
- **Distribution overlay** — adds a violin or box plot on the value
  axis of strip plots (categorical × quantitative). The box draws its
  Tukey outliers as small open circles only while the underlying data
  points are hidden; when "Show points" is on the real points already
  mark those values, so the box suppresses its own outlier circles
  rather than double-drawing them. The Shape panel's **Violin / box
  outline** (shown only while an overlay is on) drives the violin
  outline and all box strokes (body, whiskers, caps, outlier circles) —
  a separate knob from that panel's point **Outline width**; width 0
  hides the borders. The median line stays 1.5× that width for
  emphasis.
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
  by pattern" is hue=group + pattern=stack. `computeBarMeasureMax` /
  `computeBarMeasureMin` are leaf-aware so the axis bounds match the
  bars. Data labels show per-bar values.
  **Negative measures point the bar the other way.** The measure axis
  auto-fits to `[min(0, lowest), max(1, highest)]`, so a negative value
  draws from the zero baseline away from the positive direction (down
  on `bars-x`, left on `bars-y`) instead of collapsing to nothing. Bars
  stack DIVERGING: within a leaf, positives cumulate up from zero and
  negatives down from zero on separate ledgers, so neither side eats
  into the other. An all-positive chart is unchanged (floor stays 0);
  an all-negative chart tops out at 0 rather than stranding empty axis
  above every bar. Faceted panels sharing a measure axis share the
  floor too, so a panel with no negative values still sits on the
  group's baseline. Areas keep the zero floor for now — the behavior is
  gated on the `canvas.supportsNegativeMeasure` mode trait, which only
  the bar modes declare. **Use a mirrored axis** (§5.1) rides on this
  same geometry: it sign-flips one direction level's positive measures
  before aggregation, so the bars split around 0 with nothing negative
  in the data; the `Aggregation.mirrored` flag turns every displayed
  value back into a magnitude.
  **Combo marks layer** (`combo-x` / `combo-y`, §3.3): BarPlot also
  renders the other position variable as scatter marks over the bars —
  ScatterPlot's own `buildMarks` / `renderConnectionLines` /
  `renderAxisStems` / `renderMarkPaths` run over the bars' scales (a
  point scale over the band centers for the category axis, the measure
  scale for the values), with Length and Angle stripped from the
  aesthetics the marks resolve so Length means the bars, not a segment
  on each point. Marks are per ROW, not aggregated; lines sort along
  the category axis like a line chart. The layer has its own hover
  state (full-row tooltip, "Show tooltips only at points", point
  sampling, draw order) and its pattern defs merge with the bars' by
  svgId. The measure bounds include the marks' extent
  (`lib/comboOverlay.ts`, shared with the shared-axis fold and the
  solver's tick estimate). The marks' fills are rewritten after
  `buildMarks` through `comboPointFillResolver` (same module): the
  Point fill slot when configured, else the row's line color via the
  shared `resolveConnectionStroke` chain keyed by its Connection
  value — the per-shape fill / stroke follow when they were derived
  from the hue fill; pattern fills and explicit per-category shape
  overrides stay. Data labels draw in two `DataLabelsLayer` instances
  split by `labelFilter`: the bars' from slice anchors, the marks'
  from the row path over the marks' scales (ranked per Connection
  series like a line chart's), each label routed by `dataLabelLayerFor`
  (`fieldLayers`, else the variables it shows against
  `comboMarksFields`). The layout reserve routes the same way, so a
  label on the marks takes no bar-side shift.
- **ScatterPlot** — points at (x, y), sized by area, colored by hue,
  shaped by shape. When `connection` is mapped, renders polyline
  overlays (line chart). The Connection panel's "Show points" control
  is the place where point sampling lives — it's a Connection
  feature, not a scatter-wide one.
- **AreaPlot** — stacked or overlaid filled regions. Line vs area
  fill toggle controls outline-only vs filled rendering, and exposes
  independent line and area colors. The Color menu's Outline subheader
  (areas and filled radars) offers "Match fill" (each layer's outline
  inherits its fill), "Single color" (one uniform stroke via
  `connection.strokeColor`), or a theme palette; per-value overrides
  win on top in every mode.
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
  Filled polygons take the Pattern menu's separate "Polygon fill" pick
  (`resolvePolygonPatternDef`); points take the ordinary point-fill
  pattern (§4.2). Each series paints as ONE unit — polygon body +
  outline, then its own dots — in draw order, so a series underneath
  never has its points poke through the series above it; points with
  no connection value paint last.
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
  reads through color), `partition` → arcs (labels on the arc's
  mid-angle when the arc can hold them, emitted through the shared
  `DataLabelsLayer` in its `"layout"` gate so the Data Labels
  fine-tuning applies — see §6.5; sunburst draws its own polar
  geometry like the pie renderer, so canvas traits stay cartesian).
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

**Every X / Y position input carries its own reset link** (title,
facet-title and panel-title Adjust position, data-label X / Y at every
scope plus the pie / sunburst Angle and R, caption Adjust position, the
inside-legend X / Y), shown only while that one value differs from its
default (0 for the nudges; the config default elsewhere). There is no
shared reset on an "Adjust position" header. The same per-input rule
covers the caption's Size Width / Height (reset = auto) and the data
labels' wrap Characters (reset = 20).

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
group along x or y), and an **Angle** input (±90°, same convention as
the axes' tick-label Angle: positive = clockwise) that rotates each
label — together with its text-background rect — around its own anchor
point. Rotation is paint-time only: the overlap-avoidance pass and the
solver's margin reserve still measure the unrotated footprint, and it
is layer-wide (no first/last split).

The position rows (**X / Y**, or **Angle** alone on a pie — there is no R
row; pie labels sit at the wedge midpoint and the Adjust-position R%
nudge moves them radially) start on the
chart's own encodings: an unset row INHERITS the chart's field for that
channel, live (re-map the chart's X and the labels follow), and the
dropdown shows it selected. Picking a field overrides it; picking
**— none —** is stored as `none: true` (an unset row would inherit
again). The inherited value is resolved at read time
(`resolveDataLabelPositions`, renderers via
`renderDataLabelsEncodingsAtom`) and never written into the visual.
Labels still draw only once a **Value** is mapped, so nothing appears
until the user picks one.

The layer also has these controls:

In the TREE layouts (packed circles / treemap / sunburst) labels are
placed by the layout itself, so the panel hides its position rows.
Value, Color, Size, and Text still apply
(see §6.2); Value defaults to each row's name. Packed circles and
treemap draw their labels themselves, so the position / overlap /
background fine-tuning stands down there too. The SUNBURST hands its
arc anchors (already placed, styled, and fit-gated) to this layer in a
`"layout"` gate — no position or Value mapping required, and the
per-series "Which labels" selection stands down (no series) — so it
keeps the rest of the fine-tuning like a pie: Avoid overlaps (the 2-D
spread, as on maps), Align, text Angle, Wrap text (the fit gate
then measures the widest wrapped line, so wrapping is how a long name
fits a narrow arc), X/Y pixel nudges, position rules, and Text
Background. Its **Adjust position** polar pair is Angle (the pie's
`polarLabelAngle`, rotating every label off its arc's midpoint) and a
RING-relative **R** (`ringLabelRadius`, percent across the ring's
thickness from the inner edge — 50% (default) is the middle, 100% the
outer edge, >100% outside the ring); the pie's center-relative R
doesn't transfer because each ring sits at its own radius.

On the FLOW diagrams (chord / sankey) labels sit on NODES — beside each
sankey rect (left of last-column nodes, right of the rest, vertically
centered) and just outside the chord ring (outside the ring axis when
shown) at the node's mid-angle. The renderers hand those anchors to this
layer in the `"layout"` gate, like the sunburst, so labels show with
nothing mapped. The **X / Y position rows are greyed out, not hidden**
(a note says labels sit beside each node); everything else applies:

- **Value** starts on the SOURCE column — the node names — shown
  selected (an unset Value means that column on a flow), so its Text
  format, before / after text included, is right there. Picking
  **— none —** hides the node labels (stored as `value.none`, since an
  unset Value already means "the names"); "Multiple variables…" from an
  empty checklist starts with the source column checked. It offers the data set's
  variables plus three flow-only values — **Flow in**, **Flow out**, and
  **Node total** (the drawn size: in + out on a chord, whose arc spans
  both its outgoing and incoming ribbons; the larger of the two on a
  sankey) — and
  "Multiple variables…" composes them like any chart (`{Start} · in
  {Flow in}`; the source and target columns both read as the node's
  name). A dataset variable on a node aggregates the node's OUTGOING rows
  (an end node with none uses its incoming rows) — numbers sum, text
  takes the first non-empty value, the bar-label rule — so a middle node
  isn't counted twice. A column already named like a flow-only value
  keeps the name (the flow-only value isn't offered). The TARGET column
  and the WEIGHT column aren't listed under Value / Size — on a node the
  first repeats the name (the source column already offers it) and the
  second is Flow out again (Flow in on an end node) — unless already
  picked. Totals follow the
  DRAWN edges: on a sankey, the cycle-closing edges it hides don't count.
  `lib/flowNodeLabels.ts` builds each node's record.
- **Color** maps the data set's variables; on an endpoint column it
  colors labels by node over the same node-union domain as the marks.
  **Size** also accepts the flow-only values (font scales with node
  total).
- **Which labels** (under Label selection) picks NODES by flow
  direction — one choice for every label (`flowLabelNodes`). Sankey: All
  nodes (default) · First senders (no incoming flow) · All senders (any
  outgoing) · Last receivers (no outgoing flow) · All receivers (any
  incoming). Chord: All nodes · Senders · Receivers; a sankey-only pick
  reads as its chord equivalent, and when every node both sends and
  receives a hint says the three label the same nodes. The per-series
  "Which labels" / "Of each" stand down (no series).
- **Position and alignment**, **Text** and **Box** all
  apply. Align's default (center) is automatic:
  text reads away from the node (end-anchored on the left half of the
  ring and on a sankey's last column); Left / Right force the anchor.
  The chord ring makes room for its labels: each selected node's widest
  line (composed labels included, at the largest size a mapped Size can
  reach, cut at the Wrap width when wrapping) is measured first, and the
  ring takes the largest radius at which every label fits inside the
  panel at its own angle. It never shrinks below half its room — past
  that, very long names run over the edge rather than disappear.

Defaults come from the theme's **Data labels** text block (Settings →
Themes → Text: family, color, size, weight, italic, underline), like
every other chart's labels; the legacy Text-channel styling no longer
applies to flow labels. Visuals that styled them through the retired
Labels → "Node titles" section are folded on intake (open, save,
bundle import, example seed — `lib/foldFlowNodeTitles.ts`, beside
`structureVisualKeys`; idempotent, no storage version bump): font
family / size / weight / italic / underline / color → the Data Labels
text fields, alignment → Align, x / y → the x / y nudges; the old
radial "Distance from figure" offset has no equivalent and is dropped.

In the GEO modes (choropleth / bubble map / dot map) labels anchor to
REGIONS: a **Geography** row replaces the X/Y position rows. Its field's
values join to map regions exactly like the map's own region channel —
but INDEPENDENTLY of it, at a level auto-detected from this field's own
values, so a county choropleth can carry state-level labels (pick the
state column as Geography and a state-average column as Value). Each
matched region renders ONE label at its centroid: the first row (in
dataset order) among the region's rows whose composed Value text is
non-null supplies the text (and the Color / Size lookups), so a value
column that's blank on some rows still labels from the rows that carry
it; unmatched values, blank-value regions, and regions the projection
or focus box clips render no label. Both Geography AND Value must be
mapped for the layer to render. Single- and multi-variable Value work
as everywhere else (per-variable colors don't apply — same as bars);
when the Geography field IS the map's region field, the map's key-type
override carries over to the label join. Labels live inside the map's
pan/zoom group, so they move (and scale) with the geography. "Which
labels" (per-series endpoint selection) is hidden and skipped in geo
modes — there are no series on a map; overlap avoidance (2-D on maps —
colliding labels fan out in any direction, see §6.2), offsets,
alignment, wrap, text properties, and text background all apply.

On COUNTRIES-level label joins (auto-detected from the Geography
field's values), the Label-format dropdowns additionally offer a
Geography preset: **Full country name**. It formats any recognizable
country value — the atlas's abbreviated short name, a variant, an ISO
code — as its preferred long form ("Dem. Rep. Congo" → "Democratic
Republic of the Congo", "Congo" → "Republic of the Congo"), printing
unrecognized values as-is. It's stored as the `country-name` spec in
the same per-field `fieldFormats` store as the d3 presets (no new
config field), resolves through the same alias table the join uses
(`lib/geo/countryNames.ts`, §2's country aliases), and is hidden on
every other chart type and geography level — other dropdowns are
unchanged.

Geo modes add a **Show leader lines** toggle under Label selection
(geo-only; hidden elsewhere). When on, every label that sits
away from its region's centroid — displaced by the X/Y offsets or by
overlap avoidance — draws a straight line from the centroid to the
nearest edge of the label's box (including the text-background rect's
padding when one is drawn, plus a small gap), rendered UNDER the label
text. A label still on its centroid draws no line, so an untouched
layer stays clean. Checking the toggle reveals **Line color** and
**Thickness** inputs (thickness 0 hides the lines), each with a reset
link that appears when the value deviates from — and restores — the
theme default; the defaults come from the theme's **Maps** section
(`mapLeaderLineColor` /
`mapLeaderLineThickness`, falling back to #999999 / 1px for themes
saved before the fields existed), seeded on chart creation and flowed
through on a theme switch like the data-label font knobs. Leader lines
live inside the map's pan/zoom group with the labels.

Packed circles additionally get a **Text position** subheader with one
"Wrap label around" checkbox per CONTAINER level (top level circle,
second level circle, … — levels come from the drawn hierarchy, the
deepest all-leaf level excluded; with no grouping circles the
subheader is not shown). A checked level draws its group names on an arc
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

- **Bar total** (bars only) — a bar chart layered by a stack- or
  overlay-mode channel offers one derived value under Value, ahead of
  the data set's variables and in the "Multiple variables…" checklist
  (exactly where the **Stack** scope below is offered): the sum of the
  layers in each physical bar — one sub-band of the category band, on
  one sign side, so a diverging bar's two sides total separately and a
  mirrored bar shows each side's magnitude. It is the bars' counterpart
  of the flows' Node total (`lib/barTotalLabel.ts`): the same string is
  the dropdown entry, the `{Bar total}` token and the key in the
  per-variable format / style maps, and a data set column named "Bar
  total" wins (the derived value isn't offered). Every layer carries its
  bar's total, so `{value} of {Bar total}` composes on each slice.
  Picking it starts the label where a total reads as the bar's — once
  per bar, past its end: a single Value seeds Which labels **Last** of
  each **Stack** and Placement **Outside the end of the bar**
  (layer-wide); checking it in the checklist seeds the same on its own
  `{Bar total}` label's entries. Either is movable like any label. The
  value stays listed while mapped, so a Stack → Group toggle doesn't
  empty the Value row (each sub-band is then a bar of one layer). A
  LONE composed label's Placement selects read and write that label's
  own entry (which the renderer honors first), as its Label selection
  already does; the solver's reserve extends each row with its bar's
  total so a total beside a horizontal bar reserves its width.
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
  Countries-level geo charts add a Geography preset group with **Full
  country name** (see the geo-labels notes above); the option appears
  ONLY there.
  A mapped Value field is AUTHORITATIVE: on aggregating charts
  (bars / areas / pies / tiles), slices whose Value cells are all
  blank render NO label — they never fall back to the slice's
  measure. Sparse Value columns are the mechanism for labeling one
  arbitrary point (beyond first/last-per-series) without manual
  annotations, so a blank means "no label here". The measure
  fallback applies only when no Value field is mapped (or it equals
  the measure field), where labels show the slice's aggregated value.
- **Size** — the Default size input shows for a single label variable;
  the Min / Max pixel-range inputs appear only when a size source is
  mapped (a field, or the tree layouts' derived "Nesting depth"), since
  the range only takes effect then. Default size still applies to
  values the mapped source can't size (non-numeric). With **two or
  more label variables** the Default size input HIDES and the panel
  instead shows one block per variable (named by field, like the Color
  panel's slots) holding a single **Size** input: blank (the default)
  means the theme's default size — or the mapped size — and a value
  sets that variable's text to that many points regardless of either
  (`DataLabelsConfig.fieldSizes`). The stored layer-wide `fontSize` is
  untouched by the per-variable inputs and still backs blanks; it just
  isn't editable while several variables show. The solver's margin reserve
  measures with the largest configured per-variable size, the same
  conservatism it applies to a mapped size's Max.
- **Which labels** — All labels / First per series / Last per series /
  First and last per series. Endpoint selection is position-ranked along
  the chart's primary axis (rightmost = last for vertical charts,
  bottom-most for horizontal), not row-order-ranked; "series" is the hue
  field (areas) or connection field (line charts), with no mapped
  series treated as one implicit group. A one-point series counts as
  "last". Legacy saves with the old "Only show last label per series"
  toggle read as "Last per series".
  **Bars, stacked areas and multiple pies** hand the layer an explicit
  series and rank instead (`lib/labelSeries.ts`), chosen by an **Of
  each** select that sits under its label's "Which labels" and appears
  only when the marks are grouped or layered by a channel other than the
  x field (bars: a group / stack / overlay channel; areas and several
  pies: a stack channel; a single pie never shows it), and only while
  that label's choice is not "All labels" (its "Which labels" options
  then read "First" / "Last" / "First and last" so the two selects form
  one sentence):
  - **Series** (default) — the first / last category along the axis, per
    series. A series is the bar's stack + group channel values EXCLUDING
    any channel mapped to the category (x) field: hue on the x field
    colors each bar but forms no series, so a brightness-grouped chart
    colored by its own x labels every bar of the first category, not the
    first bar of every category. No distinguishing channel → one implicit
    group (single survivor).
  - **Group** (offered when a group-mode channel exists) — the first /
    last bar INSIDE each category band, in sub-band (legend) order; every
    layer of that bar.
  - **Stack** (offered when a stack- or overlay-mode channel exists;
    labeled **Pie** on pie charts) — the baseline / outermost layer of
    each physical bar, each area column's bottom / top layer, or each
    pie's first / last wedge from the arc start. A mirrored or diverging
    bar's two sides are separate stacks.
  On several pies, Series means the same wedge across the pies, so
  "First" labels every wedge of the first pie.
  On a LONE pie (a pie not along a category band — faceted single pies
  included) there are no pies to run across, so the select is hidden and
  the ends always run over each pie's wedges from the arc start; the
  choices read **First wedge / Last wedge / First and last wedge**. The
  renderer pins the scope there (`buildPieAnchors`), whatever is stored.
  A stored scope whose channel is no longer mapped reads as Series (the
  select shows Series; the stored value is left alone).
  With a single mapped Value there is one select, writing the layer-wide
  `DataLabelsConfig.labelPointsScope`. With **Multiple variables…** the
  scope is PER LABEL (`DataLabelsConfig.fieldLabelPointsScope`, keyed by
  the composed label's id), so one label can sit on the last bar of each
  STACK while another sits on the last bar of each SERIES; a label with
  no entry follows the layer-wide value. The anchors carry a series and
  rank per scope (`DataLabelAnchor.seriesByScope`), and each label's
  endpoints are classified under its own.
  With a single mapped Value there is one "Which labels" select. With
  **Multiple variables…** there is one select PER composed label (listed
  by its title under Label selection), stored in
  `DataLabelsConfig.fieldLabelPoints`; a label with no entry follows
  the layer-wide choice, so multi-field visuals saved before per-label
  selection keep their look.
  Each variable's choice places it in one or more label POPULATIONS —
  **all labels** (every anchor), **first** and **last** (the series ends;
  "First and last" = both) — and every population renders its own label
  at the anchors it applies to (`lib/dataLabelsSelection.ts`). An anchor
  can therefore carry several labels: on a stacked bar chart with the
  value set to "All labels" and the series name to "Last per series",
  every slice shows its value and the last bar's slices ALSO show the
  series name as a separate label — the direct-labeling recipe. (A
  one-point series takes the last label, plus the first label only when
  that population shows a variable the last one doesn't.)
  **Compose labels** (under Value, a group header after Label format)
  holds THE labels of a multi-variable mapping: one text box per label
  (`DataLabelsConfig.composedLabels` `[{id, template}]`). Checking a
  variable under Fields to include adds a box composing just it
  (`{A}`, keyed by the variable's name); unchecking removes the boxes
  composing just that variable. "+ Add another label" adds an empty
  box to type any arrangement of the checked variables into — `{A}
  ({B})` with literal text — and the × at a box's right removes it.
  The field checklist only decides which variables the boxes may
  name; the boxes decide what the labels are. Every box is one label
  at every anchor its own "Which labels" names, and every box gets
  its own sections — under Color, Size, Text, Box, Label
  selection (its Which labels) and Adjust position
  (alignment, angle, wrapping, overlap avoidance, bar placement, X /
  Y) — titled by its variables (`A`, `A + B`; "Label N" while it
  names none), all keyed by the label's id. A label styles AS ONE by
  default: its own color / size / font / background covers every piece;
  the rules under its Color compare against its variable's value (a
  single-variable label) or the chart's backing value (a combination).
  A lone single-variable label uses the layer-wide controls (its own
  entries, if any, win).
  **Split into individual variables** — a checkbox above the controls
  of any label naming TWO or more variables, in each of Color, Size
  and Text (`DataLabelsConfig.pieceSplits[id]`, one flag per
  section). Checked, that section expands into one block per variable
  in the label and writes the variable's own entry
  (`DataLabelsConfig.pieces[id][field]` — `color` / `colorRules` /
  `size` / `font`, keyed by the label's id and then the variable's name,
  never a joined key) laid over the LABEL's `fieldColors` /
  `fieldColorRules` / `fieldSizes` / `fieldFonts` entry — so a piece
  that only sets a weight keeps the label's family. That is the
  recipe for a bold series name beside an unbolded value, or an
  all-black label whose value alone turns green when positive and red
  when negative (the variable's own color rules, compared against ITS
  value). The label still POSITIONS as one — placement, alignment and
  Which labels stay per label — and the other sections (Text
  background, Adjust position) stay per label too. Unchecking restores
  the uniform look without discarding the per-variable entries; a
  section that isn't split ignores them entirely. A lone combined label
  gets the same per-label block so its checkbox has somewhere to sit.
  An empty box draws nothing; an empty list draws no labels. So
  "A + B, and C by itself" is the boxes `{A} ({B})` and `{C}`, and
  "the value on the first point, the value and category on the last"
  is `{value}` (Which labels: First) and `{value} {category}` (Last).
  Visuals saved before composed labels derive their list from the
  legacy state (`normalizeComposedLabels`): variables separate
  (`combineVariables === false`) → one label per field keyed by its
  name; combined → one label per legacy population (ids `arranged` /
  `arranged-first` / `arranged-last`) with its Label text and
  series-end overrides, so the chart looks the same until the list is
  edited, which persists it. Several
  labels position PER LABEL: under Position and alignment the
  Align control and the X / Y nudges become one row per variable
  (each showing its effective value — its own, else the layer's — and
  writing `DataLabelsConfig.fieldAlignments` / `fieldOffsets`), so a
  value can sit centered in its bar while the category hangs left-aligned
  off the end; the population split (All / First / Last rows) and the
  endpoint override blocks don't apply to separate labels, while position
  rules still replace a matching label's base offsets. Their per-variable
  Size / Text / Box / Color apply per label. The
  solver reserve then measures each population's widest single variable
  at that variable's alignment and offset.
  On a bar + marks combo (§3.3) each label — every separate label's
  subsection, or the primary label's Position and alignment block —
  leads with **Show on**: *Bars* or *Line* (*Points* when no
  Connection is mapped). A label with no stored choice follows the
  variables it shows: one naming a marks variable (the position
  variable drawn as marks, the Connection field, the Line / Point fill
  slot fields) sits on the line, one label per row AT ITS POINT (the
  chart's x and the position variable drawn as marks — never the Data
  Labels X / Y mapping, which the bars don't read either) and ranked
  per Connection series for First / Last (no "Of each": the bar scopes
  don't apply to it); anything else sits on the bars with the bar
  placements. A pick is stored per label key in
  `DataLabelsConfig.fieldLayers` (the single-field label keys by its
  value field) and lights the subsection dot. A label on the line has
  no bar Placement group, and a stored bar side neither locks its
  alignment nor counts as a change.
  Two or more populations present = a **split** selection, and only
  then do the controls split, one block per present population, living
  where those controls normally live rather than in this subsection:
  - Under **Value** (multi-field mode, variables combined), "Label text"
    becomes one box per population: **Label text** (the all-labels
    arrangement), **First label text**, **Last label text**. The all-labels box pre-fills with
    its own variables joined (and tracks the checklist / selects until
    hand-edited); an empty series-end box uses the placeholder — its own
    variables joined (e.g. `{series}` for a last-only series name), or,
    when no all-labels population exists and the shared text covers the
    same variables, the shared arrangement (the legacy first-and-last
    inheritance: `{value}` on firsts, `{value} {series}` on lasts). There
    is still exactly ONE "Label format" section — per-field formats are
    shared across populations.
  - Under **Position and alignment**, the Align control
    and the Adjust-position X/Y inputs each become one row / pair per
    population ("All labels" writes the base values; "First label" /
    "Last label" write the endpoint overrides). Wrap text stays a single
    shared toggle.
  With a single population nothing splits, whichever population it is:
  the layer-wide template / offset / alignment drive the one rendered
  label set, and any endpoint overrides left over from a split session
  are ignored.
  Multi-field templates compose on the row-based renderers (scatter /
  lines) AND on bar charts: each bar anchor carries a per-slice record
  (category, group values, measure, and every checked variable
  aggregated over the slice's rows — numeric sum, else first non-empty),
  so templates, per-field formats, and per-variable colors all apply to
  bar labels. Area / pie / tile labels are still pre-formatted single
  values and ignore multi-field templates.
- **Avoid overlapping labels** (under Position and alignment,
  right after Wrap text — it moves labels, so it sits with the other
  placement controls rather than with the selection of WHICH labels
  render) — colliding labels spread apart
  vertically (up or down), each staying as close to its own anchor as
  the minimum gaps allow, preserving vertical order. Stacked end-of-line
  labels are solved exactly (least total displacement); scattered label
  fields fall back to a best-effort downward sweep and may still collide
  when densely packed. GEO modes instead spread colliding labels in ANY
  direction: each moved label takes the closest free spot on rings
  around its own position (verticals, then horizontals, then diagonals,
  at one-line-height steps), so a pile of map labels fans out around
  its regions instead of forming a downward column — which also keeps
  leader lines short and pointing every which way rather than all
  upward. Displaced labels additionally PREFER open map space — ocean
  and regions carrying no data (per the map's own region join) — over
  covering data-carrying regions: within each ring an open-space
  candidate wins, and the search looks up to two rings past the first
  merely-free spot for an open one before settling, so labels near a
  coast or an empty neighbor drift there without ever flying far just
  to reach water. Non-colliding labels never move; a label with no
  free spot within ~12 rings stays put (best-effort, as elsewhere).
- **Apply to all facets** (faceted charts only; under Label selection,
  after Which labels and Of each) — checked by default: every panel
  draws its labels. Unchecking lists the chart's facet panels as
  checkboxes (all ticked at first) so the user keeps labels on just the
  panels they tick; an unticked panel renders no labels at all. It is
  PER LABEL in the same way: a single mapped Value writes the layer-wide
  `DataLabelsConfig.facetKeys`, while each composed label gets its own
  checkbox list (`DataLabelsConfig.fieldFacetKeys`, keyed by the label's
  id) so the value can label every panel while the category labels one.
  A label with no entry inherits `facetKeys` — so a visual that scoped
  the whole layer before composed labels keeps its scope — and an entry
  of "all facets" overrides a layer-wide list rather than falling back
  to it. It is also the one Label-selection control a map or a sunburst
  keeps (they have no series ends to select or scope; flow diagrams add
  their own by-direction node selection). When none of its controls
  apply — an unfaceted sunburst — the Label selection subsection is
  skipped entirely rather than shown empty. The list uses the
  same panel references the annotations' "Apply to all facets" picker
  stores (`FacetPanelRef`: the facet value in wrap mode, a `{ row, col }`
  pair in grid mode), labeled as the rendered titles are (facet value,
  row · column, the compact panel title when empty panels are hidden).
  The selection is ignored
  — every label draws — when the chart stops being faceted, so a stored
  selection never blanks an unfaceted chart.
- Bar charts get a **Placement** group (a hairline-topped group header,
  styled like Adjust position) holding two dropdowns, **Vertical** and
  **Horizontal**, named by the screen direction they move labels in —
  so which one is the measure-axis placement swaps with orientation:
  on vertical bars Vertical is the measure-axis placement and
  Horizontal the category-axis side; on horizontal bars the reverse.
- **Measure-axis placement** (bars only; "Vertical" on vertical bars)
  — center (default) / inside, near base / inside, near end / outside
  the end of the bar, along each slice's measure extent.
- With separate variables (Combine variables unchecked) the whole
  Position and alignment section becomes one collapsible
  subsection PER VARIABLE (titled by field, like the Color / Size /
  Text blocks), each holding that variable's Align,
  Angle, Wrap text (+ Characters), Avoid overlapping labels, the bar
  Placement pair, and the Adjust position X / Y — effective values
  shown (the variable's own entry, else the layer's), writes to the
  variable's entry (`fieldAlignments`, `fieldLayouts` for angle / wrap
  / overlap, `fieldBarPlacements`, `fieldOffsets`). The layer-wide
  versions of those controls hide in this mode (they still back any
  blank). Position rules go in the subsection too — they position ONE
  label, so each variable's block ends with its own "+ Add rule"
  (`fieldPositionRules`), and there are as many links as there are
  label variables. The pie / sunburst nudges and the area Layer
  position stay layer-wide. Overlap avoidance is then per variable: the
  labels of variables with it on move out of EACH OTHER's way, and a
  variable with it off never moves. So e.g. the category name sits
  beside the bar while the value stays centered inside it. A variable
  beside a vertical bar loses only its own Align row.
- **Side placement** (bars only; "Horizontal" on vertical bars) —
  which side of the bar labels sit on,
  across the category axis: centered on the bar (default), or beside
  it — left / right of a vertical bar, above / below a horizontal one.
  Beside the bar, the anchor is the bar's EDGE plus a 4px pad, not its
  center, so the Adjust-position nudges measure from the edge and a
  label placed beside a bar keeps that distance however wide the bar
  renders (nudging from the center, a label set beside a wide bar slid
  back over it when the figure narrowed and the bar thinned). On a
  vertical bar the side also fixes the text alignment — the label
  hangs away from the bar (left of the bar ends at the anchor, right
  of it starts there) — and the Align controls hide while a side
  is set, series-end and per-variable alignments included. On a
  horizontal bar the side picks which edge of the label block meets
  the anchor (above → block bottom, below → block top) and Align
  stays the user's. The layout reserve for vertical bars follows the
  forced alignment and the pad so a label beside the last bar stays
  in the viewport.
- **Layer position** (areas only) — the same four placements along each
  layer's measure extent (its base — the zero baseline, or the layer
  below in a stacked area — to its top edge), plus **On the top edge**
  (default): the label sits on the line, which is how areas labeled
  before the control existed, so saved visuals don't move. On a
  vertical area the placement also picks which edge of the label
  block meets the anchor, so a tall (wrapped) label stays on the side
  its placement names: inside, near end hangs DOWN from just under the
  top edge (block top on the anchor); inside, near base and outside
  the top edge stand UP from theirs (block bottom on the anchor); on
  the top edge and center stay vertically centered. The 4px pad
  applies on top. Horizontal areas keep the label centered and leave
  its horizontal edge to the Align control.
- **Position rules** (Adjust position → "+ Add rule") — conditional
  X/Y offsets, evaluated against the label's backing value with the
  same condition grammar and first-match-wins walk as the text color
  rules. A matching label uses the rule's X/Y INSTEAD of the base
  Adjust-position values (they replace, never stack); non-matching
  labels keep the base offsets. The motivating case is a diverging bar
  chart labeled outside the bar ends: base Y nudges positive labels up,
  a `< 0` rule nudges negative labels down. New rules seed with the
  current base offsets (a no-op until edited). In first-and-last mode
  a matching rule wins over the First / Last label's own X/Y (the rule
  is the exception the user added); a label no rule matches takes its
  endpoint's X/Y, and an unset endpoint offset inherits the base.
  Rules belong to a LABEL, not to the layer: the link sits inside the
  subsection of the label it rules. With the variables combined that's
  the one arranged label and the rules are layer-wide
  (`positionRules`); with them separate each variable — and each
  combination — carries its own list (`fieldPositionRules[key]`) in
  its own subsection, replacing that variable's own base offsets
  (`fieldOffsets[key]`, else the layer's), which is also what a fresh
  rule seeds from. A variable's rules compare against ITS value in the
  row, the same convention the per-variable text color rules follow;
  a combination arranges several variables, so it has no single value
  and falls back to the layer's backing value.
- **Text color rules** — conditional overrides (e.g., white text on
  dark heatmap cells, black on light). They sit below the color
  swatches, separated by a hairline, with no header of their own: until
  a rule exists the whole feature is the right-aligned "+ Add text
  color rule" link, which names what it adds. The swatches above are
  the primary control, the rules the exception path. The link stays
  below the rows, so each click adds another rule, and every row can be
  removed; the condition grammar note appears once a rule does. Same
  shape as the position rules above.
- **`{Variable}` conditions** (every conditional-rule list: text color,
  position, and the Color menu's Fill / Outline / Line color rules —
  §4.1 "Color rules"). A condition
  may open with a variable in braces — `{Region} == West`,
  `{Profit} < 0` — and then tests THAT variable in the mark's dataset
  rows instead of the implicit value (the label's backing value, or
  the outline variable's). Same operators and comparison semantics
  as the implicit form; a blank cell never passes. A mark built from
  several rows (a bar slice, an area layer, a pie wedge, a heatmap
  cell, a flow node) passes only when EVERY one of its rows does, so
  `{Region} == West` colors a bar only when the whole bar is West
  rows — the rule never guesses from one row of a mixed bar. A point,
  map region, or row-backed hierarchy node tests its one row; a mark
  with no rows (a legend swatch, an implicit hierarchy container)
  never fires a `{Variable}` rule. Renaming a variable rewrites its
  `{token}` in every rule. The condition box fills its row and wraps,
  growing to fit a long rule (Enter is ignored; a condition is one
  line).
- **Per-variable colors** (multi-field labels with 2+ variables) — the
  Color panel replaces the single base color stack with one color slot
  per label variable. Each variable's block also carries its own **Text
  color rules** (`DataLabelsConfig.fieldColorRules`), the same condition
  grammar as the layer-wide rules but compared against THAT variable's
  own value in the row (the layer-wide rules compare against the
  label's primary value); a matching rule wins over the variable's
  color slot, whose color is the "else". An UNCONFIGURED slot inherits the label's base
  color chain — so with a field mapped on the layer's Color channel,
  its "Vary by" dropdown reads "Main Color mapping (field)" and the
  variable's segments follow that mapping; picking it again after a
  change clears the stored slot back to inheriting. Without a Color
  mapping the default reads "— none —" (the single color; behaviorally
  identical there). "— none —" / a mapped field store an explicit per-slot
  config as before. Wrap text applies to colored labels too: the
  colored pieces line-break at the same points the plain label would
  (`wrapSegments` splits a piece that straddles a break, keeping its
  fill), with each line's start position derived from the label's
  alignment.
- **Box** — the box drawn behind each label. The **Show text
  background** toggle gates every row: **Background** (color; empty
  inherits the visualization's background), **Corner radius**,
  **Horizontal padding**, **Vertical padding**, then **Border**, a
  toggle that IS the border thickness (`textBackgroundBorderWidth`;
  off = 0 / unset, the historical unbordered box; on restores the last
  non-zero thickness, else 1px) with **Border color**
  (`textBackgroundBorderColor`, default neutral `#999999`) and
  **Border thickness** (px, step 0.5) shown only while it is on. The
  renderer strokes the background rect with them; adjacent pieces
  share one rect only when their borders match too.
- **Per-variable text properties and backgrounds** (multi-field labels
  with 2+ variables) — exactly like the Color panel: the Text and Box
  subsections REPLACE their layer-wide controls with
  one collapsible block per variable, named by field. Each block shows
  the variable's effective values (its own entry, else the layer-wide
  value the single-variable panel edits) and writes only that variable's
  entry; a control's reset link drops it back to the layer value:
  - Text: **Family**, **Weight**, and the **Style** I / U
    toggles, applying to that variable's text alone
    (`DataLabelsConfig.fieldFonts`, sparse per key).
  - Box: the **Show text background** toggle, then Background color,
    Corner radius, the two paddings, and the Border rows, applying
    behind that variable's text alone
    (`DataLabelsConfig.fieldBackgrounds`) — so a label can carry a boxed
    category beside an unboxed value. At render time adjacent
    pieces with the SAME effective background share one rect (so a
    label whose variables all follow the layer keeps the one
    whole-label box it always had — literal text between variables
    follows the layer too), and a run with a different background, or
    none, gets its own rect or a gap; wrapped lines are boxed per line.
  A variable's size / font / background / color all resolve per piece:
  the label's `<text>` keeps the layer-wide styling and each piece's
  `<tspan>` carries only what differs, so a label whose variables all
  inherit renders exactly as before. Mixed-size pieces share one
  baseline; line steps come from the label's own size. The overlap and
  edge-alignment boxes measure such a label at its largest piece size
  (conservative, like the width heuristic). These apply wherever
  multi-field labels compose (row-based renderers and bar anchors); the
  pre-formatted area / pie / tile / geo labels ignore them, as they do
  per-variable colors.

When data labels are mapped — position field(s) AND a value, the same
gate that renders them; a chart drawing no labels reserves nothing —
the solver reserves extra right-margin
space if the rightmost label would extend past the plot edge. The
amount is estimated from the longest formatted value × font size ×
0.55 × alignment fraction (full width for left-anchored, half for
center, none for right-anchored), minus the existing default right
margin. Same heuristic the legend uses for its dynamic width. With an
endpoint selection active, the reserve is computed per active endpoint
profile (its template / offset / alignment) and the sides take the max
— so a wide `{value} {series}` last-label template gets the right-edge
room it actually needs. Position rules contribute one extra profile per
rule (its X offset over the base template / alignment), so a rule that
pushes matching labels past an edge still gets margin — a per-variable
rule over that variable's own profile, so its template and bar side
still drive the width.

---

## 7. Labels (titles)

**Font sizes are points.** Every font-size number in the app — titles,
tick labels, data labels, legends, captions, annotations, the text
channel — is a point size, matching what Office/print tools mean by
"size 12". Rendering converts once at the resolution boundary
(`lib/fontUnit.ts`, 1pt = 4/3px per the CSS definition; stored configs
are never converted — the numbers' unit is pt by definition). Combined
with the physical export sizing + DPI stamping (§14, "Export & embed"),
a chart exported at 6×3in with size-12 axis labels drops into a
presentation with text exactly matching 12pt body text. Layout and
measurement code stays in px; the pt→px conversion happens inside
`resolveTitleFont` / `resolveTextFont` / `resolveLabelSize` (and
`resolveTickFontSizePx` for per-axis overrides), so anything
downstream of those resolvers never sees pt.

The Labels panel covers chart title, subtitle, x-axis title, y-axis
title, and facet/legend titles. Each title has:

- A text field. For the x- and y-axis titles the box SHOWS the chart's
  automatic title as its real value (not a placeholder) while no title
  is stored — the mapped variable's name (the Length variable on a
  bar's measure axis, "Count" / "Density" on a histogram's, the R
  variable on a radar), following a re-mapped variable live. The first
  keystroke stores the box's text as the title. Clearing the box stores
  an empty title (no title drawn; it does not snap back). A
  right-aligned **Reset to variable name** link, shown only while a
  title is stored, returns to the automatic text. Hiding a title
  outright is the Titles shown box's job (below).
- An alignment control (Left / Center / Right glyph buttons).
- Font override (collapsed disclosure with family / size / color).
- Position offset (X / Y in px) — see §6.4 for the auto-grow rule and
  the Y sign convention (positive = up).
- Y-axis title only: a "Read horizontally" toggle that un-rotates the
  title from -90°.
- On a chart that draws no x / y axis — flow diagrams, the tree layouts,
  maps — that axis's title row is **greyed out, not hidden** (text box and
  styling disclosure disabled; a note says so when both are). Stored
  values are left alone and don't light the subsection's dot. Polar
  charts keep both live: the pie bands and the radar's R axis draw from
  them.
- Chart title only: an **Add prefix** checkbox (between the Style row
  and Adjust position). Checking it reveals a **Prefix** text box and a
  font editor (family / color / size / weight / style — no alignment)
  for the prefix alone, so a house style like "**FIGURE 5.** Distribution
  of …" is one title with a bold run in front. Unset prefix font fields
  inherit the theme's **Title prefix** defaults (Settings → Themes →
  Text: family / color / size / weight / style, each falling back to the
  Main title font), and those in turn inherit the title's effective
  font. The prefix is drawn before the
  title's first line, separated by one space, in the SAME text run, so
  the title's alignment and position offset place prefix + title as a
  unit: a left-aligned title nudged 10 px starts at that same x whether
  or not it has a prefix (the title text itself shifts right by the
  prefix's width). Unchecking hides the prefix but keeps the typed text
  and font for a later re-check; a checked prefix lights the Title row's
  changed dot. A prefix with an empty title still renders (the title
  band exists for typed text OR an active prefix).

**Multi-line titles grow up.** Shift+Enter breaks a title into lines.
The chart title, subtitle and facet panel titles keep their BOTTOM
line where a single line would sit — the same distance from the
subtitle / plot / panel below it — and stack the earlier lines above,
reserving one line of room per extra line at the top (the plot gives
up that room in Fit mode; the canvas grows in Scroll mode). Legend
titles follow the same rule: a right / left legend lifts by the extra
lines so its entries and the title's bottom line stay put (a bottom
legend already grows upward; a top legend has nothing above it to grow
into, and an inside legend is pinned by its coordinates, so those keep
flowing down). X- and y-axis titles are unchanged. See LAYOUT.md §7.

**Long chart titles stay in view.** A chart title or subtitle longer
than the plot is not cut off at the plot's edge. Beside a left / right
legend it runs on over the blank band above the legend — the legend
column is title room — and when it would still leave the figure it
slides just far enough to stay in view: a centered title wider than the
plot shifts toward the legend's side, a left-aligned one slides left
only when it would run off the right, and one wider than the whole
figure keeps its aligned edge in view. Alignment is untouched whenever
the text fits where it is, and a Shift+Enter line break is still the
way to make a long title wrap. Exports carry the title the same way.
See LAYOUT.md §7.

The alignment control positions each title against the PANEL's plot
span, never the canvas — so left-aligning parks the text at the plot's
edge, not the image's. For the y-axis title its meaning depends on the
orientation, because the two orientations give the words different
directions to run in:

- **Rotated (default)** — the title reads bottom-to-top between the
  two ends of the axis, so alignment picks which end it reads FROM:
  Left starts the title at the panel floor, Right finishes it at the
  panel ceiling, Center centers it on the panel.
- **Read horizontally** — the title reads left-to-right in a block
  that always sits centered on the axis, so alignment does what align
  buttons do to prose: it aligns the WRAPPED LINES against each other
  (Left flush-left, Center centered, Right flush-right). The block's
  box doesn't move — its right edge stays against the tick labels, in
  the left chrome reserved for it, and only the anchor slides inside
  that box. Parking an upright title at the top or bottom of the axis
  is the position offset's job (below), not alignment's.

The panel opens with a **Titles shown** subsection: one checkbox per
title the chart can draw — Title, Subtitle, X-axis title, Y-axis title
(each axis only when the chart has that axis), the facet titles when
faceted, and one per legend-title row (a shared-field legend group is
one checkbox). Facet boxes mirror the facet subsections: a wrap or
single-axis facet has one **Facet titles** box; a both-axes grid has
**Facet titles (column)** and **(row)** boxes, plus **(panel)** when
Hide empty panels is on. Each layout reads only its own boxes, so a
box unchecked in one shape never hides titles in the other. A hidden
facet strip or panel band reserves no space (scale sharing is
unaffected). All are checked by
default. Unchecking a title stops the chart drawing it AND reserving
space for it (the layout treats it exactly like a blank title — no
title band, no axis-title gap, no legend header), and removes that
title's editor row from the subsections below; a subsection whose rows
are all unchecked disappears. A hidden chart title takes its prefix
with it. The typed text, font, alignment and offsets are kept, so
re-checking restores the title as it was. Stored as a sparse
`labels.hiddenTitles` map keyed by title slot (absent = shown);
renderers read titles through `visibleLabels` / `shownLegendTitle`.
Hiding a legend title blanks only its header: same-field legends that
were split apart by distinct titles stay split. The subsection's
changed dot lights while any offered title is unchecked, and styling
on a hidden title doesn't dot its own subsection.

After it come four collapsed-by-default subsections:
**Primary titles** (the Shift+Enter hint, Title, Subtitle), **Axis
titles** (X-axis, Y-axis), **Facet titles** (present only when a
facet channel is mapped; a grid split shows the Column and Row title
rows plus — when Hide empty panels is on — the textless **Panel
titles** row, see §4.5a; otherwise the single Facet title row), and
**Legend titles** (present only when legend channels are active;
one row per legend, a shared-field group counting as one, with a
hairline divider between rows when there is more than one).
Each subsection header carries the standard changed dot (§4.6) when
any row inside deviates in STYLING — a font override, a non-center
alignment, a non-zero orientation, a position offset, or the y-axis
"Read horizontally" toggle. Typed title TEXT is content, not styling,
and never lights a dot.

Facet **row** titles (the left-strip labels — the grid-split Row
titles row, and the single Facet title row when only the facet-row
axis is mapped) additionally expose a **Vertical align** control
(top / middle / bottom, default middle) alongside their **Align**
control, which is relabeled **Horizontal align** there. It lines
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

Position options: left, right, top, bottom, inside (labeled "Custom
coordinates" in the picker; the outside options are bare "Left",
"Right", "Top", "Bottom"). Inside placement
uses two number inputs labeled "X" and "Y" (0–1, relative to plot
rect corners).

**Legend width** (its own group between Position and Orientation)
fixes the legend box's width. The number input takes px, in, or cm
(a unit picker beside it; inches and cm convert at the standard
96 px/inch, and the stored value is always pixels — the unit only
changes what the field shows). Blank = auto, the content-sized width
the legend has always had; the field's placeholder shows that
rendered auto width, and the first spinner click or arrow key steps
from it rather than from 0 (focusing alone changes nothing). Clearing
the field, or the reset link, returns to auto. A fixed width applies in every
position and overrides the auto estimate and the viewport caps that
otherwise bound multi-column legends. That auto width budgets from
MEASURED text (canvas `measureText` of every label and title at the
legend's resolved fonts, re-planned once webfonts finish loading) rather
than a per-character estimate, so a wide face never clips a title's
last letter. When the box becomes too
narrow for its text, labels WRAP onto extra lines — stacked entries
stop truncating with an ellipsis, and horizontal entries shrink to
fit the row instead of pushing it wider. (The "legends grow rather
than wrap" rule describes AUTO sizing; an explicit width is the user
asking for wrapping.) A wrapped entry keeps its swatch on the label's
FIRST line — centered on that line, whatever the swatch's height — not
floating at the vertical middle of the whole wrapped block; single-line
entries look exactly as they always have. Image export reproduces each
wrapped line and the swatch placement. A section TITLE that wraps
(Shift+Enter, or a fixed width narrower than the text) grows UP: a
right / left legend lifts by the extra lines so the title's bottom line
and the entries stay where a single-line title puts them (§7).

**Legend height** (its own group right after Legend width) fixes the
legend box's height, with the same px / in / cm picker, px-truth storage,
and auto placeholder (the legend's natural height at the default 4 px
between entry rows; the first step starts from it). The extra or missing
height goes into the gap between STACKED entry rows — every vertical
entry list, including entries wrapped into columns — so a smaller height
pulls the entries closer together and a larger one spreads them out.
Section titles, the title-to-entries gap and the gap between sections
keep their spacing. The gap is solved by measurement (content height is
linear in the gap, so the legend measures it at two gaps and solves) and
may go negative, but never past 30% of the shortest row, so labels can't
pile onto one another; past that floor the content overflows the box.
Horizontal entries and gradient bars have no row gaps to adjust, so there
the setting only sizes the box. Blank / reset returns to auto.

Both inputs' spinners and arrow keys stop where the legend stops changing.
Width bottoms out at the narrowest box in which every label still wraps
only between words (the widest word or title, plus swatch and padding) and
nothing spills out of the box; height bottoms out at the rows' tightest
spacing (the natural height when there are no row gaps). The legend
measures both after each render while the Legend panel is open. Typing
a smaller number is still allowed.

**Box** (its own subsection right after Legend properties) styles the
legend box: **Background** (Transparent / Theme default / Custom with
an inline swatch), then the **Border** toggle (`showBorder`; a 1px
solid border), and — only while Border is on, since the radius rounds
the border — **Corner radius** and **Border color**. Its settings dot
is the `box` group of `explainLegendCustomization`.

**Orientation and Legend columns are independent controls, and each
owns exactly one axis of the layout.** Orientation (a Stacked /
Horizontal segmented toggle) governs how the ENTRIES flow inside a single legend
section. "Legend columns" (1–6) governs how the SECTIONS themselves
are arranged, and nothing else does: `1` — the default — always means
one column, so several legends stack whatever the position or
orientation; `N > 1` packs the sections into N content-hugging
columns, balanced by count, separated by the "Column gap" (px, may be
negative, so columns can be pulled together or overlapped). Every
combination is therefore expressible — notably two horizontal legends
stacked in one column, and any column count at the top / bottom
positions.

The one exception, because it can't be otherwise: when a SINGLE
legend is mapped, columns > 1 wraps that legend's entry ROWS across
the columns instead of packing sections, which requires stacked
entries — so the orientation reads as Stacked there regardless. A
quantitative gradient / ramp section is a bar rather than a list, so
it has no rows to wrap and opts out entirely.

**Multiple legends mean the swatches line up with each other
vertically.** Whenever ≥2 sections render with stacked entries, every
section's entry block pins to the legend's left edge (instead of
following its title alignment, which continues to govern the title
itself), and every entry's swatch graphic centers inside one shared
fixed-width column — the widest swatch across ALL the sections,
whatever mix of swatch kinds they draw (color rectangles, shape
glyphs, size circles, length segments, pattern tiles). Swatches share
one vertical axis and labels start at one shared x, within a column
and across packed columns alike. A single legend keeps the historical
title-relative alignment and content-hugging swatches; horizontal
orientation flows entries in rows, where a shared vertical swatch
column has no meaning.

A **left-aligned legend title lines up with the entry labels** (the
text beside each swatch), not with the swatch column's left edge —
the title indents by the measured label-start x of the section's
first entry, whatever the swatch kind, size, or shared swatch-column
width. Sections with no swatch column to the left of their labels
(gradient bars, label-under-swatch horizontal groups) keep the title
at the section's left edge. Center and right title alignment are
unchanged.

Channels mapped to the **same field** combine into one legend section
with composed swatches (color + shape + pattern + opacity). The
combined-section title defaults to the field name; users can
override per-channel. Combining is a **toggle**, not a law: "Combine
legends with same variables" (`combineSameVariable` on the legend
config, default on) sits under the "Legends shown" group and appears
only when some field actually IS shared by more than one channel.
Turning it off skips the field-level merge entirely — each channel
emits its own section, as if it were the only encoding on that field —
so the "leading channel" rules below (the Swatches groups, say) apply
only while the toggle is on.

**Hover to highlight.** Hovering a categorical legend entry publishes
`{ field, value }` to `hoveredLegendEntryAtom`; the plot renderers read
it through `useLegendHighlight` and repaint the matching marks, while
the other entries in the legend fade in step with the marks so the
legend and chart read as one gesture. What "highlight" means is the
Hover subsection's business (§10's tooltip config, shared with direct
mark hover): non-matching marks fade by default (`hoverFade`, dropping
to ~15% opacity), and matched marks can additionally be recolored
(`hoverRecolor`) or outlined (`hoverOutline`), both opt-in. Recolor
color, Outline color, Outline width and Fade amount each show a reset
link back to their default while changed. The whole
behavior is gated on the "Show hover" master toggle AND its
legend-highlight sub-option (`hoverEnabled` + `legendHighlight`, both
default on): with either off, entries never publish a hovered value
and the plots stay un-dimmed. Wired up in Scatter, Bar, Area, Pie,
Radar, the hierarchy layouts, the geographic renderers, and the flow
diagrams.

On the MAPS the marks match by row value exactly as elsewhere: a
choropleth's regions, a bubble map's bubbles plus its region
choropleth basemap, and a dot map's dots. Two map-specific rules: a
region drawn in the no-data paint — absent from the dataset, or a
matched row whose measure is blank — belongs to no category, so it
fades with the rest and NEVER lights up, even when its row carries the
hovered value; and the purely geographic backdrops (the dot map's
plain basemap, the world-countries backdrop) are context rather than
marks, so they don't dim at all. Quantitative color legends are
gradients, which publish no entries, so a measure-colored map only
responds to hover through its categorical channels.

On the FLOW diagrams the legend is the node union, so a hovered entry
names a NODE: that node's arc / rect takes the usual emphasis, and
every flow TOUCHING it — as source OR target — stays fully visible
while unrelated nodes and flows fade. Links keep their own paint (they
take their source node's color, and repainting a wide translucent flow
in the highlight color would swamp the node it belongs to), so recolor
/ outline apply to the node marks only.

Direct mark hover publishes the same way on both families: hovering a
map mark highlights its category when a CATEGORICAL color is mapped
(that is exactly when the legend has entries to correspond with), and
hovering a flow node — or a link, which reports its source node —
highlights that node's series.

Per-channel visibility lives in the "Legends shown" toggles. A channel
counts as mapped when it has a field OR a derived source that renders a
legend (histogram Count/Density, the tree modes' Top-level group /
Nesting depth on Fill color). Every
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

**Legend text** subsection: a per-visual font for the ENTRY labels (the
text beside each swatch) — Family, Color, Size, Weight, and the italic /
underline Style toggles, via the same font editor the Labels panel's
title rows use, plus an **Align** row above it. Every field is sparse:
blank follows the theme's "Legend text" defaults (`baseFont.text.legend*`,
themselves falling back to the shared body-text font), and each control
names or previews what it inherits — the family and weight dropdowns in
their leading "(…)" entry, Size as the placeholder, Color in the swatch.
This is the per-visual layer on top of the theme; the section TITLES above
the entries are styled separately, in the Labels panel's "Legend titles".
The subsection's first item is a right-aligned **Edit legend titles →**
text link that jumps there: it opens the Titles section and its Legend
titles subsection and scrolls it into view (if that subsection isn't
rendered, it opens Titles and scrolls to the section). The jump state is
transient, never saved.

**Align** positions each label within the entry column, which is as wide
as the longest entry in the section (or the fixed Legend width, when one
is set) — so with equal-length labels there is nothing to move. Left is
the historical layout, where the label hugs its swatch, and picking it
clears the setting rather than storing it. Center / right make each
label's cell grow to fill the rest of its row first
(`.vc-legend-text-align`), so the alignment has somewhere to work; the
gradient bar's break labels are NOT affected — they keep their own
**Align break labels** row, directly below Align in the same Legend
text subsection (shown only while a quantitative hue legend is visible
and its style is "Show gradient bar").

The "Gradient legend style" toggle (quantitative hue only) switches
between a gradient bar and sampled swatches; both honor the legend's
orientation setting (horizontal swatches lay out in one no-wrap row).

When "Show gradient bar" is selected, the subsection grows bar-styling
controls, in three hairline-divided groups with no headers — the bar
rows, the border rows, then the tick rows:

- **Bar length** (px, clear-to-auto) — the bar's height when the
  legend is stacked, its width when horizontal. Auto keeps the
  historical sizing (8rem minimum height vertical; full legend width
  horizontal).
- **Bar thickness** (px, default 12) — the bar's width when stacked,
  its height when horizontal; the cross-axis of Bar length.
- **Corner radius** (px, default 2) — 0 gives square corners.
- **Border thickness** (px, default 0 = no border) — above 0 draws a
  solid stroke around the bar, outside the gradient (the bar grows by
  the border; the ramp's 0% / 100% ends, and the ticks / labels keyed
  to them, don't move). **Border color** (default the same neutral
  stone gray as ticks) appears only once the border is on.
- **Tick length** (px, default 0 = no ticks) — above 0 draws a tick
  mark at each break stop, extending outward from the bar toward its
  labels (below a horizontal bar, right of a vertical one). **Tick
  thickness** (default 1px) and **Tick color** (default a neutral
  stone gray) appear only once ticks are on.

Quantitative legend break labels take the shared **Label format**
preset dropdown + custom d3-format spec (Literal prints each break
as-is, `literal%` as-is plus "%" — see the axis Tick label format for
the text-around-the-value forms). **Auto** (empty spec) follows the break set: when every break
is a whole number (0 / 50 / 100, or a user-typed 1, 2, 3) labels print
as whole numbers with no trailing ".00"; once any break carries a
fraction every label prints two decimals so the column stays aligned
(0.00 / 0.50 / 1.00). Temporal breaks print as locale dates.

The Legend text subsection additionally offers **Align break
labels** (left / center / right, via the shared AlignmentControl),
directly below Align, whenever a gradient bar is active: under a horizontal bar each break
label anchors its left edge / center / right edge at its stop; beside
a vertical bar the labels align within the label column. The default
(unset) is the historical look — centered under a horizontal bar,
left beside a vertical one.

**Swatches** subsection: every legend section that renders discrete
swatches gets a full control group — glyph picker (rectangle / line
segment / the shape palette), Swatch size, Outline color, and Outline
width. Each starts from the theme's legend-swatch defaults (Settings →
Themes → Legend → "Legend swatches": the rectangle, 5px, no outline,
automatic outline color out of the box); the picker names the theme's
glyph "(theme default)". A per-visual value is stored only when it
differs from the theme — picking the theme's own value clears the
override, so the subsection's dot goes out and a later theme edit flows
through again. One group appears per rendered section, keyed by the
channel that leads it: Color, Outline color, Saturation, Brightness,
Pattern, Opacity, and Rug. Channels sharing a field collapse into one
combined legend section, so only the leading channel's group shows (a
pattern mapped to hue's field is covered by the Color group; mapped to
its own field, it gets a Pattern group). Saturation / brightness never
have standalone legends — their group appears only when they lead a
shared-field section that has no color channel. Sections that render
per-category shape glyphs (a shape encoding on the same field) or a
continuous gradient bar / ramp offer no group; a quantitative color
section that other group channels share (and so falls back to
composed swatches even in "bar" style) does.

**Swatch size** (px, radius-like; the theme's default, 5 out of the
box; a reset link returns to it whenever the value differs) applies to every swatch
form: it's the symbol radius for a chosen glyph and proportionally
scales the default rectangle (including pattern-filled rectangles), so
the input is always live — not glyph-only.

**Swatch color** row: the Opacity / Saturation / Brightness groups
additionally host the standalone-swatch color (their swatches have no
hue scale to inherit from). It edits the same shared
`auxLegendSwatchColor` the Length / Angle / Size subsection uses, and
resets to the theme's default. Because field-mapped opacity is covered
here, it drops out of that separate subsection — which now surfaces
only for length / angle / area, plus measure-mapped (Count / Density)
opacity, whose ramp has no Swatches group.

**Swatch outline** (per-section Outline color + Outline width rows):
a border drawn around that section's swatches — keeps pale swatches
(e.g. the white midpoint of a diverging gradient) visible against the
legend background. Width is the switch: 0 draws no outline, so there's
no separate toggle; the theme's default width (0 out of the box) is
where every section starts, and the width's reset link returns to it. The color starts from the theme's default
outline color when it has one, else pipes in from the
marks' outline color (Color → Outline), falling back to
`#cccccc`; picking a color stores an override and "reset" returns to
the piped-in value. A visual saved before per-section outlines had one
global color + width pair; those legacy fields still apply to every
section until a per-section value overrides them. The rows hide — and
the stored settings go inert — whenever the outline-color channel is
encoded, because the swatch strokes are then a faithful key for that
encoding. The area/radar split-outline (line-color borders) also wins
over it per swatch.

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

A "Show tooltips" checkbox turns them on / off. The "Fields shown"
group (a standard group header under a divider) contains a checkbox for
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
default template and a CSS block that spells out the tooltip box as
the Box controls (below) currently have it, so the user edits from a
working starting point and switching the template on changes nothing
visible (boxes with existing content are left alone); a "reset" link
below each box — shown only when its content differs from that seed —
restores it.

**Text wraps.** A long value breaks across as many lines as it needs
inside the box; nothing is cut to "…". The variable name keeps its
line, the value wraps beside it.

**The Box group** (a standard group header under a divider, between
Fields shown and the custom-HTML toggle) styles the container every
tooltip renders in — the default field list and a custom template
alike: **Max width** (px — what the text wraps against), **Corner
radius** (px), **Outline color** and **Background color** (Auto
follows the light / dark UI: a white box with a light hairline, or
dark stone with a darker one; a set background also flips the text to
black or white, whichever reads on it), **Background opacity** (0–1;
the text stays opaque), and a drop shadow: **Shadow size** (px — the
blur; the shadow sits half that far below the box; 0 = none, which
hides the two below), **Shadow color**, **Shadow opacity** (0–1).
Every one of these starts from the theme (Settings → Themes →
Tooltips, §14; the built-in look is 240px, 6px, Auto / Auto, opaque,
and a 12px black shadow at 15%). A per-visual value is stored only
when it differs from the theme — typing the theme's own value clears
the override — and a reset link beside a pinned control drops it so a
later theme edit flows through again; any pinned control lights the
subsection's dot. The box properties live in the stylesheet and the
Custom CSS rule comes later in the cascade, so custom CSS still
overrides any of them per property, as before.

**Values inherit each variable's format.** The tooltip has no Format
controls of its own: every value prints with the format that variable
already carries elsewhere on the chart, so a tooltip never contradicts
the axis beside it. A variable can be formatted in more than one place
(a share at `.0%` on its axis and `.2%` in its data labels), so the
sources are ranked and the first one with a format wins: **an axis**
(x / y / r, the radar / pie angle axis, the chord ring axis), then a
**quantitative legend's** break-label format, then a **data label's**
per-variable format. Axes lead because they're the chart's own printed
reference for that variable. A variable formatted nowhere prints its
raw cell, as before. The whole format grammar applies — number and
time specs, `literal`, and the Before / After text around them (§5.1)
— including inside a custom HTML template, so `{{Sales}}` reads
"$1,235" too. The dollar / percent cell hints reach the tooltip on the
same read-time terms they reach the axis; nothing is written back to
any Format box.

**Line charts snap to the nearest point.** On a connection (line)
chart the user doesn't have to land on a marker: pointing anywhere
along a line shows the full-row tooltip for the point of THAT line
nearest the pointer, re-evaluated as the pointer travels. The search
is restricted to the hovered line's own points, so a point on a
neighboring line that happens to be geometrically closer never steals
the hover — the line under the pointer is the series the user is
reading. Hovering a marker directly still reports that marker.

**"Show tooltips only at points"** (a checkbox right under Show
tooltips, offered on line charts only — a scatter with a connection
field mapped) reins that snapping in. Connection → "Show points" can
thin a line's markers down to the first, the last, both ends, every
Nth, or none at all; without this option the hover still reports a
full row at places along the line where there is no point to read it
off. With it on, the full row is reserved for the stretches where a
point is actually DRAWN. Everywhere else the hover reports the line's
identity alone — its connection variable — and only if that variable
is one of the Fields shown; when it isn't, hovering bare line shows
nothing at all (not even a custom HTML template, which would
otherwise render with every placeholder empty). So on a line chart
drawn with first-and-last points: at either end the tooltip is the
full row, anywhere between them it's just the line's category. A line
chart with every point drawn is unaffected, and the option is off by
default, so saved visuals keep the old behavior.

---

## 10b. Data table

A **Data table** section in the sidebar, right after Caption, adds an
optional HTML `<table>` of the chart's data (under the figure, or in a
tab beside it). It is the
non-visual alternative to the chart — a screen reader reads a real table
with a caption and column headers — and lets sighted embed viewers read
exact values. The top toggle, **Show a data table**, is
off by default; every other control is hidden while it is off.
Below the toggle the controls sit in collapsible subsections: **Table
properties** (open by default — the list below up to Download link),
**Title**, **Caption**, **Header**, **Table text** and **Rows**.

- **Placement** — *Below the chart* renders the table always; *Behind a
  button* renders a **View data** / **Hide data** link at the bottom
  right of the figure that toggles it (a real `<button>` with
  `aria-expanded` and `aria-controls`; the table is not built until it
  is first opened). Where the chart fills its viewport (the editor's
  chart area, the embed) the figure shrinks by the link's slim row, so
  the link shows without scrolling; the opened table follows below.
  The link (and the tabs below) ends flush with the figure's
  farthest-right plot edge — where the x axis ends — not counting
  legends or labels; re-measured after every layout pass. With a fixed
  canvas size the link sits INSIDE the canvas, at its bottom right (the
  chart gives up the row's height), and the opened table shows in the
  box under the canvas;
  *In a tab* puts **Chart** / **Data** tabs at the bottom right of the
  figure, where the View data link sits — text
  links like View data, the selected one with a solid underline and the
  header weight, in the table's font and colors — starting on Chart. The Data tab COVERS
  the chart's box (the table scrolls inside it) rather than replacing
  it: the chart stays mounted and laid out underneath, hidden, so
  switching back never re-solves the layout and an embed keeps its
  size. In the editor the tabs sit at the bottom right of the whole
  chart viewport — or, with a fixed canvas size, inside the canvas, the
  Data tab filling the canvas (zoomed with it). The
  tabs follow the WAI-ARIA tabs pattern (arrow keys / Home / End move
  between them; the table is built when the Data tab is first opened).
- **Columns** — *Encoded variables only* (the default), *All
  variables*, or *Select variables*. Select variables shows a checkbox
  for every variable in the data set (the main table, after reshape and
  derived variables), in its order; the table shows the checked ones in
  that order. Switching to it starts with the columns the table showed
  a moment ago, so nothing changes until a box flips, and the last
  checked box can't be cleared. Picks are kept by name: a renamed or
  removed variable drops out (none left falls back to the encoded
  columns), and the picks survive switching to another mode and back.
  Encoded columns list the dimensions (categorical, ordinal
  and temporal variables) first, then the measures (quantitative), so a
  horizontal chart whose x is the value still reads "Category, …,
  Value". Within each group columns follow encoding order: x, y, r,
  length, angle, area, then the color / mark channels (hue, outline,
  saturation, brightness, opacity, shape, pattern, connection, legacy
  text), facets last. A field mapped twice is listed once. With nothing
  mapped the table lists every column.
- **Max rows** — 10 by default; cleared = all rows. (Visuals saved
  before the default changed stored an empty box as the old default, so
  a one-time migration fills those with 10; clearing it now sticks.)
  When set, the
  first N rows show with
  a **Show all N rows** link; once expanded it reads **Show first N
  rows** and collapses back (one toggle in place, so keyboard focus
  stays on it). With no limit set the table still renders at most 1,000
  rows up front (same toggle), so a very large data set can't stall the
  page.
- **Download link** (on by default) — a **Download CSV** button under
  the table. The CSV carries the table's columns and EVERY row, with the
  raw (unformatted) cells, so it is machine-readable.
- **Title** — the line ABOVE the table. It is the HTML `<caption>`, so
  it also names the table for screen readers (and labels its scroll
  region). **Text** empty = "Data for <chart title>", falling back to
  the visual's name (the placeholder shows it). Then Family, Size (pt),
  Weight, Color and Alignment.
- **Caption** — a paragraph BELOW the table (a source, a note), which
  the table is `aria-describedby`. **Text** is a multi-line box; empty =
  no caption, and its Family / Size / Weight / Color / Alignment stay
  hidden until it has text. Line breaks are kept. It sits above the
  table's own computed note and the Show all / Download CSV links.
- **Header** — the header row's Family, Size (pt), Weight and Text
  color (empty family / size / text color follow the table text; weight is the
  theme's, semibold out of the box), Background, and a **Bottom line**
  under the row: Thickness (px, 2 by default; 0 = no line, and the
  color control hides) and Color (empty = the row border color).
- **Table text** — the cells: Family, Size (pt), Weight, Color; then
  **Format first column like other columns** (checked by default).
  Unchecked, a **First column** block appears with its own Family,
  Size, Weight and Color for the first column's body cells (the header
  row keeps the header's style); empty rows follow the table text.
  Then **Column alignment**: every column the table shows, by name (the
  aggregated tables' computed columns too — "sales (sum)", "Count"),
  each with the shared alignment picker. A column's header and body
  cells align together. Numbers and dates start at the theme's Numbers
  & dates alignment (right out of the box); every other column starts
  left. Picking a column's starting alignment stores nothing. Choices
  are keyed by the column's name, so a renamed variable starts over at
  its default. (Visuals that stored the old single number alignment
  keep it as their numbers & dates starting point.)
- **Rows** — Border color and **Striped rows** with a Stripe color.

Every styling control starts from the theme's **Data tables** defaults
(Settings → Themes, §12) and shows them as its placeholder: an empty
field follows the live theme, so a re-theme restyles the table with no
config write. Empty title, caption, header and first-column Family /
Size / Color (and title / caption / first-column Weight) follow this
visual's table text. Every control a visual sets against the theme
shows a **reset** link beside it (each font row, Alignment, header
Background, the Bottom line's Thickness and Color, the first-column
checkbox, each column's alignment, Border color, Striped rows, Stripe
color); it clears that one setting so it follows the theme again. A
visual still carrying the old single number alignment shows the reset
next to the "Numbers and dates start …" line.
Choosing the inherited value for Striped rows, any Weight or any
Alignment stores nothing. Out of the box the theme gives the base
text font and weight, a semibold left-aligned title, a plain
left-aligned caption, an unfilled semibold header (text in the table's
color) over a 2px line, rules and stripes as soft tints of the text
color, and right-aligned numbers. The visuals v10 migration (a) clears
the Striped / right-alignment values older visuals stored as plain
backfilled values, so they follow the theme (an off / left / center
choice is kept), and turns their old header **Bold** flag into a
weight — on follows the theme's header weight, off pins 400 (what it
drew at) — and (b) moves the text
older visuals stored as `caption` — which was the line above the
table — and its styling to the title.

There are no position nudges: the table sits in page flow under the
chart, outside the layout solver and outside a fixed canvas size.

**What the rows are.** For chart types that draw one mark per data
row (scatter, lines, dumbbells, radar, maps) the table lists the rows
the marks are drawn from, after the reshape, the cell conversions and
derived variables (the view stage) — one table row per data row. Chart
types that AGGREGATE list the aggregated values the marks are drawn
at instead — one table row per mark, computed by the renderers' own
aggregation code (`lib/plottedData.ts`), so the table can't disagree
with the picture:

- **Bars** (stacked, grouped, mirrored, negative): the category, each
  color / pattern / opacity variable that splits the bar, and the
  measure summed — headed "sales (sum)" — or **Count** when the length
  variable is categorical. One row per bar segment. A mirrored bar shows
  its magnitude, as its labels do.
- **Histograms**: "score (bin)" — the bin's range in the binned axis's
  Format — and **Count** (**Share** in density mode); colored
  histograms add the color variable, one row per bin segment. An
  uncolored histogram lists every bin, empty ones included.
- **Areas**: the category, the layer variable(s) and the measure summed
  per point of each layer (the area renderer sums rows sharing a point,
  stacked or not).
- **Pies**: the pie's category (pies-x / pies-y), the wedge variable(s),
  the measure summed (or **Count**) and the wedge's **Share** of its pie.
- **Heatmap tiles**: x, y, **Count**, and the color variable's mean
  ("temp (mean)") or most common value.
- **Hexbins**: each hexagon's center in data units ("x (hexagon
  center)", "y (hexagon center)") and **Count**.
- **Box / violin**: per group, **Min**, **Lower whisker**, **Q1**,
  **Median**, **Q3**, **Upper whisker**, **Max** and **N** — the drawn
  whiskers are Tukey's (the furthest value within 1.5 × IQR).
- **Treemap / sunburst / packed circles**: one row per node — its path
  as **Level 1**, **Level 2**, … and its value summed over the leaves
  inside it (**Leaves** when no value variable is mapped).
- **Chord / sankey**: source, target and the value summed per link. The
  sankey lists only the links it draws (loops it has to drop are left
  out).

Facets split every aggregation per panel (the facet variables are the
last columns); bin edges and hexagon lattices come from all rows, as
on the default shared axes. Under an aggregated table a one-line note
says what a row is ("Values are sums per bar; the underlying data has
N rows."), in the table's own text color, a step smaller, and tied to
the table with `aria-describedby`. The **Columns** picker (encoded /
all / select variables) has nothing to choose there (an aggregate has
no other variables), so the sidebar replaces it with a one-line
explanation and its own **Columns** picker: **All columns** (the
default) or **Select columns**, which lists a checkbox per computed
column ("region", "sales (sum)", **Count**, …) — uncheck one to leave it
out of the table and its CSV. The last checked box can't be unchecked.
This choice is kept apart from the row table's picker, so switching
chart types changes neither. Unchecked columns are stored as a
hide-list by header (kept while on All columns, so switching back
restores them), so a column the chart starts
computing later (after a remap) shows until unchecked. A density curve (single variable) and a
regression line are curves COMPUTED from the rows, not lists of
values — those charts keep the row table, with a note saying so.

Column headers are the variables' current (renamed) names; an
aggregate column names its variable and aggregate. Cells print with the
same inherited format as the tooltip (§10: axis, then quantitative
legend, then data label); a variable formatted nowhere falls back to
its dollar / percent cell hint ("14%" rather than 0.14), then to its
raw cell. An aggregate column inherits its MEASURE's format; **Count**,
**N** and **Leaves** print as integers and **Share** as a percent when
nothing else applies. The CSV download carries the same rows as the
table (aggregated when the table is). Row order in an aggregated table
is the chart's own (categories, slices and bins as drawn, panels in the
facet order). In a row table, row order follows the
chart's level order where a shown column has one — a pinned order from
the Fields panel, or an ordinal variable's natural sort — in column
order; otherwise data order. Numeric (quantitative) columns align per
the setting; everything else aligns left.

**Where it renders.** (1) The editor canvas, under the figure inside the
chart's scroll region (with a fixed canvas size, under the white canvas
at its displayed width — the table is not part of the zoomed frame and
is never scaled). (2) The in-app `/embed/<visualId>` page: with a table
the page becomes a scrolling column, chart first (it fills what the
table leaves of the viewport, never below a readable floor), table
under it. In a split embed the table belongs to the **chart** part,
never the legend part. Without a table the embed page is unchanged.
(3) Published (static) embeds: the payload carries the whole saved
visual, so the table config travels with it; a visual published before
the table existed has no config, which reads as off.

**In image exports only on request.** By default an image export is the
chart alone at the requested size: the export preview (and the library's
thumbnail refresh) load the embed page with `table=off`. While the
visual has a table on, Export image offers an **Include data table**
checkbox (off by default, not saved). Checked, the preview loads the
embed with `table=image`: the chart at the requested size and, under
it, the table as a static "Below the chart" block whatever its
placement — no View data link or tabs, no Show all / Download CSV links;
a table cut at Max rows (or the 1,000-row safety window) ends with
"First N of M rows". The embed posts the table's height to the modal,
which grows the preview by that much, so the image is the chart's size
plus the table's height (the size readout says "plus the data table";
a height drag still sizes the chart). The capture redraws the HTML
table as SVG the same DOM-walk way it redraws the HTML legend — boxes,
row stripes, rules and text from their live layout rects — so it reads
in PNG / JPEG / PDF and in the SVG download alike.

Saved per visual (`dataTableConfig`, `lib/dataTableConfig.ts`), covered
by undo. The field is optional: a visual saved before it existed loads
with the table off, so no storage version bump.

---

## 10c. Accessibility preview and check

Two header toggles, shown only on editor routes, side by side left of
Settings. Both are transient editor views: in memory only, never saved
with a visual, never in exports, thumbnails, the embed page or published
embeds.

**Black-and-white preview** (half-filled circle icon, title "Black-and-
white preview", `aria-pressed`; `blackAndWhiteModeAtom`). Puts a CSS
`filter: grayscale(1)` on the chart's scroll region, so the user can see
whether the color encoding still reads without hue. Display only — the
saved theme and the chart's colors are unchanged.

**Accessibility check** (figure icon, title "Accessibility check",
`aria-pressed`; `accessibilityCheckAtom`). While on, a card floats at the
top-right of the chart viewport (below the zoom pill when a fixed canvas
size shows one), over the figure but under the narrow-layout menu sheet
and every modal. It lists what about the RENDERED chart may be
inaccessible. While it has findings the header button carries a red count
badge (`aria-hidden`; the same count is in the card's screen-reader
heading).

- **Top row**, no visible title: the model name and Level radio on the
  left; Re-check and × on the right. It never wraps — the card grows past
  its 320px base width to fit it. The card is a region named
  "Accessibility check — N findings" by a screen-reader-only heading, and
  keyboard-focusable. The × button turns the check off. There is no
  minimize control.
- **Narrow layouts:** while the menu sheet is open the card and its
  highlights are hidden (not discarded) and come back when it closes.
- **Level** radio (`accessibilityCheckLevelAtom`, starts at the lower
  level each session): which of the contrast model's two levels text
  contrast is measured against — **AA / AAA** under WCAG 2, **Lc 60 /
  Lc 75** under APCA. The model's name sits beside the radio; the model
  itself is the Settings → Accessibility preference (below).
- **Findings**, grouped **Fails** → **Fails at AAA only** / **Fails at
  Lc 75 only** (stricter level only) → **Advisories**. Each is a button: the message says what is wrong and
  where, in short plain words (no measured values — the highlight and the
  fix carry the detail), medium weight with no closing period; the line under
  it says how to fix it, as a full sentence. Group headings are brand
  purple; each row's dot is red (Fail), amber (stricter level only) or
  light purple (Advisory). Hovering or focusing
  a row outlines its targets on the chart (brand dashed boxes drawn in a
  layer beside the chart, `aria-hidden`); clicking also scrolls the first
  target into view. Similar offenders are grouped into one row (e.g.
  "7 data labels are too low contrast against the bar or tile behind
  them") that outlines all of them; a single offender is quoted by its
  text.
- **Re-check** re-reads the chart now. It also re-checks on its own:
  any change inside the chart viewport restarts a 400ms quiet-period
  timer (the layout solver re-renders several times per edit; checking
  mid-pass would read a half-laid-out frame), as do editor-state changes,
  window resizes and webfont loads. Until the chart has laid out it says
  "Waiting for the chart to finish drawing…".
- **Empty state:** "No accessibility issues found at AA." (or AAA,
  Lc 60, Lc 75).

**Settings → Accessibility** (`/settings/accessibility`,
`AccessibilityPage`, between Fonts and Sharing in the rail): the check's
preferences, for this browser only — never saved with a visual, never
in exports or embeds. One so far: **Text contrast**, a radio for the
contrast model, **APCA (recommended)** — the default — or **WCAG 2**,
with a line under it spelling out the two levels the chosen model uses.
Stored device-locally as `vis-components:contrastAlgorithm`
(`contrastAlgorithmAtom`; an unknown stored value falls back to APCA)
and synced across open tabs, so an editor picks up a change made on the
settings page in another tab.

**Rules** (`lib/accessibilityCheck.ts`; the DOM is read by
`components/accessibility/collectAccessibilityDom.ts`, editor state by
`useAccessibilityState.ts`):

1. **Text contrast — Fail.** Every visible chart text: the plot SVG's
   text (tick labels, axis titles, chart title / subtitle, data labels,
   annotation text, caption, flow labels) and the HTML legend and facet
   titles. Foreground = the text's computed fill (or color) with its
   fill-opacity and every ancestor's opacity. Background = the painted
   shapes under the text's center, topmost first, found geometrically
   (`isPointInFill`, so `pointer-events: none` layers such as label
   backgrounds and annotation boxes count) and composited down to the
   first opaque layer or the chart / page background. A text stroke of
   1.5px or more is a halo and counts as the background. Measured with
   the contrast model chosen under Settings → Accessibility
   (`contrastAlgorithmAtom`); the two models are one table,
   `CONTRAST_MODELS`, so the rule is written once:
   - **APCA** (the default) — the 0.0.98G-4g base algorithm with the W3
     constants apca-w3 0.1.9 ships, implemented in `apcaContrast` from
     the published math (no dependency, no copied code; the tests pin
     the published reference values). Polarity-aware lightness contrast
     Lc, judged by magnitude. The lower level needs Lc 60 (Lc 45 for
     large text: ≥ 36px, or ≥ 24px bold — APCA's own "larger, heavier
     text" sizes), the guideline's minimum for content text; the
     stricter level adds the Lc 15 it suggests where readability
     matters: Lc 75 (Lc 60 large). APCA's font-size lookup table is NOT
     applied beyond that large-text cutoff — rule 5 covers size.
   - **WCAG 2** — the 2.x luminance ratio; AA needs 4.5:1 (3:1 for
     large text: ≥ 18pt, or ≥ 14pt bold), AAA 7:1 (4.5:1 large).
   Failing texts group by kind, background and level. At the stricter
   level text that passes the lower one is listed as "Fails at AAA
   only" / "Fails at Lc 75 only". Skipped: text over a gradient or
   pattern fill (background unknown), emoji-only text (glyphs ignore
   their fill), invisible text.
2. **Palette distinguishability — Advisory.** The categorical / ordinal
   color levels actually in use (from the color scale, not the whole
   theme palette): any pair within CIEDE2000 ΔE 10 as-is ("are too
   similar") or under a protanopia / deuteranopia / tritanopia
   simulation (Machado 2009, severity 1; "aren't colorblind friendly")
   names the two levels. Six pairs are listed, closest first; the rest fold into
   one "N more pairs" row. Skipped for gradient (quantitative) color.
3. **Color is the only cue — Advisory.** Color maps a categorical /
   ordinal field and nothing else tells its levels apart: not Shape or
   Pattern on the same field **where the chart mode draws it** — Shape
   counts only when the mode's marks are glyphs (`canvas.shapeRole`
   "glyph": points, radar; not bars, tiles, wedges, regions or areas);
   Pattern counts as the line dash on a drawn line (`connectionRole`
   "line" with a Connection field) and as the fill pattern elsewhere,
   unless two or more of the levels are set to no pattern / a solid
   line — not data labels whose text includes the
   field, not X / Y / a facet on the same field — and the level colors
   do not all differ by at least 3:1 in luminance (WCAG's accepted
   non-hue cue; such levels still separate in the black-and-white
   preview). Always the WCAG 2 ratio, whichever model rule 1 measures
   with: this is two fills side by side, not text on a background.
4. **Red–green ordered palette — Advisory.** An ordinal palette or a
   color gradient whose two ends are a red and a green (e.g. the
   Stoplight presets, RdYlGn), which red-green color-blind readers see
   as the same muddy hue.
5. **Small text — Advisory under 9pt, Fail under 7pt.** Resolved size in
   points (the UI's unit: px × ¾), grouped by kind of text and level;
   worded "is too small" without the size.
6. **Faint or thin marks — Advisory.** Mark opacity under 40% (the
   overall Opacity, when no field is mapped to opacity); line thickness
   under 1px on a cartesian chart that draws lines from Connection; mark
   outlines under 1px when an outline-color field makes them carry data.
7. **Hover-only values — Advisory.** Tooltips are on and no data labels
   are drawn or mapped.
8. **Missing titles — Advisory.** On a chart with cartesian axes, an
   axis whose title was cleared ("has no title") or unchecked under
   Titles shown ("is hidden" — still an advisory, worded as a choice);
   and a drawn legend whose title is cleared or hidden.
9. **Description — Fail / Advisory.** The screen-reader description
   (§10d). **Fail** when the resolved description is empty or is just
   the visual's name on a chart with no title ("only the visual's
   name") — screen-reader users learn nothing about the chart.
   **Advisory** while the description is still the automatic one AND the
   chart has an (authored) title: "The screen-reader description is the
   chart title; write a sentence that states the takeaway, under
   Accessibility." Quiet once the user writes their own, and for an
   automatic description built from a subtitle alone.

No rule fires on the chart background itself or other theme styling as
such — only on text and marks drawn against it.

**What it does not do.** It reads the editor's render: it cannot see
hover tooltips' content, the published embed (or how a host page styles
around it), or keyboard / screen-reader behavior of an embedding page.
Of the chart's text alternative it judges only the description's
presence (rule 9), not its quality. Contrast is measured at each text's center only, so a label
straddling two fills is judged by what's under its middle. It is a
guide, not a WCAG conformance certificate.

**Never affects the chart.** The card and highlight layer are siblings
of the chart's scroll region, never inside the plot SVG or the chart
viewport, so the layout solver (which samples rendered tick labels),
exports and thumbnails never see them. Reading is strictly read-only —
the only chart-side change is a `data-vc-data-labels` marker attribute
on the data-label layer, used to word findings. Fill colors are read
from computed styles, which the black-and-white filter doesn't change,
so the two toggles work together (the highlights stay in color).

---

## 10d. Accessibility (description)

The LAST sidebar section, **Accessibility** (expanded by default), right
after Aesthetics & Theme. One option panel:

- Help line: "Read aloud by screen readers in place of the figure, in the
  editor, embeds and SVG exports."
- **Description** — a stacked label over a multi-line box (4 rows,
  grows with its text). While no override is stored the box SHOWS the
  automatic text as its real value (not a placeholder) and follows title
  / subtitle edits live. The first keystroke stores the box's text as an
  override (the label turns bold accent, the usual "changed" mark).
- **Reset to title** (right-aligned link) — shown only while overridden;
  returns to the automatic text.
- Clearing the box to nothing is an override of "" (it does not snap back
  to the automatic text); while it is empty a help line says screen
  readers hear the visual's name instead.
- Help line: "The Accessibility check (header button) reviews contrast,
  color-only encodings and text size."

**Automatic text** (`autoChartDescription`, `lib/accessibilityConfig.ts`):
the AUTHORED chart title and subtitle, each with runs of whitespace
collapsed and trimmed, each skipped when empty, each ended with a period
unless it already ends in `.` `!` `?` or `…` (optionally followed by a
closing quote or bracket), joined by one space — "Sales by region. 2024,
in USD." The title prefix is not included. Titles hidden by **Titles
shown** still count: the description is for readers who cannot see the
figure.

**Resolved description** (`resolveChartDescription`): the automatic text
when no override is stored, else the override trimmed; when that comes
out empty, the visual's name; empty only when the name is empty too.

**On the chart.** The plot SVG (`#vc-scatter-svg`, one per canvas, facets
included) is `role="img"` with `aria-labelledby` pointing at a `<desc>`
— its first child — holding the resolved description, so the description
IS the figure's accessible name. Its id comes from `useId` (sanitized to
a valid XML name), unique per mounted canvas. There is deliberately no
live `<title>`: browsers show an SVG `<title>` as a native tooltip over
every mark, on top of the app's own tooltips. The short title (chart
title, else the visual name) rides on the SVG as `data-a11y-title`. If
the resolved description is empty the SVG gets `aria-label="Chart"`.
The same render path runs in the editor, the `/embed/$visualId` page and
the published static embed. `<desc>` is not `<text>`, so neither the
layout solver nor the accessibility check measures it. Because the SVG is
an image to assistive technology, its inner text (ticks, titles, data
labels) is not read piece by piece; annotation TEXT is no longer
`aria-hidden` (only the decorative annotation shapes — rectangles,
circles, lines, arrowheads, text boxes — are), and data labels stay
hidden (the data table, §10b, carries the values).

**In exports.** The export serializations (`serializeChartSvg`,
`serializeEmbedCapture` in `lib/captureThumbnail.ts`) move the name to the
exported root — it matters for the SVG download; raster formats and
thumbnails carry it only in their intermediate SVG: `role="img"`, a `<title id="vc-export-title">` (the short
title) and `<desc id="vc-export-desc">` (the resolved description) as its
first children, `aria-labelledby` → title and `aria-describedby` → desc
(`aria-labelledby` → desc when there is no title). Nested plot clones are
stripped of their own role / desc, so the file carries one name and no
duplicate ids.

**Saved** per visual (`accessibilityConfig: { description: string | null
}`, `null` = automatic), draft key `vis-components:currentAccessibility`,
covered by undo. Optional: a visual saved before it existed (or a
malformed value) loads as automatic via `migrateAccessibilityConfig`, so
there is no content-version bump.

---

## 11. Annotations

A top-level "Annotations" section in the sidebar. Users can add
**rectangle**, **circle**, **line-segment**, and **text** annotations
to highlight regions of the chart. Each annotation's editor is
individually collapsible: a chevron in its header row toggles the
body, while a glyph of the kind (box / circle / diagonal stroke / "T"),
the name, and the remove link stay visible so a long list remains
scannable by shape as well as by name. The name is plain text with a
pencil beside it, not an input box — an open box in the first row was
read as the annotation's content. A new annotation is named for its
kind and position ("Rectangle 1", "Circle 2", "Line 1", "Text 3"),
numbered one past the kind's current count and skipping any number a
sibling already holds; the name is stored at creation, so it stays put
when earlier siblings are removed. Clicking the pencil or
double-clicking the name opens an inline rename box (Enter / blur
commits, Escape cancels); committing an emptied box reverts to the
numbered default. Existing annotations start collapsed when the panel
mounts; a freshly added annotation starts expanded. Each rectangle
has:

- A name (free text, defaulted as above; shown in the card header).
- **Adjust by** dropdown — Values, Pixels, or Percent. For Pixels and
  Percent a second **From** dropdown picks the corner the coordinates
  are measured from (Top left / Top right / Bottom left / Bottom right);
  Values has no corner and hides it. One set of coordinate inputs; the
  two dropdowns set their unit and origin, and switching either converts
  the stored numbers (through the axis span, or the rendered plot's
  size) so the annotation stays where it is. Switching unit keeps the
  chosen corner; coming from Values, Percent starts at the bottom-left
  and Pixels at the top-left. Saved as one flat `coordSystem` value
  (`percent` = percent from the bottom-left, `percentTopLeft`,
  `percentTopRight`, `percentBottomRight`, `pixels` = pixels from the
  top-left, `pixelsBottomLeft`, `pixelsTopRight`, `pixelsBottomRight`,
  `values`), so charts saved before the split read unchanged.
  - **Percent**: xMin/xMax/yMin/yMax are fractions of the plot's width /
    height (shown 0–100). From the default **bottom-left** corner 0,0 is
    the bottom-left spine corner and 100,100 the top-right. The other
    corners follow the pixel rule below — +x right and +y up from every
    corner, only the origin moves — so from the **top-right** the inside
    of the plot is negative x and y (−10% x is 10% of the width left of
    the right edge). Percent is still a fraction of the plot, so a spot
    outside it scales with the plot; use Pixels for that.
  - **Pixels**: whole px from the plot's **top-left corner**, +x right
    and +y up (so a negative y is inside the plot). This is the unit for
    anything placed **outside** the plot. A percent coordinate is a fraction of the plot, so one past
    0 or 100 sits a distance beyond the edge that grows and shrinks with
    the plot — while the chrome out there (panel titles, the chart-title
    band, cell margins) is a fixed pixel height. The annotation drifts
    across its neighbors as the viewport changes: a label 12% above the
    plot clears the panel title on a tall chart and lands on top of it on
    a short one. "14px above the top-left corner" is 14px on every
    viewport. It also makes the edge reserve (below) converge in a single
    extra solve, since a pixel-anchored annotation's spill no longer
    depends on the plot's size.
  - **Pixels (from bottom-left)**: the same unit measured from the
    plot's **bottom-left corner**, still +x right and +y up (so inside
    the plot is positive y and a negative y is **below** the plot). A
    pixel placement only holds still on the side it's measured from: a
    note hung under the plot in top-left px sits at `-(plot height + N)`,
    which scales with the plot again — and on a facet grid whose panels
    differ in height ("Apply to all facets" with, say, two stacked panels
    where the top one is taller), the same stored coordinate lands at a
    different depth under each panel. Bottom-left px puts it N px under
    every panel's own bottom edge.
  - **Pixels (from top-right)** / **Pixels (from bottom-right)**: the
    same again measured from the plot's right-hand corners. +x is
    still to the right, so a negative x is inside the plot and a
    positive x is beside it; y follows the corner's top or bottom edge
    as above. These hold a note beside the plot's right edge the same
    distance out at every width (and under every panel of a facet grid
    whose panels differ in width). All four corners share the same
    directions and the circle's on-screen px radius; only the origin
    moves.
  - **Values**: same fields are interpreted as data values along
    whichever encoding drives each axis (`x`/`y` for scatter,
    `length` for the measure axis in bars/areas, etc. — the mode's
    `annotations.xValueChannel` / `yValueChannel`). Modes with no
    value axis on either side — the pie variants, maps, and the
    structure layouts — disable Values mode (there is no scale a data
    coordinate could resolve against). Numeric axes
    use the linear scale. A date axis presents the same date box as
    the axis's Scale Min / Max bounds (type `YYYY-MM-DD` or pick from its
    month / year calendar) and stores the coordinate as epoch ms at
    local midnight, which the time scale places directly — the
    percent ↔ values toggle computes the same unit, so a converted
    position shows up as the date it fell on. Categorical/string-ordinal axes
    present a category dropdown and the rectangle spans between the
    selected categories' centers — the same positions line-segment
    endpoints land on.
- Fill color + fill opacity.
- Border color, thickness, opacity, and dash. Dash is the same
  None / dash-swatch / Custom button row the Pattern panel's
  regression-line control uses (swatches preview dashed / dotted /
  dash-dot); Custom opens a dasharray text box (e.g. `2,2`), and a
  custom dasharray wins over the swatch pick at render time.
- Layer toggle: **Behind chart** (under marks) or **In front** (over
  marks). It sits at the bottom of every kind's Position subsection,
  under a hairline divider — not as a loose row after the subsections.

**Circles** (`lib/circleAnnotationGeometry.ts`) are defined by a
center (x, y) and a radius, with the same Percent / Values coordinate
toggle. A circle always renders as a true on-screen circle;
`radiusAxis` selects which axis the radius is measured against in
Values mode. When that axis has data units (quantitative or
numeric-ordinal) the radius counts in them. When it has none —
categorical, string-ordinal, or temporal, so e.g. a tile chart with a
category on both axes — there is no axis unit a radius could count in,
so the radius box grows a **px / %** unit dropdown beside it, like
Caption's offset fields (`radiusUnit`):
a fixed on-screen px size, or a fraction of that axis's plot extent
(the same number Percent mode reads; the default, so a circle toggled
from Percent to Values keeps its size). Switching px ↔ % converts the
stored number so the circle holds its size, and "Adjust by" converts
against whichever unit is active. Circles share the rectangle's
fill/border/layer styling controls. **Line segments**
(`lib/lineSegmentAnnotationGeometry.ts`) run between two endpoints,
each in Percent or Values coordinates (the Position inputs call them
Left / Bottom and Right / Top). Their **Line properties** subsection
holds the stroke — **Color**, thickness, opacity, dash — and then the
line's ends:

- **Line cap**: a Round / Square segmented toggle. Square is a flush end exactly at the
  endpoint (SVG's butt cap — the same mapping the Connection and
  segment line caps use, and what every line drew before the option
  existed, so lines saved without the field keep their look); Round
  adds a half-circle past each endpoint.
- **Add arrowhead**: a checkbox that reveals the head's **Style**
  chips — Triangle, Stealth (notched), Open (a stroked chevron),
  Diamond, Circle — and a **Scale** multiplier. The head sits at the
  right / top endpoint, pointing along the segment. It is sized from
  the line thickness (one unit = the thickness, floored at 1px; the
  head is 4 units long and 4 wide, × scale), so thickening the line
  grows its head and the scale stays a proportion rather than a stale
  pixel count. The line's own stroke stops at the head's base (at the
  notch for Stealth; at the tip under an Open chevron), backed off by a
  round cap's overhang, and the line's opacity is applied to the line
  and head as one group, so a semi-transparent arrow never darkens
  where the two overlap. The head is explicit `<path>` geometry rather than
  an SVG `<marker>` — PowerPoint's SVG import drops markers — so it
  clips, scales, and exports exactly like the line, and the edge
  reserve (below) counts it. All of this is
  `lib/arrowheadGeometry.ts`; the cap and arrowhead fields are
  per-annotation (not theme-seeded) and reset against
  `DEFAULT_LINE_END_STYLE`.

**Text annotations** (`lib/textAnnotationGeometry.ts`) are plain text
drawn on the chart rather than a shape that contains text. They carry
the rectangle's full text styling plus a background box with a
**corner radius**, but that box is auto-sized to the rendered label
(measured at its actual font) plus the text padding — the user never
sizes it. That's why position is a single anchor point, x and y, with
the same Percent / Values toggle every other kind has:

- `y` always centers the box vertically on the anchor.
- **Align** picks which horizontal edge lands on `x` — `left`
  starts the box there, `center` straddles it, `right` ends there — in
  addition to aligning the lines of multi-line text. So the control
  stays meaningful for a one-line label, where line alignment alone
  would be invisible.

A text annotation with a blank label draws nothing at all, box
included (there is nothing to size the box to).

The text annotation's editor leads with its **Text** box, sitting
directly under the header outside any collapsible subsection — the
text is the annotation, so it is never hidden behind a collapsed
header. Its font controls follow in a **Text** subsection — **Align**
(which also sets the anchor), then the shared font
editor's Family · Color · Size · Weight · Style (italic / underline,
stored as `textItalic` / `textUnderline`; absent = off) — then Position
(ending with the layer toggle), then one **Box** subsection: Background
· Opacity · Corner radius · Padding · **Border** toggle · Border color ·
Border thickness · Border opacity · Dash. The Border toggle has no field
of its own: "on" means a visible border (thickness and opacity both above
0). Off stores thickness 0; on restores the last non-zero thickness (or
the default) and lifts an opacity of 0 to the default (or fully opaque);
the color / thickness / opacity / dash rows show only while it is on. (The rectangle keeps its optional
inner label inside its "Text" subsection — the same Align + font rows,
plus Padding, since a rectangle has no Box — after its separate Fill
and Border subsections, which circles share.)

New annotations seed their style (fill, border, text font, line
stroke) from the active theme's **Annotations** defaults (§12), and
each style control's reset link compares against and restores those
theme values. Text annotations read the theme's *Text annotations*
box defaults — separate from the shape fill so a text label can
default to no background — and share the theme's annotation *text*
font with the rectangle's inner label.

All four kinds render per-panel in PlotCanvas, using each panel's own
position scales in Values mode. An annotation may sit **anywhere on the
canvas**, not just inside the plot: Percent coordinates past 0–100 (or
below 0), Pixels outside the plot, and, on a single-panel
chart, Values outside the axis domain
place it beside the y-axis, above the title, below the x-axis, or past
the right edge, and nothing clips it. Like a wide legend, an
end-of-line data label, or the caption band, an annotation that would
run past the canvas edge **pushes the figure away**: the layout
reserves just enough room on that side (left / right / top / bottom)
and the plot shrinks (or, with scrolling or a fixed panel size, the
canvas grows) so the whole annotation stays in the viewport. Percent
coordinates are fractions of the plot, so the reserve is solved
iteratively (LAYOUT.md §2). The one case that still clips to the
panel's plot area is a **Values-mode annotation on a faceted chart**:
each panel draws it in its own data coordinates, and one whose range
falls outside a panel's (independent-axis) domain draws nothing there
rather than spilling into a neighbor — it keeps its true geometry and
only the in-bounds portion paints. The other exception is radar: value-mode circles are rendered inside
RadarPlot itself (via `computePolarCirclePixels`, since RadarPlot owns
the radial scales), and value-mode line segments and text annotations
are skipped on radar entirely; percent-mode shapes still render
normally there.

Annotations are per-chart and persist with the visual.

---

## 12. Theme

The Theme panel switches between system themes (Light, Dark) and
user-created custom themes. Settings → Themes hosts them the way the
library hosts visualizations: the landing page is a **gallery** of
theme cards grouped into the three folders the settings rail shows —
**System Themes** (the bundled themes; read-only in the UI, opened
straight into the read-only editor to inspect or copy), **Managed
Themes** (shared team-wide; opening or moving one passes the
administrator dialog, exactly like its rail entry) and **Custom Themes**
(editable by anyone — there are no user accounts yet) — and clicking a
card opens that theme's editor at `/settings/themes/<id>`. The two
locked tiers sit in tinted boxes (stone for System, purple for Managed);
nothing can be dragged into System Themes. As in the library's folder
tree, clicking a folder's header in the rail narrows the gallery to that
folder (`?folder=system|managed|custom`, the page heading becomes the
folder's name, with a "Show all themes" link); the header's chevron
folds the list without changing the page; and "Themes" or a click on the
rail's empty space shows every folder again. Each card's
picture is a **preview template**, not a stored thumbnail: one fixed
bar chart — the theme's name set as the title in its own title font, a
subtitle, one bar per color for the first six colors of the default
categorical palette (fewer when the palette is shorter), gridlines /
spines / tick labels in the text font, an axis title and a legend keyed
to the bars — drawn live as inline SVG from the theme's own fields,
using the same per-slot font fallbacks and per-axis gridline / spine
fallbacks a real chart resolves. A new or edited theme previews itself
immediately with nothing to generate. Cards carry a "Default" pill on
the default theme and a locked "Managed" / "Read-only" pill on managed /
bundled themes. The editor shows the same bar chart at the top, beside a
**sampler** of what it leaves out, with no caption under either panel:
every categorical and ordinal palette as rows of chips (default first),
every gradient as a ramp (the default first, a sampled preset when the
default names one), the pattern set on its background and on the
default palette's own colors with their paired pattern inks, the default
mark beside the connection / regression / distribution strokes, the
three annotation kinds (rectangle with inner label, text annotation
with its box, line), and the data-label, legend-swatch and map
leader-line styles. Both redraw live as fields are edited.
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
- **Spines** — separate X, Y, and Polar spine color/thickness
  defaults. The polar spine covers radar spokes / perimeter and the
  chord ring axis. Legacy themes carrying only the old shared
  spine fields fall back to those everywhere.
- **Tickmarks, background colors, text encoding font,
  distribution overlay defaults, connection thickness, scale-channel
  min/max ranges** — all theme-controlled.
- **Data label defaults** — font size, weight, and style (italic /
  underline) used by the Data Labels layer. Applied when a chart is
  created or re-themed; the Data Labels panel's reset links restore
  these theme values. Themes saved before these fields existed fall
  back to the built-in defaults (11pt, weight 500, plain).
- **Caption defaults** — font family, color, size, weight, and alignment
  used by the Caption panel's text. Applied when a chart is created or
  re-themed (the caption's text, position / size nudges, padding, and
  box are user-driven and untouched); the Caption panel's reset links
  compare against and restore these theme values. An unset family or
  color follows the Axis text font, so a dark theme's caption is
  readable without editing this section; unset size / weight /
  alignment keep the built-in caption defaults (13pt, weight 400,
  left).
- **Annotations** — the initial style newly added annotations get:
  fill color + opacity, border color / thickness / opacity / dash for
  rectangles and circles; font family / size / color / weight,
  alignment, and padding for annotation text (shared by the
  rectangle's inner label and text annotations); fill, border, and
  corner radius for the text annotation's background box — its own
  section, so text can default to no box while shapes stay filled;
  and color / thickness /
  opacity / dash for line annotations (a line's cap and arrowhead are
  per-annotation, not themed). The dash controls are the same
  None / swatch / Custom button rows the annotation editors use. Existing annotations keep the
  style they were authored with (re-theming never restyles them); the
  Annotations panel's reset links compare against and restore these
  theme values. An unset border color follows the fill color. Themes
  saved before these fields existed fall back to the built-in seeds
  (yellow 20% fill, invisible border, slate line, 13pt centered
  text).
- **Legend swatches** — the glyph (rectangle / line segment / a shape
  from the palette), size, outline width, and outline color that the
  discrete swatches of a color / outline-color / saturation /
  brightness / pattern / opacity / rug legend section start with. A
  shape encoding's glyphs are never replaced (they ARE the key). The
  outline color is Auto by default — swatches that stand in for
  marks take the marks' outline color, aux-painted sections take the
  legend-swatch outline above — or a custom color. Read live: the
  Legend panel's Swatches groups show these values and store an
  override only when a visual deviates. Themes saved before these
  fields existed fall back to the historical look (rectangle, 5px, no
  outline).
- **Tooltips** — the hover tooltip's box: max width (what its text
  wraps against), corner radius, outline color and background color
  (each Auto — following the app's light / dark mode — or a custom
  color), background opacity, and the drop shadow's size, color, and
  opacity (size 0 = no shadow). Read live: the Tooltips panel's Box
  group (§10) shows these values and stores an override only when a
  visual deviates. Themes saved before these fields existed fall back
  to the historical look (240px, 6px corners, Auto colors, opaque, a
  12px black shadow at 15%).
- **Data tables** — the look of the optional data table under the
  chart (§10b), in the sidebar's order and wording: Title and Caption
  (family, size, weight, color, alignment each; the title defaults to
  semibold), Header (family, size, weight — semibold by default — text
  color, background, and a Bottom line: thickness, 2px by default, and
  color), Table text (family, size, weight, color, Format first column
  like other columns — checked by default — a First column block with
  its own family, size, weight and color, and under Column
  alignment the Numbers & dates row — where number and date columns
  start; every other column starts left) and Rows (border color,
  Striped rows, stripe color). Unlike the sidebar, the sheet keeps the
  stripe color, the bottom line's color and the First column block
  visible while stripes are off, the line is 0px or the first column is
  formatted like the others: a visual that turns them on still takes
  these values. Empty table-text rows follow the theme's
  text font, so they track a later Text fonts change; empty title /
  caption / header rows follow the table text; empty header background
  = none, empty header line color = the row border color, empty border
  / stripe = soft tints of the text color. Read live: the
  sidebar's Data table section shows these as its placeholders and
  stores an override only when a visual deviates. Themes saved before
  these fields existed fall back to the shipped look (base text font,
  semibold unfilled header over a 2px line, striped, numbers
  right-aligned).
- **Maps** — default stroke (line color + thickness) for the leader
  lines that connect a map's data labels back to their regions ("Draw
  leader lines" in the Data Labels panel, §6). Seeded on chart
  creation and flowed through on a theme switch like the data-label
  font knobs. Themes saved before these fields existed fall back to
  the built-in defaults (#999999, 1px).
- **Exporting** (last section of the sheet) — default **canvas
  margins** for visuals drawn on a fixed canvas (§13 "Canvas size"):
  Top / Right / Bottom / Left, entered in px or inches (a Units
  select; stored in px at 96 px/inch). A margin is the white space
  between the canvas edge and the nearest painted content, so 0 means
  flush. Read live: a visual inherits every side it hasn't set in its
  own Margins inputs (those show the theme value as their placeholder
  and a changed dot when the visual deviates), and editing the theme
  moves open charts. A blank side in the theme means auto — whatever
  the layout leaves. Stored sparsely as `exportCanvasMargins` +
  `exportMarginUnit`; themes saved before these fields existed set no
  defaults.

Custom themes can be set as the user's default; new charts pick that
up automatically. The Hue panel reads palettes from the active theme
live, so palettes added in Settings appear in the dropdown of open
charts immediately.

---

## 13. Aesthetics

A small catch-all panel:

- **Chart background color** — transparent, theme default, or custom.
  Fresh charts start on the theme default (transparent when the theme
  declares no background), and switching themes in the editor re-seeds
  it from the new theme — replacing a custom pick — like the legend
  background.
- **Canvas size** — a "Set canvas size" checkbox that, when on, draws
  the chart inside a fixed Width × Height rectangle (default 1000 × 600,
  px / in / cm display units at 96 px/inch; stored in px) instead of
  filling the viewport. Width and Height each show a reset link back to
  that default when changed. The editor shows the rectangle as a white canvas
  centered in a gray viewport; exports default to its dimensions. Scroll
  mode and the aspect ratio operate within the rectangle. Published
  embeds ignore the size (the iframe is its own canvas).
  **Zoom** (editor only): a floating pill in the gray viewport's
  top-right corner — − / percentage / + / Fit. − and + step through
  10–100%; zoom never exceeds 100% (the canvas is shown at most 1:1),
  clicking the percentage resets to 100%, and Fit shrinks the whole
  canvas into view and keeps it fitted as the viewport resizes. Zoom is a
  display-only CSS scale — the canvas still lays out at its true size,
  so exports, embeds, thumbnails and margins are unaffected — and it is
  not saved: it resets to automatic (100%, or fit-to-width on narrow
  screens) when a different visual opens.
  **Margins** (shown only with a canvas size): Top / Right / Bottom /
  Left inputs in the canvas unit. A margin is the white space between
  the canvas edge and the nearest *painted* content on that side — the
  chart title, an axis title or tick label, the legend box, a caption —
  not padding added on top of the layout's own slack. A blank side
  inherits the theme's Exporting default (§12) when the theme sets one,
  else it is auto (whatever the layout leaves today); either way the
  inherited amount shows as the placeholder and the spinner steps from
  it, and a side the visual sets itself carries the changed dot and a
  reset link that clears it back to inheriting. 0 puts
  the content flush against the edge. Enforced by measuring the rendered ink after
  each layout pass and shifting the chart box so the ink lands at the
  margin (LAYOUT.md §16); applies in the editor, in image exports, and
  in published embeds. Stored sparsely as `canvasSize.margins`.
- **Scroll mode** — "Fit" (canvas matches container, panels shrink to
  fit) or "Scroll" (preserve minimum panel/category sizes, scroll if
  needed). Avoids squishing very long or wide visuals so much that
  axis labels overlap.
- **Aspect ratio** — a "Fix aspect ratio" checkbox that, when on,
  reveals Width and Height inputs (default 1 : 1; each has a reset link
  back to 1 when changed). The plot area holds
  that Length : Width shape regardless of viewport size — the chart
  shrinks the longer dimension to fit rather than stretching to fill.
  The shrunk figure centers in the chart area, and the legend keeps
  its normal position relative to the figure (the figure + legend
  pair centers in the viewport).
  Faceted charts apply the shape to each panel individually. While
  on, the ratio overrides the Facet panel's Panel spacing and sizing (pixel
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
  **Draw axes behind marks** (checkbox, default off): by default each
  panel paints gridlines under the marks and the axis spine, ticks,
  tick labels, and title over them, so a bar or point that crosses an
  axis never hides it. Checking it paints the whole axis under the
  marks instead, so marks crossing an axis cover its spine and text.
  Applies to cartesian and radial axes alike (gridlines stay
  underneath either way); legends, annotations, and data labels are
  unaffected. Stored as `ChannelConfigs.axesBehindMarks` (sparse —
  absent reads as off).

---

## 14. Persistence & state

All editor state lives in Jotai atoms. In the default browser-local
mode it persists to the browser with no server or external database;
in server mode the same atoms route their content through the storage
adapter instead (see "Schema upgrades" below). Most state persists to
localStorage:
encodings, channel configs, labels, legend, tooltip, data labels,
annotations, theme, and the Visuals library. Each atom has a versioned
migration list so future schema changes don't break old saves.

Datasets (parsed CSV rows) are the exception — they persist to
**IndexedDB** (DB `vis-components`, store `kv`), not localStorage.
They can be large, and pooling them into the shared ~5 MB localStorage
budget previously starved thumbnails and silently dropped big uploads
on quota overflow. IndexedDB is durable, browser-built-in, and far
larger.

**Datasets load lazily.** Nothing reads row data until a visualization
actually draws it. What boots is a row-free metadata **index** (name,
fields, per-version ids/filenames/row counts, content hash) — the
authoritative list of which datasets exist. Opening a visualization
fetches the rows of exactly the one version it renders; a whole body
is only read for operations that genuinely need every version (append
a version, version management, bundle export/import) or as the
fallback for data stored before the per-version split, which is split
on the way through so the cost is paid once. While rows are in flight
the canvas shows a distinct loading state and must NOT mount the plot
SVG (the thumbnail capture pipeline reads any non-zero-sized plot SVG
as a finished chart, so an empty one would be saved as a blank
preview). Once mounted, the plot SVG carries `data-unmeasured` until
its container has reported a size — for one frame after mount, and
for as long as the host is hidden — because the solver has no room
then and collapses the canvas to its chrome; every capture (the
autosave thumbnail, the library's offscreen refresh, image export)
refuses that frame, the autosave keeping the old picture and stamp so
the library re-renders it instead. Saves are upsert-only — the in-memory record is a subset of
the store, so absence never implies deletion; deleting a dataset is an
explicit operation that removes its body, its per-version rows, and
its index entry together. Deleting a single VERSION propagates too: a
save diffs the dataset's versions against what the store held before
the write and deletes the removed versions' stored rows (one shared
implementation, `lib/storage/syncDatasetVersions.ts`, serves both the
IndexedDB layer and the HTTP adapter — its skip-cache keys on the rows
array, so a metadata-only edit like a version note never re-writes
rows). Any mutation that changes a dataset's content (append or delete
a version, or a rename — the name is part of the hash) recomputes the
cached `contentHash`, which the upload-time duplicate hint compares
against. The full-corpus read
(`loadDatasetsAsync`, sanctioned for bundle export/import only) is
all-or-nothing: an index-listed dataset whose body can't be read makes
it throw rather than silently produce an incomplete backup.

Storage layout, browser-local mode: one **body key** per dataset (the
authoritative, versioned, migratable record), one **index key**
(metadata for all datasets), and one **rows key per dataset version**.
The index and version keys are derived caches of the bodies: they are
tagged with the datasets schema version but never migrated — a stale
tag discards the cache and rebuilds it from the bodies, which flow
through the real migrations. A one-time migration moves any legacy
localStorage datasets blob into IndexedDB, and a second one-time split
moves the single pre-split IndexedDB blob into per-dataset keys. A
synchronous localStorage bootstrap still serves first paint, tests,
and IndexedDB-less environments — in browser-local mode only: server
mode ignores it (the server is the store; merging a leftover local
blob would resurrect ghost datasets and upload them on the next save).
The body keys hold ONE dataset each, so they migrate through
`datasetBodyMigrations`; the legacy blob migrates through the
record-shaped `datasetsMigrations`, which is DERIVED from the per-body
steps — a version bump appends one step and both shapes follow.

Server mode mirrors the shape: `GET /api/datasets?view=index` serves
the metadata index (a pure SQLite read; the bare collection GET keeps
returning full bodies for not-yet-reloaded tabs during a rolling
deploy), `GET /api/datasets/:id` one body, and
`GET /api/datasets/:id/versions/:vid` one version's rows (stored gzip
passed through untouched, ETag/304 on revisit). Metadata and
per-version bodies are derived by the CLIENT and PUT alongside each
body write — the server never parses dataset bodies. A missing
metadata row (pre-upgrade data, or a body written without its
follow-ups, e.g. by an old bundle mid-deploy) is served as `null`,
which means "derive me", never "deleted": the client reads the body,
derives, re-splits the versions, and writes all three back — metadata
strictly LAST, and only after the version sync succeeded, so a crash
or failed sync reads as un-hydrated (repaired next boot), never as
stale-but-trusted. Two write-path guards keep deleted rows from
resurfacing: a body PUT without the client's `x-vis-versions-managed`
header (an old bundle mid-deploy, which issues no version follow-ups)
makes the server purge that dataset's stored per-version rows — they
describe the previous body — and a version PUT whose parent dataset
does not exist is a silent no-op (mirroring the meta route), so a PUT
racing the dataset's DELETE can't resurrect it. Every lazy read first
consults the content-version gate below, so migrations and the
newer-than-this-build refusal apply to the lazy paths exactly as they
do to the eager one (one shared stamp-policy helper enforces both).

**Thumbnails travel as files in server mode.** A visual's thumbnail is
a PNG data URL everywhere in memory, but the base64 run inside the
visual's JSON tripped the SQL-injection rules of the WAF in front of the
hosted deployment, so the server-mode adapter never puts it in the
item body. The visual's JSON goes up WITHOUT the key (the server reads
an absent key as "leave the stored preview alone"), then the preview
follows as a multipart file — `PUT /api/visuals/:id/thumbnail`, one
`thumbnail` part named `thumbnail.png`, the browser's own boundary, no
Content-Encoding — and only when it differs from what the server is
known to hold, so a rename does not re-upload the preview. An explicit
`thumbnail: null` stays in the JSON: that is the clear. A thumbnail
that is not a decodable PNG (another media type, bad base64, no PNG
signature — only an imported bundle could carry one) is not sent at all:
never inline, and never uploaded only to fail. The route is strict: the
body must be well-formed multipart (no preamble, nothing after the
closing boundary) holding exactly one part, a `thumbnail` file, and that
file a PNG (signature-checked, 2 MB cap); anything else is a 400. It 404s for a visual that is
not stored (the JSON always lands first, and a thumbnail trailing a
DELETE must not resurrect the row), and stores the same data URL the
inline path always kept in the thumbnail column — so every reader,
`?thumbnails=0` included, is unchanged, and an inline `thumbnail`
string from a browser still running the previous bundle is still
accepted. A failed upload leaves the JSON saved and the item out of the
adapter's baseline, so the next save retries both (the repeated body
PUT is idempotent).

**Schema upgrades reach server-stored work too.** In browser-local
mode every persisted key carries its own version stamp, so an app
update that reshapes saved data migrates it on the next read. A
self-host server stores bare items with no stamp, so the version is
carried out of band: `/api/content-versions` holds one number per
collection, the client applies any missing migrations on load, then
writes the upgraded items and the new stamp once — so the upgrade
happens once per server, not once per page load. Folders are the one
collection with no version (they have never needed a migration) and
are passed through untouched.

Two cases deliberately refuse to load rather than guess. A collection
stamped NEWER than the running build means an older bundle is looking
at newer data: migrations only run forward, and saving back what the
old build made of the new shape would drop whatever the new shape
added — so it errors, the same way the server refuses to start against
a future database schema. (Practically: after a deploy, anyone still on
the previous bundle must reload.) A migration that throws also fails
the load, so a half-migrated collection is never written over the
user's work. A collection with no stamp at all is read as *already
current*, not as version zero — the stamp shipped with the first
server able to outlive an app update, so an unstamped server's rows
were written at the current shape, and re-running migrations over them
would corrupt data rather than repair it.

**Saved keys are structured, never joined.** A saved setting name or
value is never built by joining user values with a delimiter or a
control character — a joined string is ambiguous when a value contains
the joiner, and anything that inspects stored content judges it on its
face (the hosting firewall flags a control character in a setting name,
and read a `__all__|Type of System` panel key as a shell pipe). Where
two user strings identify one thing, they stay two keys or a pair: a
split composed label's per-variable styling lives under
`dataLabelsConfig.pieces[labelId][field]`; a grid facet panel is
referenced as a `{ row, col }` pair in every facet scope (`facetKeys` on
annotations and data labels) and keyed row-then-column in
`gridPanelAxisOverrides`; a wrap panel is its facet value, kept
verbatim (what users type is theirs, pipes and control characters
included — nothing is sanitized). In memory the renderer still keys
panels `row|col` and a split piece `labelId + U+001F + field`; those
keys never leave memory. The visuals v6→v7 migration rewrote the
joined shapes once, and the same idempotent rewrite
(`lib/savedKeyStructure.ts`) runs on every open, save, JSON import and
example seed, so a chart in the old shape (an old export, a draft from
an older build) keeps loading and is structured on its next save. Old
exports import unchanged.

**A build behind the server's content schema cannot write.** Chart
saves carry no version of their own, so a tab still running the
previous bundle after a deploy would otherwise write the previous shape
back over migrated content, and nothing would migrate it again. Every
write to a versioned collection (and a published embed, whose payload
is a visual) names the content version its build writes
(`x-vis-content-version`); the server refuses one behind the stored
stamp — or naming none, which is every build before the header existed
— with 409, and a stamp can only move forward. An unstamped collection
(a server no build has written yet) takes any build's write; a build
AHEAD of the stamp is the current build migrating before it moves the
stamp. On a 409 the client stops attempting writes and shows a banner
asking for a reload; the editor draft lives in localStorage, so the
reload picks the unsaved work back up. Navigating within the old tab
does not help — the library is a client-side route — only a reload (or
a new tab) fetches the current build.
A pre-pair grid key is split only where the split is certain: a
row-only / col-only key (its `__all__` side gives it away) or a
full-grid key with exactly one `|`. One with more pipes is never
guessed at; it keeps naming its panel by key, and the editor's save,
which can see the rendered panels, resolves it against the data.

Visuals are listed in a Visuals library (separate page) — load,
rename, duplicate, delete, organize into folders. Folder organization
is drag-and-drop as well as button-driven: sidebar visual rows and
grid cards drag onto sidebar folders (or "All visualizations" for the
root), cmd/ctrl-click and shift-click build a sidebar multi-selection
that drags as a set, and folders drag onto other folders to re-nest
(cycles and no-op moves are rejected — no highlight, drop ignored).
A visual is renamed from the sidebar without opening it: hovering its
row reveals a pencil (always shown on touch), and clicking it swaps the
name for an inline box — Enter / blur commits, Escape cancels, a blank
name is ignored. The rename is catalogue metadata like a move, so it
doesn't bump the visual's updated time or mark its preview stale.

Folders are listed alphabetically until the user says otherwise. A
folder dragged onto the *middle* of another folder's row nests inside
it, as above; dragged onto the top or bottom quarter of a row it takes
that position among the row's own siblings instead, and an insertion
line — rather than the nest highlight — shows where it will land. Hand
placement sticks: the first such drop in a sibling group freezes the
alphabetical order everyone was already looking at and moves only the
dragged folder, so nothing else jumps. Every folder list follows the
result, the Move… pickers included. Later folders created in that group
are appended at the end; nesting a folder somewhere else forgets its
position, returning it to alphabetical among its new siblings. Visuals
nested under a folder stay alphabetical — the table's own sort controls
are the way to re-order those.

Selecting a folder in the sidebar shows the visuals of its entire
subtree — descendant folders included — in both the grid and table
views. "All visualizations" shows everything; clicking the sidebar's
empty space — below or between the rows, not on one — shows only the
visuals that aren't in any folder (the page heading reads "Not in a
folder"; no folder row is highlighted), so what still needs cataloguing
is one click away. That
selection is a URL state (`?folder=unfiled`) like any folder and is
remembered across visits the same way. Checking one or more visuals (the card checkbox in grid view,
the row checkbox in table view) raises a bulk-action bar above the
listing with **Move…**, **Duplicate**, **Download**, **Delete** and
**Clear**. The first three are ordinary (brand-colored) buttons,
**Delete** is red throughout — including the edges the filled button
would otherwise inherit from the brand style — and **Clear**, which
only undoes a selection, is a plain text link.

**Previews refresh themselves.** A card's picture is captured when the
visual is saved, and the visual remembers when (`thumbnailAt`, stamped
only by a capture that actually produced a picture). Whenever the
listing changes — a folder is opened, a search or data-set filter
narrows it, a visual lands in it — every listed visual whose preview is
missing or provably stale is re-rendered in a hidden offscreen embed,
one at a time, and its new picture stored without touching
`updatedAt`. "Provably stale" means the stamp is behind the visual's
last save (a save mid-render keeps the old picture and the old stamp),
behind the data set's latest version, or absent altogether (saved
before stamps existed) — or, whatever the stamp says, the stored
picture is far too small to be a capture of the chart (its longest
edge under 60% of the 480px every capture scales to, or of a smaller
fixed canvas's own longest edge): the mark of a capture taken from the
chart's unmeasured first frame by older builds, which the offscreen
re-render replaces once. The card being re-rendered shows a small
spinning refresh badge over its picture, and reads "Rendering
preview…" in place of "No preview". Each visual is attempted once per
session per (save, data version), so one that can't render doesn't
burn its timeout on every visit; the session-only example visuals are
skipped, since their stamp could never persist. Leaving the library
stops the run at once, restoring the editor's draft keys before the
editor mounts. The hover refresh button on a card still forces a fresh
capture — the recovery for a picture that captured badly even though
its stamp reads as current — and the header's **Regenerate N previews**
still fills missing ones in bulk.

**Trash.** Deleting a visual — the card's trash icon or the bulk bar's
**Delete** — moves it to the Trash immediately, with no confirm step:
the Trash is a round floating can fixed to the bottom-right of the
library page, badged with how many visuals it holds, and restoring one
is a single click there. A trashed visual carries a `deletedAt` stamp
(sparse; no storage version bump) and keeps its row, thumbnail, embed
instances, published files and data set: nothing cascades until it is
purged. While trashed it is hidden from the grid, table, folder tree,
data-set filter, name-collision check, "Regenerate previews" count and
library-bundle export (`liveVisualsAtom` is what every listing reads;
`visualsAtom` still holds it for id lookups, reference sweeps and
writes), `/editor/<id>` bounces to the library like an unknown id, and
`/embed/<id>` shows its not-found state (published static embed files
are untouched). The Trash panel lists trashed visuals newest-first
with **Restore** and **Delete forever** per row and **Empty trash**
(red) in the footer, which asks once inline before purging. Restore
puts a visual back at the root if its folder has since been deleted
and as "Name (restored)" if a live visual has since taken its name.
Purge — Delete forever / Empty trash — is where the old delete cascade
runs: unpublish embeds, drop embed instances, hard-delete the row,
sweep data sets no remaining visual (trashed ones included)
references. Nothing expires on its own; the user empties the Trash.
(`lib/visualTrash.ts`, `store/useDeleteVisuals.ts` — `useTrashVisuals`
/ `useRestoreVisuals` / `usePurgeVisuals`, `library/TrashButton.tsx`.)

**Download** writes the
checked visuals — with their data
sets, folder chains and custom themes — as a library bundle, the same
JSON Settings → Sharing imports (see "Single-file distribution &
library bundles"), so a single chart can be handed to a colleague
without exporting the whole library. One checked visual downloads as
its own name sanitized to a filename (`q3-revenue.json`); any other
count downloads as `library-bundle.json`. The bundle is read through
the storage adapter, so it is correct in server mode as well; the
button reads "Downloading…" while it builds and reports a failure
beside itself rather than losing the selection. Selection is scoped to
what's visible: changing folder, filter or search drops any checked
visual that scrolls out of the result set, so a bulk action can never
catch a hidden row. The folder sidebar is drag-resizable via the handle on its
right edge (208–480 px; width persists across reloads, independent
of the editor sidebar's width). Embedded iframes
sync via an embed-instances mechanism so live previews update when
the source visual's dataset version changes.

### Export & embed

One modal ("Export this visualization", `components/ExportModal.tsx`)
with two tabs and, at the left of the tab row, a **Download JSON**
button. Download JSON isn't a tab — it writes this one visualization
(with its data set, folder chain and custom theme) as a library bundle
immediately, the same file the library page's bulk **Download**
produces and Settings → Sharing imports, named after the *saved*
visual. The build reads through the storage adapter, so it is correct
in server mode too; failures report beside the button.

**Embed** produces `<iframe>` snippets pointing at
`/embed/<visualId>` on the same origin (cross-origin embedding is not
supported, and the tab says so). A **Pin behavior** radio chooses
between *live updating* (always renders the dataset's latest version)
and *pinned* (appends `?v=<versionId>`, frozen forever). A **Render
legend as a separate iframe** checkbox splits the output into two
snippets — `?part=chart` and `?part=legend` — so the legend can be
placed independently in the host page. Iframe dimensions are seeded
by measuring the live on-screen chart / plot area / legend subtree, so
the embed inherits the size the user sees (fixed fallbacks when a
piece can't be measured). The snippets are editable textareas: hand
edits survive until an option that rebuilds the snippet changes.
When the visual has a data table (§10b) it renders under the chart in
the embed (in the chart part of a split embed), or as the embed's Data
tab when placed in a tab. Copying a snippet
records an embed instance, which is what lets live
embeds follow later version uploads; the library's Data set column shows
each instance's pinned version and when its snippet was last exported.
The "Pin to current version" option names the version being pinned with
its upload date and note.

**Editing a published visual is flagged twice.** The landing page's
Pin State column reports publish reality per instance; the editor
adds the two signals a user in the middle of editing actually sees.
Opening a visual that has at least one PUBLISHED instance (a publish
record with live urls — a copied-but-unpublished snippet does not
count, its urls are dead) puts up an acknowledge-to-continue notice —
"This visual is already embedded. Edits you make here will affect
published content." — with **I understand** (stay) and **Go back**
(return to the library). While that visual stays open, the chart
viewport wears a 4 px purple frame as the standing reminder. The
notice re-appears on a later re-entry but not for a publish the user
just made from the Export modal, and the frame costs no layout (an
inset shadow, not a border) so it can't shift the export/embed size
defaults measured off the viewport.

**Export image** renders the chart in a preview iframe and saves
it as **PNG**, **JPEG**, **SVG**, or **PDF**:

- **Include data table** — shown only while the visual has a data
  table on; adds the table under the chart (§10b).

- **Save as** — the Save button opens the browser's own Save-as
  dialog where the browser has one (File System Access API: Chrome,
  Edge), so the user names the file and picks the folder; the
  browser remembers the folder last used for an image export. The
  dialog is requested FIRST, in the click, because the capture can
  take seconds and the browser refuses to open a picker once the
  click's activation has expired. Cancelling the dialog exports
  nothing (no error) and leaves the modal open. Once the file is
  written the Export modal closes itself; a failed capture keeps it
  open with the error shown so the user can retry. Browsers without the dialog (Safari, Firefox)
  get a plain download into the downloads folder. Either way the
  suggested filename is the saved visual's name slugified the same
  way the JSON bundle download is (`sanitizeVisualFilename`), never
  its id. The two-step pick / write helper lives in
  `lib/saveFile.ts`.
- **Size** — Width / Height inputs plus a **Units** picker of
  `px` / `in` / `cm`. The unit is display-only: sizes are stored,
  dragged, and exported in px, and the picker just converts what the
  inputs show at the CSS-standard 96 px/inch. The chosen unit persists
  (`exportUnitAtom`), so it's the default for the next export. Both
  dimensions clamp to 50–4096 px (the same bounds the drag-resize
  handles on the preview enforce), and a **Lock aspect ratio**
  checkbox derives one from the other. The size a visual was last
  successfully exported at is remembered and restored on reopen;
  with none saved, the export seeds from the editor's CURRENT
  on-screen chart size so absolute-pixel title offsets export where
  the user placed them.
- **Resolution** (raster formats only — SVG is vector) — a 1×–4×
  multiplier, silently clamped down when width × ratio would exceed
  the browser's canvas limits.
- **DPI stamping** — PNG and JPEG files are stamped with their true
  resolution (96 × the multiplier) by `lib/imageDpi.ts` before
  download. Without the stamp, physical-size consumers (PowerPoint,
  Word, print layouts) guess a DPI and a 2× export lands at double
  size and gets shrunk to fit; with it, a chart exported at "6.5 in"
  inserts at 6.5 inches. PDF export takes the same route — rasterize,
  then wrap in a one-page PDF whose MediaBox is the px size converted
  to points at 96 dpi.
- **Capture timing** — the preview iframe is a cold-booting embed app,
  so the exporter waits for webfonts to settle, every panel to be
  sized, and the serialized markup to stay byte-identical across
  three consecutive polls before capturing. Grabbing the first sized
  frame would serialize a fallback-font layout whose spacing differs
  from the settled editor render.

**`/export/<visualId>`** runs the same pipeline (`lib/exportImage.ts`,
`renderExport`, which the Save button also calls) with no one at the
dialog, for a script or headless browser. Query: `format=png|jpeg|svg|pdf`
(default png), `v=<versionId>` to pin a version, and `width` / `height`
(px) / `ratio` (the multiplier) to override the size. Without them a
fixed canvas size exports as the dialog seeds it, and any other visual
at the dialog's size when it can't measure the editor (650 × 400), both
at the dialog's default 4× (`exportSizeFor`). The file lands base64 in
`<pre id="export-result">` with `data-mime`, `data-bytes`, `data-width`,
`data-height`, `data-pixel-ratio` and `data-ms`; a failure lands in
`<pre id="export-error">`. Nothing is saved or uploaded.

This is the other half of the points convention in §7: physical export
sizing + DPI stamping is what makes a size-12 label land as true 12pt
in the destination document.

### Single-file distribution & library bundles

`pnpm build` emits ONE self-contained `dist/index.html` (JS + CSS
inlined, unminified so checked-in diffs stay reviewable) meant to be
shared by email/chat and opened straight from disk. Under `file://`
the router switches to hash-based URLs (`index.html#/editor/new`);
served over http(s) it keeps clean paths. The header shows a version
chip (`v1.10`, `v1.11`, …: package.json's major.minor via a
compile-time define; a pre-commit hook steps the minor on every
commit) whose tooltip is the build timestamp, so any shared copy
self-identifies.

**Bundle your library as JSON** (Settings → Sharing → "Download
bundle") serializes the whole library — visuals with previews, their
data sets, the folder tree, custom themes — into one
`library-bundle.json`. It is a backup, a share artifact, and a build
seed, all the same file. The ephemeral sandbox examples (below) are
NOT included — a backup is the user's own work; adopted examples are
the user's and export like anything else. (The library page's
per-visual Download, by contrast, happily bundles a sandbox example
the user explicitly selected.)

**Import a bundle** (same page) reads one back in, always
ADDITIVELY — an import can never replace or overwrite work already
in the library:

- **Folders** match existing ones by full path (the chain of names
  from the root), so a shared "Q3 ▸ Drafts" lands in the recipient's
  own "Q3 ▸ Drafts" rather than a second copy; anything unmatched is
  created under the resolved parent, nesting intact. An import can
  name a **destination folder** (the header's import does; see
  below): then whatever would have landed at the root — a visual
  with no folder, the top of an incoming chain — lands in that folder
  instead, and the path matching runs beneath it (an incoming
  "Drafts" imported into "Q3" matches "Q3 ▸ Drafts", not a root-level
  "Drafts"). The Sharing page's import names none, so it lands at the
  root as before.
- **Visuals** are always added. An incoming id survives when it's
  free locally (restoring your own backup into an empty library keeps
  stable ids) and takes a fresh one on collision. Importing the same
  bundle twice therefore yields duplicate visuals — accepted, because
  the alternative is silently overwriting the user's edits.
- **Data sets** dedupe byte-identically against the store (same rule
  as upload dedup), so re-shared data never multiplies; visuals
  repoint to whichever copy won, version pin included.
- **Themes** merge by id: an id the recipient already has is skipped,
  never overwritten. System themes are ignored — every build ships
  them. The starred default theme is adopted only when the recipient
  has never picked one.
- A bad file is rejected up front and changes nothing, and the user
  is told every problem found (one per line, so a hand-written file can
  be fixed in one pass). Rejected: a missing, empty or unsafe id on any
  visual, folder, data set, version or theme (the server's own id rule:
  1–128 characters of letters, digits, `_` and `-`); a visual whose
  `datasetId`, `createdAtVersionId` or `folderId` doesn't resolve INSIDE
  the file; a folder whose `parentId` doesn't; a data set whose
  `latestVersionId` names no version of its own, whose key and `id`
  differ, with no versions, with a variable of unknown type, or with a
  row cell that isn't a string. The visuals' config blobs (encodings,
  channel configs, labels) are not validated — older bundles
  legitimately lack keys there, and the load-time migrations fill them.
- The merge is pure; the caller lands the result through the Jotai
  atoms, so the library updates without a reload and, in server mode,
  the diffing HTTP adapter transmits only the imported items. The
  import AWAITS those writes before reporting success: a storage
  failure (a server rejecting a PUT) is reported as such, with a
  prompt to reload, rather than as "Imported N visualizations" over
  work that will be gone on the next load.

The same import is also reachable from anywhere: the header's **New
visualization** control is a split button. Its main segment starts a
new visualization on a clean slate (no data set bound, at the root);
its arrow segment opens a menu — in the editor with a data set bound,
**New with this data set** (keeps the data, clears encodings and
styling) and **New with a new data set** (a clean slate, like the
main segment), and everywhere **Import from JSON…**, which opens the
file picker for a bundle or a single visual's Download JSON (the same
format) and runs exactly the merge above (`store/importBundle.ts`,
shared with the Sharing page).

Each menu item first asks **what to call the result and where it
should go**: a name box above the same destination-folder picker Move
and Duplicate use, pre-set to the open visual's folder in the editor
or to the folder being browsed on the library page (root otherwise).
For the two "New…" items the box starts with the name the visual
would otherwise get — "Untitled" (`UNTITLED_VISUAL_NAME`), selected
whole so typing replaces it — and refuses a TYPED name another live
visual already has: the same rule as the Save button, and the only
place the rule can be applied before autosave would file the
collision; a name in the Trash is free. The untouched default is let
through even beside an existing "Untitled", exactly as the editor's
reset + autosave would have filed it. Name and folder ride the route
as `/editor/new?name=…&folderId=…` (the default name stays off the
URL; the reset produces it); the name seeds the draft title and the
folder is held in a draft atom (`newVisualFolderIdAtom`)
that only the FIRST save reads — after that the stored visual's folder
is the truth, so a Move in the library is never undone by a later
autosave; a folder deleted between the pick and the save means the
root, never a dangling id. Until that first save the editor's folder
breadcrumbs already show the pick. For the import, the file is chosen
first (the native picker has no room for a question) and the dialog
follows once there is something to place: the name box appears only
when the file holds exactly ONE visual (a single "Download JSON"),
seeded with that visual's name — a library bundle has nothing to call
by one name — and a clash there only warns, since an import may
duplicate by design. Both answers go to the merge as described above.
The folder list appears only when the library has folders, and when
the dialog would have nothing to ask at all (a multi-visual file into
a folderless library) it is skipped; the main segment never asks.
Because the header has no status
line, an import's result is acknowledged in a modal ("Import
complete" / "Import failed"), which away from the library also offers
**Open library** to go look at what landed. The Settings pages hide
the control (configuring the tool, not making charts), so there the
Sharing page's own button remains the way in.

The same file also ships **bundled examples**: renamed to
`src/seed/examples.json` (the public seed) or the gitignored
`examples.local.json` (a private override for internally shared
builds) and rebuilt, it puts a populated library in front of a
first-run user. How it lands depends on which seed and which mode:

- **Public seed — an ephemeral sandbox, browser-local and server mode
  alike.** The examples are overlaid in memory at boot and never
  written to storage (`lib/exampleOverlay.ts`; in server mode the HTTP
  storage adapter is the seam, so every account on a server sees them
  and none can save over the shipped ones). They appear in the library, open, edit,
  re-theme, move between folders and delete exactly like real work —
  and every bit of that is session-only: a reload brings the shipped
  examples back precisely as shipped. Seed rows are recognized by an
  id set derived from the bundle (nothing is flagged onto the objects
  themselves): the storage layer merges them into the visuals /
  folders / datasets reads and strips them out of the matching
  writes, so editing one dirties memory alone. Their thumbnails come
  from the bundle too, never from the thumbnail side-table. The
  user's own work is untouched by any of this and persists exactly as
  it always has.
  - **The shipped folder is a fixed shelf.** The bundle's folder
    ("Stock Examples") is pinned to the bottom of the library's folder
    tree regardless of name or hand-placed order, drawn in plain
    heading ink rather than the brand purple of user folders, and is
    read-only as a folder: no rename (double-click or menu), no drag,
    no reorder, no subfolder, no delete, and user folders can't be
    nested inside it or ordered against it. Its contents are ordinary
    rows — the examples open, edit and move out like anything else,
    and a visual can still be dropped into it. Identity is the PUBLIC
    seed's folder-id set, registered at boot whichever seed the build
    loaded (`lib/stockFolders.ts`), so a private override that shares
    the id and a library that holds the folder durably get the same
    pin — and the same name: the folder is read under the public
    seed's name at every folder load, whatever a library stored it
    as, and re-persists under it on its next save.
  - **Copies are real work.** Duplicating an example (or otherwise
    saving something of your own that points at one) persists in
    full, so whatever it still references in the overlay — its data
    set, its theme, the folder it sits in, and that folder's parent
    chain — is *promoted* into durable storage at that moment.
    Without it the copy would dangle on the next reload, when the
    overlay no longer supplies them.
  - **A library seeded by the older behaviour keeps one copy.** Any
    bundled row whose id is already in storage is adopted at install:
    never overlaid, never stripped, simply the user's. Under the new
    semantics examples someone deleted long ago do come back — the
    sandbox is permanent — but never as a second copy. In server mode
    the server's rows aren't known before first paint, so adoption
    happens as each collection loads, and every write that consults
    the adopted set (and every read of a seed dataset) first waits for
    the folders, themes and dataset-index loads — a copy made in the
    first second must never PUT pristine bundle rows over a library's
    own, possibly edited, copies.
- **Private override — persisted once.** Writes go through the storage
  adapter, so in server mode a self-hosted library gets the private
  examples in SQL and backed up with everything else. A library that
  already has visuals is never touched, and a recipient who deletes
  the examples stays clean (an applied-seed marker keyed on the
  export timestamp prevents re-seeding until a genuinely new export
  ships).

Either way, bundles exported before the 2026-08 px→pt font switch get
the same font-size reset a stored library gets on migration. The
checked-in public seed may be empty, which makes both paths a no-op.

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
   dash styles regardless. The same rule follows the connection field
   into areas: a line chart converted to areas keeps its connection
   mapping, so its layer fills also stay clean until per-category
   patterns are explicitly picked (matching the Pattern panel's
   compound form).
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
    solver keeps column widths / row heights uniform). The scale
    option that drove the anchoring is gone too; `makePositionScale`
    takes no spacing options.

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
