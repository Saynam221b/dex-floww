export type GraphNodeKind =
  | "from"
  | "join"
  | "where"
  | "groupby"
  | "having"
  | "select"
  | "orderby"
  | "limit"
  | "union"
  | "unknown";

export type GraphEdgeReason =
  | "join-input"
  | "predicate"
  | "aggregation"
  | "projection"
  | "sorting"
  | "limiting"
  | "union-merge"
  | "fallback";

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  sql: string;
  parentId?: string;
  deps: string[];
}

export interface GraphEdge {
  source: string;
  target: string;
  reason: GraphEdgeReason;
}

export interface GraphModel {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export type NodeMapValue =
  | string
  | {
      sql?: unknown;
      parentId?: unknown;
      isGroup?: unknown;
      label?: unknown;
      isExpanded?: unknown;
    };

export type NodeMapInput = Record<string, NodeMapValue>;

const KIND_ORDER: Record<GraphNodeKind, number> = {
  from: 0,
  join: 1,
  where: 2,
  groupby: 3,
  having: 4,
  select: 5,
  orderby: 6,
  limit: 7,
  union: 8,
  unknown: 9,
};

interface NodeMeta {
  id: string;
  kind: GraphNodeKind;
  sql: string;
  parentId?: string;
  branch: string;
  ord: number;
}

function detectKind(id: string): GraphNodeKind {
  const normalized = id.replace(/_u\d+$/, "");
  if (normalized.startsWith("node_from")) return "from";
  if (normalized.startsWith("node_join")) return "join";
  if (normalized.startsWith("node_where")) return "where";
  if (normalized.startsWith("node_groupby")) return "groupby";
  if (normalized.startsWith("node_having")) return "having";
  if (normalized.startsWith("node_select")) return "select";
  if (normalized.startsWith("node_orderby")) return "orderby";
  if (normalized.startsWith("node_limit")) return "limit";
  if (normalized.startsWith("node_union")) return "union";
  return "unknown";
}

function extractSql(value: NodeMapValue): string | null {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return null;
  if (value.isGroup) return null;
  return typeof value.sql === "string" ? value.sql : null;
}

function extractParentId(value: NodeMapValue): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  return typeof value.parentId === "string" ? value.parentId : undefined;
}

function extractOrdinal(id: string): number {
  const m = id.match(/_(\d+)(?:$|_u\d+$)/);
  return m ? Number.parseInt(m[1], 10) : 0;
}

function extractBranch(id: string): string {
  const m = id.match(/_u(\d+)$/);
  return m ? `u${m[1]}` : "base";
}

function reasonFor(kind: GraphNodeKind): GraphEdgeReason {
  if (kind === "join") return "join-input";
  if (kind === "where" || kind === "having") return "predicate";
  if (kind === "groupby") return "aggregation";
  if (kind === "select") return "projection";
  if (kind === "orderby") return "sorting";
  if (kind === "limit") return "limiting";
  if (kind === "union") return "union-merge";
  return "fallback";
}

function selectLatest(
  prior: NodeMeta[],
  kinds: GraphNodeKind[]
): NodeMeta[] {
  const allowed = new Set(kinds);
  for (let i = prior.length - 1; i >= 0; i -= 1) {
    if (allowed.has(prior[i].kind)) {
      return [prior[i]];
    }
  }
  return [];
}

function selectJoinInputs(prior: NodeMeta[]): NodeMeta[] {
  const joins = prior.filter((n) => n.kind === "join");
  if (joins.length > 0) {
    return [joins[joins.length - 1]];
  }
  const froms = prior.filter((n) => n.kind === "from");
  if (froms.length > 0) {
    // Keep fan-in bounded for very wide sources.
    return froms.slice(-3);
  }
  return prior.length > 0 ? [prior[prior.length - 1]] : [];
}

function selectDeps(current: NodeMeta, prior: NodeMeta[]): NodeMeta[] {
  if (prior.length === 0) return [];

  switch (current.kind) {
    case "join":
      return selectJoinInputs(prior);
    case "where":
      return selectLatest(prior, ["join", "from"]);
    case "groupby":
      return selectLatest(prior, ["where", "join", "from"]);
    case "having":
      return selectLatest(prior, ["groupby", "where", "join", "from"]);
    case "select":
      return selectLatest(prior, ["having", "groupby", "where", "join", "from"]);
    case "orderby":
      return selectLatest(prior, ["select", "having", "groupby", "where", "join", "from"]);
    case "limit":
      return selectLatest(prior, ["orderby", "select", "having", "groupby", "where", "join", "from"]);
    case "union":
      return selectLatest(prior, ["select", "orderby", "limit"]);
    case "from":
      return [];
    default:
      return [prior[prior.length - 1]];
  }
}

