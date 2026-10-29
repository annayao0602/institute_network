import HeliosNetwork, { AttributeType } from 'helios-network';
import { Helios, EVENTS } from 'helios-web';

// Both built from the cleaned CSV by build_network.py.
const NETWORK_URL = './institute_data/coauthorship_network.gml';
const TITLES_URL = './institute_data/author_publications.json';

const CONNECTED_COLOR = '#4dabf7ff';
const ISOLATED_COLOR = '#ff922bff';
// Opacity of nodes and links that don't match the current search/legend filter.
const DIMMED_OPACITY = 0.3;

// Layout gravity (pull toward the center), by connected component. The largest
// component gets the strongest pull so it holds the center; the other coauthor
// groups are pulled in next to it; isolated authors get a weak pull, so they
// form a ring around the connected authors. A group's size relative to the ring
// goes with (its pull / the isolated pull)^(1/3), so these ratios also set how
// much of the screen the connected authors fill.
const GRAVITY_LARGEST = 1;
const GRAVITY_CONNECTED = 0.8;
const GRAVITY_ISOLATED = 0.2;
// Rest length of each coauthor link (Helios default 1). Longer links loosen
// dense groups so each author and link can be told apart; much longer (~20)
// and the groups blur into one tangle.
const LINK_DISTANCE = 14;
// Starting positions (layout units). Isolated authors start evenly spread on a
// sphere this far out, so the ring around the connected authors is balanced.
const SEED_RADIUS_ISOLATED = 350;
const SEED_RADIUS_CONNECTED = 150;
const SEED_RADIUS_LARGEST = 60;
const SEED_ATTRIBUTE = 'seed_position';

