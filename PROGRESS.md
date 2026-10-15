# Progress

## 2026-10-15: Helios coauthorship network

### What was built
- **`build_network.py`** converts `cleaned_northeastern_network_science_institute.csv` into `institute_data/coauthorship_network.gml`.
  - Nodes are authors (146). Two authors are linked when they appear on the same publication (408 links). The edge `weight` is the number of publications they share.
  - Node attributes: `label` (author name), `author_id`, `publications`, `degree`, `isolated` (1 = no coauthors in this dataset), `component_size`, `name_known`.
  - Authors with no known name are labeled `Unknown author <AuthorId>` (13 authors).
  - Rerun with `npm run build-network` (or `/opt/anaconda3/bin/python build_network.py`) whenever the cleaned CSV changes.
- **`index.html` + `main.js`** load the GML into Helios Web (`helios-web@0.10.9`, `helios-network@0.10.4`):
  - 2D GPU force layout.
  - Node color: blue for authors with coauthors, orange for isolated authors.
  - Node size: number of coauthors. Edge width: number of shared publications.
  - Hover labels, plus Helios UI panels for mappers, layout, filters and selection.
- **`package.json`** installs the two Helios packages.

### Running it
```bash
npm install          # also copies Helios's worker files into ./assets
npm run serve        # then open http://localhost:8000
```
The page must be served from the repo root. Opening `index.html` directly from disk (`file://`) won't work.

### Unconnected nodes: possible, and they are shown
All 29 isolated authors are in the GML (nodes with no edges), and Helios draws them. The GPU force layout's gravity keeps them near the main clusters instead of letting them drift off screen. Verified in headless Chrome (WebGPU renderer): the page reports 146 authors, 408 links and 29 isolated authors, and the orange isolated nodes are visible.

### Decisions and gotchas
- **GML written by hand, not with `nx.write_gml`.** networkx sets the GML `label` to the node key (the AuthorId) and escapes accented characters as `&#769;` entities. Helios uses `label` for node labels and does not decode entities, so names showed up as IDs or as text like `Istva&#769;n`. The script writes UTF-8 GML directly. GML has no escape for `"`, so any double quote in a name is replaced with `'`.
- **No bundler; an import map instead.** `helios-web` imports the bare specifier `helios-network`, and the import map in `index.html` points both packages at `node_modules`.
- **Not loaded from a CDN.** helios-web creates its layout workers with the hardcoded root path `/assets/layoutWorker-*.js`. From a CDN that path resolves to the CDN's root and is cross-origin, which browsers block for workers. `npm install` therefore copies `node_modules/helios-web/dist/assets` to `./assets`. If you upgrade helios-web, rerun `npm install` so the hashed worker filenames match.
- **Isolated count read from the GML text.** Reading node attribute buffers after Helios starts rendering throws ("Cannot perform attribute metadata lookup … during buffer access"), so `main.js` counts `isolated 1` lines in the file instead.
- **Browser sessions disabled (`storage: false`).** Each page load starts from the GML file, so a rebuilt network isn't hidden by a saved browser session.
- **Mappers panel shows the wrong type.** It displays the node color mapper as "Colormap" even though the categorical mapping set in `main.js` is the one in effect (confirmed through `helios.behavior.mappers`). Clicking "Apply" in that panel will probably replace it with what the panel shows (not tested).
- `node_modules/` and `assets/` are gitignored. `institute_data/coauthorship_network.gml` is not ignored, so the page works from a fresh checkout without the CSV.

## 2026-10-15: 3D layout, hover tooltip, click-to-focus

### Changes
- **3D layout**: `mode: '3d'` with the same GPU force layout. Isolated authors still stay in view.
- **Names only on hover**: permanent labels are off (`labels: { enabled: false }`). Helios's hover behavior still draws the hovered author's name next to the node.
- **Tooltip (bottom right)**: hovering a node shows the author's name, publication count and a scrollable list of publication titles.
  - `build_network.py` now also writes `institute_data/author_publications.json` (author ID → sorted list of titles). Titles are kept out of the GML because GML can't escape quotes and a long list would make the file hard to read.
  - When nothing is hovered, the tooltip shows the focused author (marked "focused"). With no focus, it's hidden.
- **Larger nodes**: the node size range went from 4–14 to 6–18 (still scaled by number of coauthors).
- **Click to focus**: clicking a node calls `helios.cameraFollowNodes([node])`. The camera pans to that node and keeps it as the target (the center of rotation), tracking it if the layout moves it. Clicking the background calls `cameraFollowNodes([])`, which releases the focus and reframes the whole network. Clicking another node switches the focus to it. Clicking an edge does nothing.
- **Layout of the screen**: the Helios UI panels moved to the left dock so the bottom-right corner is free for the tooltip. The info box moved to the top right, next to the camera buttons.

### Verified (headless Chrome, WebGPU)
- Page runs in 3D mode. No names are drawn until a node is hovered.
- Hovering a node shows its name on the canvas and the bottom-right tooltip with its publication titles.
- Clicking the node makes it the camera's follow target and centers it. The tooltip stays on that author after the mouse moves away.
- Clicking the background clears the follow target and hides the tooltip.
- Not tested in the automated run: rotating by dragging while a node is focused. The follow target is the camera's target point, so dragging should orbit around it.

### Notes
- Author names and IDs are read once, before Helios starts rendering (same buffer-access restriction as the isolated count).
- Helios's click event is ignored when the camera moved during the press, so a drag to rotate doesn't count as a click on the background and doesn't release the focus.

## 2026-10-15: Search, clickable legend, panels removed

