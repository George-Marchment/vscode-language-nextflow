import type { DagGraph, DagSubgraph, ScriptStructure } from "./structure";

/**
 * A condition of a branch of a workflow, e.g. `params.foo` for the if branch
 * of `if (params.foo)` and `!(params.foo)` for its else branch.
 */
export interface Condition {
  text: string;
  /** The condition as written in the script, e.g. `params.foo`. */
  source: string;
  /** The script and the workflow (undefined for the entry one) where it is. */
  uri: string;
  workflow?: string;
}

/**
 * A process call, i.e. a station of the metro map, or a call to a workflow
 * whose script has errors, which cannot be expanded.
 */
export interface ProcessCall {
  key: string;
  kind: "process" | "workflow";
  /** The name of the process in the workflow that calls it. */
  alias: string;
  /** The name of the process where it is defined. */
  definition: string;
  uri: string;
  /** The keys of the workflow calls that contain it, outermost first. */
  groupPath: string[];
  conditions: Condition[];
}

/** A workflow call, whose process calls are grouped on the metro map. */
export interface WorkflowCall {
  /** Unique among the calls of the workflow that calls it, e.g. FOO_$$_1. */
  key: string;
  /** The keys of the workflow calls that contain it, then its own key. */
  path: string[];
  alias: string;
  definition: string;
  uri: string;
  conditions: Condition[];
}

/**
 * The process calls of a pipeline, connected when the outputs of one reach
 * the other, whatever the operators, channels and workflow calls between them.
 */
export interface ProcessGraph {
  processes: ProcessCall[];
  edges: [string, string][];
  workflows: WorkflowCall[];
}

interface FlatNode {
  preds: Set<string>;
  process?: ProcessCall;
}

/**
 * Builds the process graph of a pipeline from its entry workflow, or of a
 * named workflow of the script, with every workflow call replaced by the
 * graph of the workflow that it calls, as BioFlow-Insight builds its process
 * dependency graph.
 */
export function buildProcessGraph(
  entryUri: string,
  structures: Map<string, ScriptStructure>,
  workflowName?: string
): ProcessGraph {
  const nodes = new Map<string, FlatNode>();
  const workflows: WorkflowCall[] = [];
  const callCounts = new Map<string, number>();

  const findWorkflow = (uri: string, name: string | undefined) =>
    structures.get(uri)?.workflows.find((w) => w.name === name);

  /**
   * Adds the nodes of a workflow to the flat graph, and returns the keys of
   * its take and emit nodes.
   */
  function inline(
    workflow: { uri: string; name?: string; graph: DagGraph },
    prefix: string,
    groupPath: string[],
    conditions: Condition[],
    stack: string[]
  ) {
    const { graph } = workflow;
    const key = (id: number) => `${prefix}${id}`;
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const nodeConditions = branchConditions(graph, workflow.uri, workflow.name);

    for (const n of graph.nodes) {
      const flat: FlatNode = { preds: new Set(n.preds.map(key)) };
      // a workflow whose script has errors is shown as a single station
      const unexpanded =
        n.kind === "workflow" && n.uri && !structures.has(n.uri);
      if ((n.kind === "process" || unexpanded) && n.uri) {
        flat.process = {
          key: key(n.id),
          kind: n.kind!,
          alias: n.label,
          definition: n.definition ?? n.label,
          uri: n.uri,
          groupPath,
          conditions: [...conditions, ...(nodeConditions.get(n.id) ?? [])]
        };
      }
      nodes.set(key(n.id), flat);
    }

    for (const n of graph.nodes) {
      if (n.kind !== "workflow" || !n.uri) {
        continue;
      }
      const definition = n.definition ?? n.label;
      const callee = findWorkflow(n.uri, definition)?.graph;
      const calleeUri = n.uri;
      const id = `${n.uri}#${definition}`;
      // a recursive call keeps its node, which connects its inputs to its
      // outputs
      if (!callee || stack.includes(id)) {
        continue;
      }

      const countKey = `${groupPath.join(".")}/${n.label}`;
      const count = (callCounts.get(countKey) ?? 0) + 1;
      callCounts.set(countKey, count);
      const path = [...groupPath, `${n.label}_$$_${count}`];
      const callConditions = [
        ...conditions,
        ...(nodeConditions.get(n.id) ?? [])
      ];
      workflows.push({
        key: path[path.length - 1],
        path,
        alias: n.label,
        definition,
        uri: n.uri,
        conditions: callConditions
      });

      const io = inline(
        { uri: calleeUri, name: definition, graph: callee },
        `${key(n.id)}/`,
        path,
        callConditions,
        [...stack, id]
      );
      const outputs = Object.values(io.outputs);

      // the arguments of the call go to the takes of the workflow
      for (const predId of n.preds) {
        const pred = byId.get(predId);
        if (pred?.type !== "INPUT") {
          continue;
        }
        const take = io.inputs[pred.label.replace(/^take:/, "")];
        if (take) {
          nodes.get(take)!.preds.add(key(predId));
        }
      }

      // the call itself only stands for the outputs of the workflow (e.g.
      // for `FOO.out` when it has several emits)
      nodes.get(key(n.id))!.preds = new Set(outputs);

      // the emits of the workflow go to the emit nodes of the call
      for (const m of graph.nodes) {
        if (m.type !== "OUTPUT" || !m.preds.includes(n.id)) {
          continue;
        }
        const name = m.label.startsWith("emit:")
          ? m.label.slice("emit:".length)
          : null;
        const output =
          name !== null
            ? io.outputs[name]
            : (io.outputs["$out"] ??
              (outputs.length === 1 ? outputs[0] : undefined));
        const preds = nodes.get(key(m.id))!.preds;
        preds.delete(key(n.id));
        for (const o of output ? [output] : outputs) {
          preds.add(o);
        }
      }
    }

    const keys = (ids: Record<string, number>) =>
      Object.fromEntries(
        Object.entries(ids).map(([name, id]) => [name, key(id)])
      );
    return { inputs: keys(graph.inputs), outputs: keys(graph.outputs) };
  }

  const entry = findWorkflow(entryUri, workflowName)?.graph;
  if (!entry) {
    throw new Error(
      workflowName
        ? `The script has no workflow ${workflowName}.`
        : "The script has no entry workflow."
    );
  }
  // a named workflow shown on its own is a subworkflow of the map, as when
  // it is called, so that it keeps its box
  const rootPath: string[] = [];
  if (workflowName) {
    rootPath.push(`${workflowName}_$$_1`);
    workflows.push({
      key: rootPath[0],
      path: rootPath,
      alias: workflowName,
      definition: workflowName,
      uri: entryUri,
      conditions: []
    });
  }
  inline(
    { uri: entryUri, name: workflowName, graph: entry },
    "",
    rootPath,
    [],
    workflowName ? [`${entryUri}#${workflowName}`] : []
  );

  const processes = [...nodes.values()].flatMap((n) =>
    n.process ? [n.process] : []
  );
  return { processes, edges: processEdges(nodes), workflows };
}

