import { Graphviz } from "@hpcc-js/wasm-graphviz";

import type { ProcessGraph } from "./processGraph";

export interface Position {
  x: number;
  y: number;
}

let graphviz: Promise<Graphviz> | null = null;

/**
 * How MetroFlow draws a station, in pixels: a circle with its name centered
 * below it, at its default text size.
 */
const STATION = {
  /** Above the centre of the station: its radius and stroke. */
  top: 14,
  /** Below the centre of the station: down to the bottom of its name. */
  bottom: 33,
  /** The width of a station without its name. */
  width: 28,
  /** The average width of a character of a name (names are mostly capitals). */
  charWidth: 7.6
};

/** Space between two stations of the same column, and between columns. */
const NODE_SEP = 28;
const RANK_SEP = 56;

/**
 * Space around the stations of a subworkflow, for the box that MetroFlow
 * draws around them, and the height of its title.
 */
const CLUSTER_MARGIN = 26;
const CLUSTER_TITLE_SIZE = 16;

/**
 * MetroFlow shows a grid of this size: stations are put on it, so that the
 * lines between stations that are nearly aligned are straight.
 */
const GRID = 25;

/** How much dot favours straight lines between stations on a single line. */
const STRAIGHT_WEIGHT = 8;

/** Graphviz works in points, but takes the sizes of nodes in inches. */
const inches = (pixels: number) => (pixels / 72).toFixed(3);

/**
 * Lays out the process graph with the dot engine of Graphviz, compiled to
 * WebAssembly: from left to right, with a cluster for each workflow call.
 * Each station takes the room of its circle and its name, so that names do
 * not overlap. Returns the position of each station, in pixels, on the grid
 * of MetroFlow.
 */
export async function layoutProcessGraph(
  graph: ProcessGraph
): Promise<Map<string, Position>> {
  graphviz ??= Graphviz.load();
  const dot = toDot(graph);
  const layout = JSON.parse((await graphviz).layout(dot.source, "json", "dot"));

  // The station is at the top of its node, its name below it
  const shift = (STATION.top + STATION.bottom) / 2 - STATION.top;
  const result = new Map<string, Position>();
  for (const object of layout.objects ?? []) {
    const key = dot.keys.get(object.name);
    if (key === undefined || typeof object.pos !== "string") {
      continue;
    }
    const [x, y] = object.pos.split(",").map(Number);
    // dot's y axis goes up, MetroFlow's goes down
    result.set(key, { x, y: -y - shift });
  }
  return snapToGrid(result);
}

/**
 * Puts the stations on the grid, starting from the top left one. The space
 * that dot leaves between stations is larger than the grid, so this does
 * not make them overlap.
 */
function snapToGrid(positions: Map<string, Position>) {
  const values = [...positions.values()];
  const minX = Math.min(...values.map((p) => p.x));
  const minY = Math.min(...values.map((p) => p.y));
  const snap = (value: number) => Math.round(value / GRID) * GRID;
  const result = new Map<string, Position>();
  for (const [key, p] of positions) {
    result.set(key, {
      x: GRID * 4 + snap(p.x - minX),
      y: GRID * 4 + snap(p.y - minY)
    });
  }
  return result;
}

/**
 * The graph in the DOT language. The processes and workflows are named by
 * their index, which avoids quoting, and the keys map these names back.
 */
function toDot(graph: ProcessGraph) {
  const keys = new Map<string, string>();
  const names = new Map<string, string>();
  graph.processes.forEach((p, i) => {
    keys.set(`n${i}`, p.key);
    names.set(p.key, `n${i}`);
  });

  // the processes and workflow calls directly in each workflow call
  const children = new Map<
    string,
    { processes: string[]; workflows: string[] }
  >();
  const childrenOf = (path: string) => {
    if (!children.has(path)) {
      children.set(path, { processes: [], workflows: [] });
    }
    return children.get(path)!;
  };
  const labels = new Map<string, string>();
  for (const w of graph.workflows) {
    childrenOf(w.path.slice(0, -1).join(".")).workflows.push(w.path.join("."));
    labels.set(w.path.join("."), w.alias);
  }
  const sizes = new Map<string, string>();
  for (const p of graph.processes) {
    const name = names.get(p.key)!;
    childrenOf(p.groupPath.join(".")).processes.push(name);
    const width = Math.max(
      STATION.width,
      p.alias.length * STATION.charWidth + 8
    );
    sizes.set(
      name,
      `width=${inches(width)}, height=${inches(STATION.top + STATION.bottom)}`
    );
  }

  const lines = [
    "digraph {",
    "  rankdir=LR;",
    "  newrank=true;",
    `  nodesep=${inches(NODE_SEP)};`,
    `  ranksep=${inches(RANK_SEP)};`,
    '  node [shape=box, fixedsize=true, label=""];',
    // the title of a subworkflow is in its top left corner
    `  graph [margin=${CLUSTER_MARGIN}, labeljust=l, fontsize=${CLUSTER_TITLE_SIZE}];`
  ];
  let clusters = 0;
  const addChildren = (path: string, indent: string) => {
    const { processes, workflows } = childrenOf(path);
    for (const name of processes) {
      lines.push(`${indent}${name} [${sizes.get(name)}];`);
    }
    for (const workflow of workflows) {
      lines.push(`${indent}subgraph cluster_${clusters++} {`);
      lines.push(`${indent}  label=${JSON.stringify(labels.get(workflow))};`);
      addChildren(workflow, `${indent}  `);
      lines.push(`${indent}}`);
    }
  };
  addChildren("", "  ");
  // a line that is the only one out of a station or into one is kept
  // straight, as the lines of a metro map
  const outs = new Map<string, number>();
  const ins = new Map<string, number>();
  for (const [a, b] of graph.edges) {
    outs.set(a, (outs.get(a) ?? 0) + 1);
    ins.set(b, (ins.get(b) ?? 0) + 1);
  }
  for (const [a, b] of graph.edges) {
    const single = outs.get(a) === 1 || ins.get(b) === 1;
    lines.push(
      `  ${names.get(a)} -> ${names.get(b)}${single ? ` [weight=${STRAIGHT_WEIGHT}]` : ""};`
    );
  }
  lines.push("}");
  return { source: lines.join("\n"), keys };
}
