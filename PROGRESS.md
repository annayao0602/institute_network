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

## 2026-10-26: Search results dropdown

### Changes
- **Dropdown under the search bar** listing every matching author, with the same matching rules as the dimming (search text plus any active legend filter).
  - Each row shows a linked/isolated color dot, the author's name, and a second line. If the name matched, that line is the publication count. If only a title matched, it's the first matching title, so it's clear why the author is listed.
  - Name matches are listed first, then title-only matches, each alphabetically. The list scrolls (max 50% of the screen height). With no matches it shows "No matching authors".
- **Choosing a result zooms in on that node.** It uses the same `focusNode()` as clicking a node in the network: the node becomes the camera's follow target and center of rotation, and the tooltip shows that author marked "focused". When no node was focused, the camera also moves 4× closer (`zoomScale: 4`). When a node is already focused, it pans to the new node at the current zoom, so choosing several results in a row doesn't keep zooming in. Clicking the background releases the focus as before.
- **Opening and closing:**
  - It opens while typing in the search bar and again when the bar is refocused with text in it.
  - It closes after a choice, on Escape, or on a click outside the search box.
  - The search text and dimming stay after a choice.
- **Keyboard:** ↑/↓ move through the results and Enter picks the highlighted one (or the first one if none is highlighted).
- Results are picked on `mousedown` rather than `click`, so the choice registers before the search bar loses focus and hides the list.

### Verified (headless Chrome, WebGPU)
- "covid" gives 41 matching authors and 41 dropdown rows, with the matching title shown for title-only matches.
- Clicking a result (Amar Dhand) focused that node and moved the camera from distance 595 to 151. The dropdown closed and the tooltip showed the author, with "covid" still in the search bar.
- A second pick with ↓ + Enter switched focus to another author without zooming further (distance stayed 151).

### Data note
- "Albert-Ĺaszló Barabási" shows a stray accent on the L. It's in the source data (`cleaned_northeastern_network_science_institute.csv`, from OpenAlex), not a display bug.

## 2026-10-29: Clear search button (layout part superseded)

### Layout (superseded, see 2026-10-29 (2) below)
- This entry set `componentMainGravityScale: 6`, `componentSingletonGravityScale: 0.1` and `componentForces: 'halo'` directly inside `layout: {...}`. **They never took effect.** Helios only reads layout options from `layout.options`, so the page kept running Helios's defaults. The before/after layout numbers recorded for this entry were differences between random starting layouts, not an effect of the settings.

### Search: "Clear search" button
- The search bar now has a **Clear search** button next to it that is always visible.
  - With an empty search bar it is disabled and its text is grey.
  - Once anything is typed, its text turns dark and it can be clicked.
  - Clicking it does what the old built-in "x" did: it empties the search, clears the dimming, match count and dropdown, and keeps the cursor in the search bar. Any legend filter stays.
- The browser's built-in "x" in the search input is hidden, so there is only one clear control. Escape still closes the dropdown.
- The search panel is wider (300 → 380 px) to fit the button.

### Verified (headless Chrome, WebGPU)
- Button:
  - Disabled with grey text when empty. Clicking it then does nothing.
  - After typing "covid": enabled with dark text, 41 matching authors.
  - After clicking it: the search is empty, the count and dropdown are cleared, the button is grey again, and focus stays in the search bar.

## 2026-10-29 (2): Small coauthor groups pulled in; largest component centered in the isolated ring

### What was wrong
1. **Last entry's layout settings were ignored.** They were set at the top level of `layout: {...}`, but Helios reads them only from `layout.options`. A check of the live layout showed it running Helios defaults (largest component 1.5×, `componentForces: 'auto'`).
2. **Nicholas Beauchamp–Sarah Shugars drifting far out: caused by sampled repulsion.** Above 128 nodes (3D), Helios doesn't compute repulsion between every pair of nodes. Each node is pushed by a random sample of about 96 others per step. The push is then one-sided (A samples B but B doesn't sample A), and for two linked authors sitting close together it moves the whole pair. In tests with sampling, the pair sometimes ended up 3–6× farther out than the isolated ring and kept drifting. With exact repulsion it never did (6 of 6 runs).
3. **Even without the drift, Helios can't pull small groups in.** Helios lets you set the pull only for the largest component, plus a base value. Every other component's pull is derived from its size (log scale), and isolated authors go through the same formula. With the defaults, the pair got 0.43× and an isolated author 0.36×, almost the same. So the pair sat on the isolated ring rather than near the center, and no combination of Helios's settings changes that.
4. **Largest component off-center in the isolated ring: random starting positions.** Helios starts every node at a random point in a cube. Isolated authors feel only weak forces and barely move before the layout cools, so the ring keeps its random, lopsided start. The centroid of 29 random points is typically off-center by about 0.2–0.4 of the ring's radius, which matches what was measured under every setting tried.