/**
 * The conditions of the branches that contain each node, outermost first,
 * e.g. `params.foo` in the if branch and `!(params.foo)` in the else branch.
 */
function branchConditions(
  graph: DagGraph,
  uri: string,
  workflow: string | undefined
): Map<number, Condition[]> {
  const labels = new Map(graph.nodes.map((n) => [n.id, n.label]));
  const result = new Map<number, Condition[]>();
  const visit = (subgraph: DagSubgraph, conditions: Condition[]) => {
    for (const id of subgraph.nodes) {
      result.set(id, conditions);
    }
    for (const child of subgraph.subgraphs) {
      const label =
        child.pred !== undefined ? labels.get(child.pred)?.trim() : undefined;
      const condition: Condition | null = !label
        ? null
        : {
            text: child.branch === "else" ? `!(${label})` : label,
            source: label,
            uri,
            workflow
          };
      visit(child, condition ? [...conditions, condition] : conditions);
    }
  };
  visit(graph.subgraph, []);
  return result;
}

/**
 * Connects each process to the processes that its outputs reach through
 * nodes that are not processes.
 */
function processEdges(nodes: Map<string, FlatNode>): [string, string][] {
  const succs = new Map<string, string[]>();
  for (const [key, node] of nodes) {
    for (const pred of node.preds) {
      if (!succs.has(pred)) {
        succs.set(pred, []);
      }
      succs.get(pred)!.push(key);
    }
  }

  const edges: [string, string][] = [];
  for (const [source, node] of nodes) {
    if (!node.process) {
      continue;
    }
    const visited = new Set<string>([source]);
    const stack = [...(succs.get(source) ?? [])];
    while (stack.length > 0) {
      const key = stack.pop()!;
      if (visited.has(key)) {
        continue;
      }
      visited.add(key);
      if (nodes.get(key)?.process) {
        edges.push([source, key]);
      } else {
        stack.push(...(succs.get(key) ?? []));
      }
    }
  }
  return edges;
}

/**
 * Joins the conditions of a station or a workflow into one condition, e.g.
 * `(params.a) && (params.b)`. Conditions shared by more processes come first,
 * as they are the outermost ones.
 */
export function combineConditions(
  conditions: Condition[],
  population: Map<string, number>
): string | undefined {
  const unique = sortConditions(conditions, population).map((c) => c.text);
  if (unique.length === 0) {
    return undefined;
  }
  return unique.length === 1
    ? unique[0]
    : unique.map((c) => `(${c})`).join(" && ");
}

/**
 * The conditions in the order in which they are combined, without
 * duplicates (by text, keeping the first, i.e. outermost, one).
 */
export function sortConditions(
  conditions: Condition[],
  population: Map<string, number>
): Condition[] {
  const seen = new Set<string>();
  const unique = conditions.filter(
    (c) => !seen.has(c.text) && seen.add(c.text)
  );
  // a stable sort keeps the nesting order of conditions with the same
  // population
  unique.sort(
    (a, b) => (population.get(b.text) ?? 0) - (population.get(a.text) ?? 0)
  );
  return unique;
}