async function fetchOk(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not load ${url} (HTTP ${response.status}). Run build_network.py first.`);
  }
  return response;
}

const [gmlText, titlesByAuthor] = await Promise.all([
  fetchOk(NETWORK_URL).then((r) => r.text()),
  fetchOk(TITLES_URL).then((r) => r.json()),
]);
const network = await HeliosNetwork.fromGML(new TextEncoder().encode(gmlText));
const publicationCount = Number(gmlText.match(/^\s*publication_count (\d+)$/m)?.[1] ?? 0);

// Read everything the page needs once, before Helios starts rendering:
// reading attribute buffers while Helios renders throws.
const authors = Array.from({ length: network.nodeCount }, (_, i) => {
  const id = network.getNodeStringAttribute('author_id', i);
  const titles = titlesByAuthor[id] ?? [];
  const name = network.getNodeStringAttribute('label', i);
  return {
    name,
    id,
    titles,
    isolated: false,
    searchText: [name, ...titles].join('\n').toLowerCase(),
  };
});
const edgeEndpoints = [];
network.withBufferAccess(() => {
  const pairs = network.edgesView;
  for (let e = 0; e < network.edgeCount; e += 1) {
    edgeEndpoints.push([pairs[2 * e], pairs[2 * e + 1]]);
  }
});
// Same as the GML `isolated` attribute: no coauthor links.
authors.forEach((author) => { author.isolated = true; });
edgeEndpoints.flat().forEach((i) => { authors[i].isolated = false; });
const isolatedCount = authors.filter((a) => a.isolated).length;

// Connected components (union-find over the coauthor links).
const parent = authors.map((_, i) => i);
const findRoot = (i) => (parent[i] === i ? i : (parent[i] = findRoot(parent[i])));
edgeEndpoints.forEach(([a, b]) => { parent[findRoot(a)] = findRoot(b); });
const componentOf = authors.map((_, i) => findRoot(i));
const componentSize = new Map();
componentOf.forEach((c) => componentSize.set(c, (componentSize.get(c) ?? 0) + 1));
const largestComponent = [...componentSize].reduce((best, entry) => (entry[1] > best[1] ? entry : best))[0];
const gravityScale = componentOf.map((c) => {
  if (c === largestComponent) return GRAVITY_LARGEST;
  return componentSize.get(c) === 1 ? GRAVITY_ISOLATED : GRAVITY_CONNECTED;
});

// Starting positions: the largest component in a small ball at the center, the
// other coauthor groups (each kept together) and the isolated authors spread
// evenly over spheres around it. With random starting positions the isolated
// authors, which barely move, often ended up lopsided around the center.
function sphereDirections(count) {
  // Fibonacci sphere: `count` evenly spread unit vectors.
  return Array.from({ length: count }, (_, k) => {
    const y = 1 - (2 * (k + 0.5)) / count;
    const r = Math.sqrt(1 - y * y);
    const phi = k * Math.PI * (3 - Math.sqrt(5));
    return [Math.cos(phi) * r, y, Math.sin(phi) * r];
  });
}
const jitter = (size) => (Math.random() * 2 - 1) * size;
const seedPositions = authors.map(() => [jitter(SEED_RADIUS_LARGEST), jitter(SEED_RADIUS_LARGEST), jitter(SEED_RADIUS_LARGEST)]);
const isolatedNodes = authors.map((_, i) => i).filter((i) => componentSize.get(componentOf[i]) === 1);
sphereDirections(isolatedNodes.length).forEach((dir, k) => {
  seedPositions[isolatedNodes[k]] = dir.map((v) => v * SEED_RADIUS_ISOLATED);
});
const smallComponents = [...componentSize.keys()].filter((c) => c !== largestComponent && componentSize.get(c) > 1);
const smallDirections = sphereDirections(smallComponents.length);
componentOf.forEach((c, i) => {
  const k = smallComponents.indexOf(c);
  if (k >= 0) seedPositions[i] = smallDirections[k].map((v) => v * SEED_RADIUS_CONNECTED + jitter(10));
});
network.defineNodeAttribute(SEED_ATTRIBUTE, AttributeType.Float, 3);
network.withBufferAccess(() => {
  const view = network.getNodeAttributeBuffer(SEED_ATTRIBUTE).view;
  seedPositions.forEach((p, i) => view.set(p, 3 * i));
});

const helios = new Helios(network, {
  container: document.querySelector('#app'),
  mode: '3d',
  layout: {
    type: 'gpu-force',
    options: {
      // Per-component gravity always on ('auto' only enables it for some networks).
      // The scales themselves are replaced below by useComponentGravity().
      componentForces: 'halo',
      // Exact repulsion between every pair of nodes. Above 128 nodes Helios
      // otherwise samples ~96 nodes per step; the sampled push is one-sided,
      // and it could send a two-author group (e.g. Beauchamp–Shugars) drifting
      // far off. Exact repulsion is cheap at this size.
      exactRepulsionThreshold3D: 1024,
      linkDistance: LINK_DISTANCE,
    },
  },
  // No permanent labels; the hover behavior still shows the hovered author's name.
  labels: { enabled: false },
  // The page draws its own clickable legend instead of Helios's.
  legends: { enabled: false },
  // Each page load starts from the GML file instead of a saved browser session.
  storage: false,
  ui: false,
});
await helios.ready;

// Helios only lets you set the gravity of the largest component and derives
// every other component's from its size, so a two-author group got almost the
// same weak pull as an isolated author. There is no public per-node setting, so
// this overwrites the scales Helios computes, just before they're uploaded to
// the GPU. It relies on helios-web internals (checked against 0.10.9): the
// layout delegate's `_webgpu`/`_webgl` backends and their syncTopology(), which
// receives `componentGravityScale` indexed by node.
function useComponentGravity(delegate) {
  const patch = (backend) => {
    if (backend && !backend.usesPageGravity) {
      const syncTopology = backend.syncTopology.bind(backend);
      backend.syncTopology = (topology, options) => {
        if (topology?.componentGravityEnabled) topology.componentGravityScale.set(gravityScale);
        return syncTopology(topology, options);
      };
      backend.usesPageGravity = true;
    }
    return backend;
  };
  // Helios replaces the backend objects (e.g. when the GPU device changes), so
  // patch whichever one is assigned.
  for (const key of ['_webgpu', '_webgl']) {
    let backend = patch(delegate[key]);
    Object.defineProperty(delegate, key, { configurable: true, get: () => backend, set: (b) => { backend = patch(b); } });
  }
  delegate.markTopologyDirty('page-component-gravity');
}
const layoutDelegate = helios._activePositionDelegate;
if (layoutDelegate?.markTopologyDirty) {
  useComponentGravity(layoutDelegate);
} else {
  console.warn('Layout internals changed; using Helios default component gravity.');
}
helios.setLayoutPositionsFromNodeAttribute(SEED_ATTRIBUTE);

const mappers = helios.behavior.mappers;
mappers.setChannelConfig('node', 'color', {
  type: 'categorical',
  attributes: 'isolated',
  domain: [0, 1],
  range: [CONNECTED_COLOR, ISOLATED_COLOR],
  defaultValue: '#888888ff',
});
mappers.setChannelConfig('node', 'size', {
  type: 'linear',
  attributes: 'degree',
  domain: [0, 40],
  range: [6, 18],
});
mappers.setChannelConfig('edge', 'width', {
  type: 'linear',
  attributes: 'weight',
  domain: [1, 10],
  range: [0.5, 3],
});

helios.frameNetwork({ animate: false });

document.querySelector('#stats').textContent =
  `${network.nodeCount} authors, ${publicationCount} publications, ${network.edgeCount} coauthor links, ${isolatedCount} isolated authors`;

// --- Filtering: search box + legend ---------------------------------------
// Non-matching nodes and links get a custom state bit whose style dims them.
// (Dimming via nodeNoStateStyle doesn't stick: Helios's hover behavior resets
// that style on every hover.) Slot 3 is the spare slot Helios compiles by default.
const DIMMED_SLOT = 3;
const DIMMED = 1 << DIMMED_SLOT;
helios.nodeStateStyle(DIMMED_SLOT, {
  sizeMul: 1, opacityMul: DIMMED_OPACITY, outlineMul: 1, colorMul: [1, 1, 1, 1], colorAdd: [0, 0, 0, 0],
});
helios.edgeStateStyle(DIMMED_SLOT, {
  widthMul: 1, opacityMul: DIMMED_OPACITY, colorMul: [1, 1, 1, 1], colorAdd: [0, 0, 0, 0],
});

const searchInput = document.querySelector('#search');
const clearSearchButton = document.querySelector('#clear-search');
const searchCount = document.querySelector('#search-count');
const searchResults = document.querySelector('#search-results');
const legendItems = [...document.querySelectorAll('#legend button')];
let legendFilter = null; // null, 'linked' or 'isolated'
// Ego network: when on, only the focused author and their coauthors stay bright.
let egoActive = false;
const coauthors = authors.map(() => new Set());
edgeEndpoints.forEach(([a, b]) => { coauthors[a].add(b); coauthors[b].add(a); });
const allNodes = authors.map((_, i) => i);
const allEdges = edgeEndpoints.map((_, e) => e);
// Dimmed nodes can't be hovered or clicked while a filter is active.
let dimmedNodes = new Set();

// Helios's hover label reads the hovered node from its internal picking state,
// so it can't be cleared from outside. It gets its text from this method, and an
// empty text means no label, so dimmed nodes get no hover label.
const hoverBehavior = helios.behavior.hover;
const resolveHoverLabel = hoverBehavior.resolveHoverLabelValue.bind(hoverBehavior);
hoverBehavior.resolveHoverLabelValue = (index, net) => (dimmedNodes.has(index) ? '' : resolveHoverLabel(index, net));

function applyFilters() {
  const query = searchInput.value.trim().toLowerCase();
  const searching = query !== '' || legendFilter !== null;
  const ego = egoActive && focusedNode >= 0 ? new Set([focusedNode, ...coauthors[focusedNode]]) : null;
  clearSearchButton.disabled = searchInput.value === '';

  helios.nodeState(allNodes, DIMMED, { mode: 'remove' });
  helios.edgeState(allEdges, DIMMED, { mode: 'remove' });
  dimmedNodes = new Set();

  if (searching || ego) {
    authors.forEach((author, i) => {
      const inLegend = legendFilter === null || (legendFilter === 'isolated') === author.isolated;
      if (!inLegend || (query !== '' && !author.searchText.includes(query)) || (ego && !ego.has(i))) dimmedNodes.add(i);
    });
    // A link stays bright only when both of its authors match, so the ego
    // network keeps the links among the focused author's coauthors too.
    const dimmedEdges = allEdges.filter((e) => dimmedNodes.has(edgeEndpoints[e][0]) || dimmedNodes.has(edgeEndpoints[e][1]));
    helios.nodeState([...dimmedNodes], DIMMED, { mode: 'add' });
    helios.edgeState(dimmedEdges, DIMMED, { mode: 'add' });
  }
  const matchCount = authors.length - dimmedNodes.size;
  searchCount.textContent = searching ? `${matchCount} matching author${matchCount === 1 ? '' : 's'}` : '';
  renderResults(query);

  if (dimmedNodes.has(hoveredNode)) {
    hoveredNode = -1;
    helios.hoverNodeState(null, 0);
    refreshTooltip();
  }

  legendItems.forEach((item) => {
    item.classList.toggle('active', item.dataset.filter === legendFilter);
    item.classList.toggle('dimmed', legendFilter !== null && item.dataset.filter !== legendFilter);
  });
}

// --- Search results dropdown ----------------------------------------------
// Lists the matching authors; choosing one zooms the camera in on that node.
let activeResult = -1;

function renderResults(query) {
  activeResult = -1;
  if (query === '') {
    searchResults.replaceChildren();
    searchResults.hidden = true;
    return;
  }
  const matches = authors
    .map((author, index) => ({ author, index, byName: author.name.toLowerCase().includes(query) }))
    .filter(({ index }) => !dimmedNodes.has(index))
    // Name matches first, then title-only matches, each alphabetical.
    .sort((a, b) => (b.byName - a.byName) || a.author.name.localeCompare(b.author.name));
  searchResults.replaceChildren(...matches.map(({ author, index, byName }) => {
    const item = document.createElement('li');
    item.dataset.index = index;
    item.setAttribute('role', 'option');
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = author.isolated ? ISOLATED_COLOR : CONNECTED_COLOR;
    const text = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'result-name';
    name.textContent = author.name;
    const detail = document.createElement('div');
    detail.className = 'result-detail';
    // For title matches, show the first matching title so it's clear why the author is listed.
    const matchedTitle = byName ? null : author.titles.find((t) => t.toLowerCase().includes(query));
    detail.textContent = matchedTitle
      ?? `${author.titles.length} publication${author.titles.length === 1 ? '' : 's'}`;
    text.append(name, detail);
    item.append(swatch, text);
    return item;
  }));
  if (!matches.length) {
    const empty = document.createElement('li');
    empty.className = 'result-empty';
    empty.textContent = 'No matching authors';
    searchResults.append(empty);
  }
  searchResults.hidden = document.activeElement !== searchInput;
}

function setActiveResult(next) {
  const items = [...searchResults.querySelectorAll('li[data-index]')];
  if (!items.length) return;
  activeResult = (next + items.length) % items.length;
  items.forEach((item, i) => item.classList.toggle('active', i === activeResult));
  items[activeResult].scrollIntoView({ block: 'nearest' });
}

function chooseResult(item) {
  if (!item?.dataset.index) return;
  focusNode(Number(item.dataset.index), { zoomIn: true });
  searchResults.hidden = true;
  searchInput.blur();
}

searchInput.addEventListener('input', applyFilters);
// Clears the search text the same way the input's built-in "x" did.
clearSearchButton.addEventListener('click', () => {
  searchInput.value = '';
  applyFilters();
  searchInput.focus();
});
searchInput.addEventListener('focus', () => {
  if (searchInput.value.trim() !== '') searchResults.hidden = false;
});
searchInput.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    searchResults.hidden = false;
    setActiveResult(activeResult + (event.key === 'ArrowDown' ? 1 : -1));
  } else if (event.key === 'Enter') {
    const items = searchResults.querySelectorAll('li[data-index]');
    chooseResult(items[Math.max(activeResult, 0)]);
  } else if (event.key === 'Escape') {
    searchResults.hidden = true;
  }
});
// mousedown (not click) so the choice lands before the input loses focus.
searchResults.addEventListener('mousedown', (event) => {
  event.preventDefault();
  chooseResult(event.target.closest('li[data-index]'));
});
document.addEventListener('pointerdown', (event) => {
  if (!event.target.closest('#search-box')) searchResults.hidden = true;
});
legendItems.forEach((item) => {
  item.addEventListener('click', () => {
    // Clicking the active item again clears the legend filter.
    legendFilter = legendFilter === item.dataset.filter ? null : item.dataset.filter;
    applyFilters();
  });
});

// --- Tooltip: hovered author, or the focused author when nothing is hovered ---
const tooltip = document.querySelector('#tooltip');
const tooltipName = tooltip.querySelector('.name');
const tooltipCount = tooltip.querySelector('.count');
const tooltipList = tooltip.querySelector('ul');
const egoToggle = document.querySelector('#ego-toggle');
let hoveredNode = -1;
let focusedNode = -1;

function showAuthor(index) {
  if (index < 0 || !authors[index]) {
    tooltip.hidden = true;
    return;
  }
  const { name, titles } = authors[index];
  const coauthorCount = coauthors[index].size;
  tooltipName.textContent = name;
  tooltipCount.textContent = `${titles.length} publication${titles.length === 1 ? '' : 's'}`
    + ` · ${coauthorCount} coauthor${coauthorCount === 1 ? '' : 's'}`
    + (index === focusedNode ? ' · focused' : '');
  // The ego network toggle belongs to the focused author, so it's only shown
  // while the tooltip shows that author (not a node hovered meanwhile).
  egoToggle.hidden = index !== focusedNode;
  egoToggle.setAttribute('aria-pressed', String(egoActive));
  tooltipList.replaceChildren(...titles.map((title) => {
    const item = document.createElement('li');
    item.textContent = title;
    return item;
  }));
  tooltip.hidden = false;
}

const refreshTooltip = () => showAuthor(hoveredNode >= 0 ? hoveredNode : focusedNode);

helios.on(EVENTS.NODE_HOVER, ({ detail }) => {
  if (detail?.state !== 'out' && dimmedNodes.has(detail?.index)) {
    // Helios's hover handler has already run; undo its hover highlight and label.
    helios.hoverNodeState(null, 0);
    return;
  }
  if (detail?.state === 'out') {
    if (detail.index === hoveredNode) hoveredNode = -1;
  } else if (Number.isInteger(detail?.index) && detail.index >= 0) {
    hoveredNode = detail.index;
  }
  refreshTooltip();
});

// Clicking a node centers the camera on it and keeps it as the center of rotation
// (following it while the layout moves). Clicking the background releases it.
// With zoomIn, the camera also moves 4x closer, but only when nothing was focused
// yet, so choosing several search results in a row doesn't keep zooming in.
function focusNode(index, { zoomIn = false } = {}) {
  const zoomScale = zoomIn && focusedNode < 0 ? 4 : 1;
  focusedNode = index;
  helios.cameraFollowNodes([index], { animate: true, durationMs: 600, zoomScale });
  // With the ego network on, it moves to the newly focused author.
  if (egoActive) applyFilters();
  refreshTooltip();
}

helios.on(EVENTS.GRAPH_CLICK, ({ detail }) => {
  // Clicks on dimmed nodes are ignored.
  if (detail?.kind === 'node' && dimmedNodes.has(detail.index)) return;
  if (detail?.kind === 'node' && detail.index >= 0) {
    focusNode(detail.index);
  } else if (detail?.kind == null && focusedNode >= 0) {
    focusedNode = -1;
    // Releasing the focus also turns the ego network off.
    if (egoActive) {
      egoActive = false;
      applyFilters();
    }
    helios.cameraFollowNodes([], { animate: true, durationMs: 600 });
    refreshTooltip();
  }
});

egoToggle.addEventListener('click', () => {
  egoActive = !egoActive;
  applyFilters();
  refreshTooltip();
});

window.__helios = helios;