### Changes
- **Publication total in the stats line**: "146 authors, 347 publications, 408 coauthor links, 29 isolated authors". `build_network.py` writes `publication_count` (unique `PublicationId`s) into the GML header, and `main.js` reads it from the file text.
- **Helios control panels removed** (no more `HeliosUI`). The small camera buttons at the right edge are Helios's quick controls, not panels, and are still there.
- **Search bar (top right)**: case-insensitive substring match against the author name and every publication title of that author. Matching authors stay at full opacity; everything else is dimmed to 0.3. A link stays bright only when both of its authors match. A count ("N matching authors") shows under the box. Clearing the box restores everything.
- **Clickable legend (top left)**: Helios's built-in legend is turned off (`legends: { enabled: false }`) and replaced with an HTML legend labeled **Linked authors** (blue, `isolated = 0`) and **Isolated authors** (orange, `isolated = 1`). Clicking an item keeps only that group bright and dims the other to 0.3. Clicking the same item again clears it. The legend and the search combine: with both set, only authors matching both stay bright.
- **Info box moved back to the bottom left.**

### How the dimming works
Matching nodes and links get Helios's `HIGHLIGHTED` state. `nodeNoStateStyle` and `edgeNoStateStyle` set `opacityMul: 0.3` for everything else while a filter is active, and back to 1 when no filter is active. The `HIGHLIGHTED` style is set to neutral, so matches keep their normal size and color instead of Helios's default highlight look. A clicked node gets Helios's `SELECTED` state, so it also stays bright while a filter is active.

### Gotcha
- Reading a numeric node attribute buffer (`isolated`) fails in the browser even before Helios is created ("Cannot perform attribute metadata lookup … during buffer access"). `main.js` now works out whether an author is isolated from the edge list (`network.edgesView`) instead.

### Verified (headless Chrome, WebGPU)
- No Helios panels are on the page, and the stats line shows 347 publications.
- Searching "zika" gives 1 matching author; the rest dim.
- Clearing the search resets opacity to 1.
- "Isolated authors" gives 29 matches, with the blue nodes dimmed to 0.3. Clicking it again resets opacity to 1.

## 2026-10-15: Filters persist through hover; legend header

### Bug fixed: hovering a node undid the search/legend dimming
- **Cause:** dimming used `nodeNoStateStyle`/`edgeNoStateStyle`. Helios's hover behavior calls `applyOtherElementsState()` on every hover. That rewrites the no-state style back to neutral unless highlights were registered through Helios's internal highlight tracking, which the app's weren't.
- **Fix:** the app now marks the *non-matching* nodes and links with the spare custom state bit (slot 3, `1 << 3`). That slot's style sets `opacityMul: 0.3`. Hovering never touches state-slot styles, so the dimming stays until the search text changes, the search is cleared (the ✕ or deleting the text), or the legend item is clicked again. The `HIGHLIGHTED` and no-state styles are no longer used.

### Dimmed nodes are no longer interactive while a filter is active
- **Tooltip:** hovering a dimmed node doesn't change it.
- **Hover highlight:** the app's hover handler runs after Helios's and calls `helios.hoverNodeState(null, 0)`, which removes Helios's hover enlargement on dimmed nodes.
- **Hover name label:** Helios's label controller reads the hovered node from its internal picking state, which the app can't clear. It gets the label text from `helios.behavior.hover.resolveHoverLabelValue`, and empty text means no label. `main.js` wraps that method to return `''` for dimmed nodes. This replaces a method on Helios's hover behavior, so check it if helios-web is upgraded.
- **Clicks:** clicks on dimmed nodes are ignored. They don't change the focus or the tooltip.
- If the hovered node becomes dimmed when a filter changes, its tooltip is cleared.

### UI
- The legend has a header, "Legend", with the subheader "click to focus".
- Removed "Node size: number of coauthors. Click a legend item to show only that group." from the bottom-left info box. Everything else in the box is unchanged.

### Verified (headless Chrome, WebGPU)
- With "zika" searched, a full mouse sweep over the canvas left the search text and the dimming in place (1 matching author).
- With "Isolated authors" active, hovering 63 different dimmed nodes produced no visible label and no tooltip, and clicking a dimmed node didn't focus it. Matching nodes still show the label and tooltip.

## 2026-10-15: Repository reorganized

### Layout
```
institute_data/    Northeastern Network Science Institute data
  cleaned_institute_paa_8_27_25.csv, cleaned_subinstitute_directory_8_27_25.csv   (source data)
  northeastern_network_science_institute.csv → enriched_… → cleaned_northeastern_network_science_institute.csv
  missing_author_names.csv, missing_publication_names.csv, found_author_names.xlsx, found_publication_names.xlsx
  coauthorship_network.gml, author_publications.json   (generated by build_network.py; read by the Helios page)
department_data/   UVA department data
  UVAdepartments.xlsx, null_cleaned.xlsx, UVA_departments_updated.xlsx, UVA_departments_cleaned_2.xlsx, UVA_departments_cleaned_final.xlsx
root               network.ipynb, department_cleaning.ipynb, build_network.py, index.html, main.js, package.json, PROGRESS.md
```
- The old `data/` folder is now `institute_data/`.
- Every read and write in `network.ipynb` and `department_cleaning.ipynb` now uses the `institute_data/` or `department_data/` prefix. That includes the outputs: the enriched, missing, and cleaned CSVs, `UVA_departments_updated.xlsx`, and `UVA_departments_cleaned_final.xlsx`.
- `build_network.py` reads from and writes to `institute_data/`, and `main.js` fetches from `./institute_data/`.
- Paths are relative to the repo root, so run the notebooks and `build_network.py` from there.

### Git note
The five department `.xlsx` files were committed before `*.xlsx` was added to `.gitignore`. Git now shows them as deleted from the root, and their new copies in `department_data/` are ignored. To keep them in the repo, `git add -f department_data/*.xlsx`. To stop tracking them, commit the deletions.
