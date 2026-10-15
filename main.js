import HeliosNetwork from 'helios-network';
import { Helios, EVENTS } from 'helios-web';

// Both built from the cleaned CSV by build_network.py.
const NETWORK_URL = './institute_data/coauthorship_network.gml';
const TITLES_URL = './institute_data/author_publications.json';

const CONNECTED_COLOR = '#4dabf7ff';
const ISOLATED_COLOR = '#ff922bff';
// Opacity of nodes and links that don't match the current search/legend filter.
const DIMMED_OPACITY = 0.3;

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

const helios = new Helios(network, {
  container: document.querySelector('#app'),
  mode: '3d',
  // gpu-force applies gravity to every node, so authors with no coauthors stay
  // on screen around the main clusters instead of drifting away.
  layout: { type: 'gpu-force' },
  // No permanent labels; the hover behavior still shows the hovered author's name.
  labels: { enabled: false },
  // The page draws its own clickable legend instead of Helios's.
  legends: { enabled: false },
  // Each page load starts from the GML file instead of a saved browser session.
  storage: false,
  ui: false,
});
await helios.ready;

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
const searchCount = document.querySelector('#search-count');
const legendItems = [...document.querySelectorAll('#legend button')];
let legendFilter = null; // null, 'linked' or 'isolated'
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
  const filtering = query !== '' || legendFilter !== null;

  helios.nodeState(allNodes, DIMMED, { mode: 'remove' });
  helios.edgeState(allEdges, DIMMED, { mode: 'remove' });
  dimmedNodes = new Set();

  if (!filtering) {
    searchCount.textContent = '';
  } else {
    authors.forEach((author, i) => {
      const inLegend = legendFilter === null || (legendFilter === 'isolated') === author.isolated;
      if (!inLegend || (query !== '' && !author.searchText.includes(query))) dimmedNodes.add(i);
    });
    // A link stays bright only when both of its authors match.
    const dimmedEdges = allEdges.filter((e) => dimmedNodes.has(edgeEndpoints[e][0]) || dimmedNodes.has(edgeEndpoints[e][1]));
    helios.nodeState([...dimmedNodes], DIMMED, { mode: 'add' });
    helios.edgeState(dimmedEdges, DIMMED, { mode: 'add' });
    const matchCount = authors.length - dimmedNodes.size;
    searchCount.textContent = `${matchCount} matching author${matchCount === 1 ? '' : 's'}`;
  }

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

searchInput.addEventListener('input', applyFilters);
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
let hoveredNode = -1;
let focusedNode = -1;

function showAuthor(index) {
  if (index < 0 || !authors[index]) {
    tooltip.hidden = true;
    return;
  }
  const { name, titles } = authors[index];
  tooltipName.textContent = name;
  tooltipCount.textContent = `${titles.length} publication${titles.length === 1 ? '' : 's'}`
    + (index === focusedNode ? ' · focused' : '');
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
helios.on(EVENTS.GRAPH_CLICK, ({ detail }) => {
  // Clicks on dimmed nodes are ignored.
  if (detail?.kind === 'node' && dimmedNodes.has(detail.index)) return;
  if (detail?.kind === 'node' && detail.index >= 0) {
    focusedNode = detail.index;
    helios.cameraFollowNodes([focusedNode], { animate: true, durationMs: 600 });
  } else if (detail?.kind == null && focusedNode >= 0) {
    focusedNode = -1;
    helios.cameraFollowNodes([], { animate: true, durationMs: 600 });
  }
  refreshTooltip();
});

window.__helios = helios;