### Changes (`main.js`)
- **Layout options moved under `layout.options`.** They now take effect.
- **Exact repulsion:** `exactRepulsionThreshold3D: 1024` (Helios default 128). Every node is pushed by every other node each step. At 146 nodes that's about 21k pairs per step, which is cheap. It stays exact until the network passes 1,024 authors.
- **Gravity set per connected component by the page:**
  - Largest component: `GRAVITY_LARGEST = 6`.
  - Every other coauthor group: `GRAVITY_CONNECTED = 4`.
  - Isolated authors: `GRAVITY_ISOLATED = 0.1`.
  - Components are computed in the page (union-find over the coauthor links). The values replace the scales Helios computes, written just before Helios uploads them to the GPU (`useComponentGravity()`).
- **Seeded starting positions** (`seed_position` node attribute, applied with `helios.setLayoutPositionsFromNodeAttribute`):
  - Isolated authors start evenly spread on a sphere of radius 350 (Fibonacci sphere), so the ring is balanced from the start.
  - The other coauthor groups start evenly spread at radius 150, each group kept together.
  - The largest component starts in a small random ball at the center.

### Complications (logged as asked)
- **The gravity override relies on helios-web internals.** Helios has no public setting for per-node or per-component gravity, so `useComponentGravity()` patches internal parts of the layout: `helios._activePositionDelegate`, its `_webgpu`/`_webgl` backends, and their `syncTopology()` call, which receives `componentGravityScale`. This was checked against helios-web 0.10.9, the version pinned in `package.json`.
  - **If helios-web is upgraded, re-check this.** If the delegate is missing, the page logs `Layout internals changed; using Helios default component gravity.` and falls back to Helios's own scales. Small groups such as Beauchamp–Shugars would then sit out with the isolated ring again. Exact repulsion and the seeding use public options and keep working.
- **Helios replaces its backend objects at times** (for example, when the GPU device changes), so the patch hooks the `_webgpu`/`_webgl` properties and patches whichever backend gets assigned.
- **Small groups end up just outside the largest component, not inside it.** The largest component's nodes repel them, so with pull 4 they settle at its edge. A pull equal to or above the largest component's (6) would start pushing the core around, so 4 was kept.
- **The camera's automatic fit covers 95% of nodes** (Helios default `autoFitCoverage: 0.95`). After the layout settles, one or two isolated authors can sit at, or just past, the edge of the screen. This predates these changes and was left as is.

### Verified (headless Chrome, WebGPU; 3 page loads each, measured at 25 s)
Distances are fractions of the isolated ring's median radius, measured from the largest component's centroid.

| | Helios defaults | Now |
|---|---|---|
| Beauchamp–Shugars distance | 0.70–1.03 with exact repulsion; up to 3.2+ with sampling (still drifting) | 0.32–0.38 |
| Farthest node of any small group | ≈1 | 0.35–0.38 |
| Largest component's offset from the isolated ring's center | 0.19–0.40 | 0.09–0.15 |
| Isolated authors, nearest–farthest | 0.66–1.30 | 0.86–1.13 |

- The largest component's outer edge is at 0.23–0.27 of the ring's radius. Small groups now sit just outside it.
- Screenshots show the connected authors in the middle of the screen with isolated authors evenly around them.
- Search, the results dropdown (pick and zoom, keyboard pick) and the Clear search button all still work as before.

## 2026-10-29 (3): Connected authors spread out so links are visible

### Changes (`main.js`)
- **Longer coauthor links:** `linkDistance: 14` (`LINK_DISTANCE`; Helios default 1). Each link is a spring, and its rest length was so short that dense groups collapsed into blobs where authors overlapped. Now each author has visible space between it and its coauthors.
- **Gravity rebalanced:**
  - Largest component: 1 (was 6).
  - Other coauthor groups: 0.8 (was 4).
  - Isolated authors: 0.2 (was 0.1).

  A group's size relative to the isolated ring goes roughly with (its pull / the isolated pull)^(1/3). The old 6 : 0.1 ratio squeezed the connected authors into about a quarter of the ring's radius. The new ratio lets them fill about half of it, so they take up more of the screen. The ratios are what matter: the largest component still has the strongest pull and stays at the center, small groups sit just outside it, and isolated authors still form the outer ring.