export function buildGraphModel(nodeMap: NodeMapInput): GraphModel {
  const nodeMeta: NodeMeta[] = [];
  const cteGroupMap = new Map<string, string>(); // groupId -> cteName

  for (const [id, raw] of Object.entries(nodeMap)) {
    const isGroup = typeof raw === "object" && raw !== null && "isGroup" in raw && raw.isGroup;
    if (isGroup) {
      const cteName = (raw as any).cteName || (raw as any).label;
      if (cteName) {
        cteGroupMap.set(id, cteName);
      }
      continue;
    }

    const sql = extractSql(raw);
    if (!sql || !sql.trim()) continue;

    nodeMeta.push({
      id,
      sql,
      kind: detectKind(id),
      parentId: extractParentId(raw),
      branch: extractBranch(id),
      ord: extractOrdinal(id),
    });
  }

  // Identify terminal nodes for each CTE
  const cteTerminalMap = new Map<string, string>(); // cteName -> terminalNodeId
  const cteToNodes = new Map<string, NodeMeta[]>();

  for (const n of nodeMeta) {
    if (n.parentId && cteGroupMap.has(n.parentId)) {
      const name = cteGroupMap.get(n.parentId)!;
      const list = cteToNodes.get(name) ?? [];
      list.push(n);
      cteToNodes.set(name, list);
    }
  }

  for (const [name, list] of cteToNodes.entries()) {
    list.sort((a, b) => {
      const kindDiff = (KIND_ORDER[a.kind] ?? 99) - (KIND_ORDER[b.kind] ?? 99);
      if (kindDiff !== 0) return kindDiff;
      return b.ord - a.ord;
    });
    // The "latest" node in the order is the terminal one
    const terminal = list[list.length - 1];
    if (terminal) {
      cteTerminalMap.set(name.toLowerCase(), terminal.id);
    }
  }

  // Scope by CTE group parent + branch suffix
  const scoped = new Map<string, NodeMeta[]>();
  for (const n of nodeMeta) {
    const scopeKey = `${n.parentId ?? "root"}::${n.branch}`;
    const list = scoped.get(scopeKey) ?? [];
    list.push(n);
    scoped.set(scopeKey, list);
  }

  const edgeMap = new Map<string, GraphEdge>();
  const nodeById = new Map<string, GraphNode>();

  for (const list of scoped.values()) {
    list.sort((a, b) => {
      const kindDiff = (KIND_ORDER[a.kind] ?? 99) - (KIND_ORDER[b.kind] ?? 99);
      if (kindDiff !== 0) return kindDiff;
      if (a.ord !== b.ord) return a.ord - b.ord;
      return a.id.localeCompare(b.id);
    });

    const prior: NodeMeta[] = [];
    for (const current of list) {
      const deps = selectDeps(current, prior).map((n) => n.id);

      // ADDITION: Look for CTE dependencies in FROM/JOIN
      if (current.kind === "from" || current.kind === "join") {
        const sqlLower = current.sql.toLowerCase();
        for (const [cteName, terminalId] of cteTerminalMap.entries()) {
          // Check if SQL references the CTE name as a word
          const regex = new RegExp(`\\b${cteName}\\b`, "i");
          if (regex.test(sqlLower)) {
            if (!deps.includes(terminalId)) {
              deps.push(terminalId);
            }
          }
        }
      }

      nodeById.set(current.id, {
        id: current.id,
        kind: current.kind,
        sql: current.sql,
        parentId: current.parentId,
        deps,
      });

      for (const dep of deps) {
        const key = `${dep}->${current.id}`;
        if (!edgeMap.has(key)) {
          // If the dependency is a CTE terminal node, label it as such
          const isCteDep = Array.from(cteTerminalMap.values()).includes(dep);
          
          edgeMap.set(key, {
            source: dep,
            target: current.id,
            reason: isCteDep ? "projection" : reasonFor(current.kind),
          });
        }
      }

      prior.push(current);
    }
  }

  // Add union bridge edges across branches when possible.
  const unionNodes = [...nodeById.values()].filter((n) => n.kind === "union");
  for (const unionNode of unionNodes) {
    if (unionNode.deps.length > 0) continue;
    const sameParent = [...nodeById.values()].filter(
      (n) => n.parentId === unionNode.parentId && n.id !== unionNode.id
    );
    const latestSelect = sameParent
      .filter((n) => n.kind === "select" || n.kind === "limit" || n.kind === "orderby")
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(-1)[0];

    if (latestSelect) {
      const key = `${latestSelect.id}->${unionNode.id}`;
      edgeMap.set(key, {
        source: latestSelect.id,
        target: unionNode.id,
        reason: "union-merge",
      });
      unionNode.deps.push(latestSelect.id);
    }
  }

  return {
    nodes: [...nodeById.values()],
    edges: [...edgeMap.values()],
  };
}

export interface GraphAdjacency {
  incoming: Map<string, string[]>;
  outgoing: Map<string, string[]>;
  edgeIdsByPair: Map<string, string>;
}

export function buildAdjacency(edges: Array<{ id?: string; source: string; target: string }>): GraphAdjacency {
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  const edgeIdsByPair = new Map<string, string>();

  for (const edge of edges) {
    const inArr = incoming.get(edge.target) ?? [];
    inArr.push(edge.source);
    incoming.set(edge.target, inArr);

    const outArr = outgoing.get(edge.source) ?? [];
    outArr.push(edge.target);
    outgoing.set(edge.source, outArr);

    if (edge.id) {
      edgeIdsByPair.set(`${edge.source}->${edge.target}`, edge.id);
    }
  }

  return { incoming, outgoing, edgeIdsByPair };
}
