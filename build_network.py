"""Convert the cleaned Northeastern Network Science Institute CSV into a GML
coauthorship network for Helios.

Nodes are authors. Two authors share an edge when they appear on the same
publication; the edge weight is the number of publications they share.
Authors with no coauthors in the dataset are kept as isolated nodes.

Publication titles go in a separate JSON file keyed by author ID, so the
Helios page can list them in its hover tooltip.

Run with the Anaconda interpreter (it has pandas and networkx):
    /opt/anaconda3/bin/python build_network.py
"""
import json
from itertools import combinations

import networkx as nx
import pandas as pd

INPUT_CSV = "institute_data/cleaned_northeastern_network_science_institute.csv"
OUTPUT_GML = "institute_data/coauthorship_network.gml"
OUTPUT_TITLES = "institute_data/author_publications.json"

df = pd.read_csv(INPUT_CSV)

# The source data has a few repeated (PublicationId, AuthorId) rows.
author_publications = df[["PublicationId", "AuthorId"]].dropna().drop_duplicates()

G = nx.Graph()

for author_id, rows in df.groupby("AuthorId"):
    names = rows["AuthorName"].dropna()
    # Some authors have no known name; label them by ID so they stay identifiable.
    label = names.iloc[0] if not names.empty else f"Unknown author {author_id}"
    G.add_node(
        str(author_id),
        label=label,
        publications=int(rows["PublicationId"].nunique()),
        name_known=int(not names.empty),
    )

for _, rows in author_publications.groupby("PublicationId"):
    for a, b in combinations(sorted(rows["AuthorId"].astype(str)), 2):
        if G.has_edge(a, b):
            G[a][b]["weight"] += 1
        else:
            G.add_edge(a, b, weight=1)

degree = dict(G.degree())
nx.set_node_attributes(G, degree, "degree")
nx.set_node_attributes(G, {n: int(d == 0) for n, d in degree.items()}, "isolated")

# Component sizes make it easy to color or filter the giant component in Helios.
for component in nx.connected_components(G):
    for node in component:
        G.nodes[node]["component_size"] = len(component)



def gml_value(value):
    if isinstance(value, str):
        # Helios reads GML strings as raw UTF-8 and does not decode &-entities,
        # so write names as-is. GML has no escape for a double quote.
        return '"' + value.replace('"', "'") + '"'
    return str(value)


def write_gml(graph, path, graph_attrs):
    # nx.write_gml would replace the label with the node key and escape accented
    # names as &#NNN; entities, so the GML is written by hand.
    index = {node: i for i, node in enumerate(graph.nodes)}
    lines = ["graph [", "  directed 0"]
    lines += [f"  {key} {gml_value(val)}" for key, val in graph_attrs.items()]
    for node, attrs in graph.nodes(data=True):
        lines += ["  node [", f"    id {index[node]}", f'    author_id "{node}"']
        lines += [f"    {key} {gml_value(val)}" for key, val in attrs.items()]
        lines.append("  ]")
    for a, b, attrs in graph.edges(data=True):
        lines += ["  edge [", f"    source {index[a]}", f"    target {index[b]}"]
        lines += [f"    {key} {gml_value(val)}" for key, val in attrs.items()]
        lines.append("  ]")
    lines.append("]")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


publication_count = int(author_publications["PublicationId"].nunique())
write_gml(G, OUTPUT_GML, {"publication_count": publication_count})

titles = {
    str(author_id): sorted(rows["PublicationName"].dropna().unique().tolist())
    for author_id, rows in df.groupby("AuthorId")
}
with open(OUTPUT_TITLES, "w", encoding="utf-8") as f:
    json.dump(titles, f, ensure_ascii=False, indent=1)

isolated = sum(1 for d in degree.values() if d == 0)
print(f"Authors (nodes): {G.number_of_nodes()}")
print(f"Coauthor links (edges): {G.number_of_edges()}")
print(f"Isolated authors: {isolated}")
print(f"Publications: {publication_count}")
print(f"Connected components: {nx.number_connected_components(G)}")
print(f"Saved {OUTPUT_GML} and {OUTPUT_TITLES}")