### Tried and not kept
- **Lower gravity alone** (largest 1, links unchanged): the component got bigger, but authors within each dense group stayed just as tight. Only the gaps between sub-groups grew.
- **`linkDistance: 8`, gravity unchanged:** about 3× the spacing, but the three sub-communities of the largest component merged into one ball and the small groups were lost against it.
- **`linkDistance: 20`:** the springs got longer than the range where repulsion keeps neighbors apart, and the largest component turned into one tangle with its sub-communities no longer visible.
- **`kRepulsion: 2`:** little difference. Stronger repulsion also pushes the isolated ring out, so spacing relative to the screen barely changes.

### Verified (headless Chrome, WebGPU; 3 page loads, measured at 20–25 s)
Distances are fractions of the isolated ring's median radius.

| | Before | Now |
|---|---|---|
| Distance from each connected author to its nearest neighbor (median) | 0.024 | 0.10 |
| Same, 10th percentile (the tightest spots) | 0.021 | 0.05–0.06 |
| Link length (median) | 0.041 | 0.23 |
| Largest component's outer edge | 0.25 | 0.50–0.57 |
| Small groups, farthest node | 0.37 | 0.61–0.66 |
| Nearest isolated author | 0.87 | 0.94–0.98 |
| Largest component's offset from the ring's center | 0.09–0.15 | 0.05–0.08 |

- The three sub-communities of the largest component and the small groups (Beauchamp–Shugars at 0.57–0.64) are still clearly separate in screenshots.
- The isolated ring settles at radius ≈357 layout units, close to its seeded 350, so the seed radii didn't need changing.
- **Note:** isolated authors stay outside the connected authors in 3D, but a few can appear drawn over the network from some viewing angles, because they're in front of or behind it. Rotating the view separates them.

## 2026-10-29 (4): Info box bullets

- The info box (bottom left) now has a bulleted list under the network stats, in a slightly lighter grey so it reads separately from the stats line:
  - "Node size scaled based on number of coauthors." (added back). Node size is mapped from the GML `degree` attribute, which is the number of distinct coauthors.
  - "Hover a node to see the author and their publications."
  - "Click a node to focus and orbit around it; click the background to release."
- Checked in headless Chrome: the three bullets render under the stats line.

## 2026-10-29 (5): Ego network toggle

### Changes
- **"Ego network" toggle in the tooltip (bottom right), next to the author's name.**
  - It's shown when the tooltip shows the selected author (clicked, or picked from search results). While another node is hovered and the tooltip shows that author instead, the button is hidden.
  - **On** (filled blue): everything except the selected author and their coauthors is dimmed. Links between any two of them stay bright, including links among the coauthors, so the whole ego network is visible.
  - **Off** (outlined): the dimming is removed.
- **Uses the existing dimming.** The ego network is one more condition in `applyFilters()`, alongside the search text and the legend filter.
  - All active conditions combine: with a search or legend filter also active, only ego-network authors that also match stay bright. The search dropdown lists only those, and the "N matching authors" count counts only those.
  - The ego network alone shows no count.
  - As with the other filters, dimmed nodes can't be hovered or clicked.
- **Moving through coauthors:** with the ego network on, clicking a highlighted coauthor (or picking one from search) moves the ego network to that author, with the toggle still on.
- **Clicking the background** releases the selection and turns the ego network off.
- **Coauthor count in the tooltip:** the count line now reads "N publications · N coauthors" (plus "· focused" for the selected author). Coauthors are counted from the coauthor links (`coauthors` in `main.js`).

### Verified (headless Chrome, WebGPU)
- Picked István A. Kovács from search (3 coauthors in the GML).
  - The tooltip showed "9 publications · 3 coauthors · focused" and the toggle, off.
  - Toggled on: the "Linked authors" legend filter then matched 4 authors (Kovács + 3 coauthors), down from 117.
  - The search dropdown for "a" listed only those 4.
  - The screenshot shows Kovács and his coauthors bright with their links, and the rest dimmed.
- Picked his coauthor Marc Santolini (2 coauthors): the ego network moved to him (3 authors) with the toggle still on.
- Toggled off: back to 117.
- Clicked the background: the selection was released, the tooltip hidden, and the dimming gone.

### Note
- Picking a search result zooms in 4×, so some of the author's coauthors can be off-screen. The camera doesn't reframe to fit the ego network.
