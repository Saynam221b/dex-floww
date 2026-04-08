export interface AstNode {
  type?: string;
  columns?: unknown;
  from?: Array<{ table?: string; db?: string; as?: string; join?: string; on?: unknown }>;
  where?: unknown;
  groupby?: unknown;
  having?: unknown;
  orderby?: unknown;
  limit?: unknown;
  distinct?: unknown;
  with?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

const MAX_NODES = 200;

export interface FlattenedNode {
  sql: string;
  parentId?: string;
  isGroup?: boolean;
  label?: string;
  isExpanded?: boolean;
  [key: string]: unknown;
}

export function flattenAstToNodeMap(ast: AstNode | AstNode[]): Record<string, FlattenedNode> {
  const nodes: Record<string, FlattenedNode> = {};
  let nodeCount = 0;
  const target: AstNode = Array.isArray(ast) ? ast[0] : ast;

  if (!target) return nodes;

  const isOverLimit = () => nodeCount >= MAX_NODES;
  const setNode = (id: string, sql: string, extra?: Omit<FlattenedNode, "sql">) => {
    if (isOverLimit()) return;
    nodes[id] = { sql, ...(extra ?? {}) };
    nodeCount += 1;
  };

  // Process CTEs (with clauses) first
  try {
    if (target.with) {
      const cteChildEntries: Array<{ groupId: string; children: Record<string, FlattenedNode> }> = [];
      for (let i = 0; i < target.with.length; i++) {
        if (isOverLimit()) break;

        const cte = target.with[i] as { name?: { value?: string }; stmt?: { ast?: AstNode | AstNode[] } | AstNode | AstNode[] };
        const name: string = cte.name?.value || `cte_${i}`;
        const groupId = `node_cte_${name}`;

        setNode(groupId, `CTE: ${name}`, { isGroup: true, label: name, isExpanded: false, cteName: name });

        try {
          const stmt = cte.stmt;
          const innerStmt =
            stmt && typeof stmt === "object" && !Array.isArray(stmt) && "ast" in stmt
              ? ((stmt as { ast?: AstNode | AstNode[] }).ast ?? stmt)
              : stmt;
          const cteStmts = flattenAstToNodeMap((innerStmt as AstNode | AstNode[]) ?? []);
          cteChildEntries.push({ groupId, children: cteStmts });
        } catch {
          cteChildEntries.push({ groupId, children: {} });
        }
      }

      for (const { groupId, children } of cteChildEntries) {
        for (const [key, val] of Object.entries(children)) {
          if (isOverLimit()) break;
          setNode(
            `${key}_${groupId.replace("node_", "")}`,
            val.sql,
            { ...val, parentId: groupId }
          );
        }
      }
    }
  } catch {
    // Ignore CTE parsing errors
  }

  if (isOverLimit()) return nodes;

  // SELECT columns
  try {
    if (target.columns) {
      if (target.columns === "*") {
        setNode("node_select", "SELECT *");
      } else if (Array.isArray(target.columns)) {
        const cols = target.columns.map((c) => {
          const item = ((c as { expr?: unknown }).expr || c) as Record<string, unknown>;
          const table = item.table;
          const colname = item.column;
          let colStr = "";
          if (table && colname) {
             colStr = `${table}.${colname}`;
          } else if (colname) {
             colStr = String(colname);
          } else {
             colStr = stringifyExpression(item);
          }
          const alias = (c as { as?: string }).as;
          return alias ? `${colStr} AS ${alias}` : colStr;
        }).join(", ");
        setNode("node_select", `SELECT ${target.distinct ? "DISTINCT " : ""}${cols}`);
      }
    }
  } catch {
    setNode("node_select", "Complex Select Operation");
  }

  if (isOverLimit()) return nodes;

  // FROM tables & JOINs
  try {
    if (Array.isArray(target.from)) {
      let joinIdx = 0;
      target.from.forEach((src, i) => {
        if (isOverLimit()) return;
        const tableName = src.as ? `${src.table} AS ${src.as}` : src.table || `source_${i}`;

        if (src.join) {
          joinIdx++;
          const onClause = src.on ? ` ON ${stringifyExpression(src.on)}` : "";
          setNode(`node_join_${joinIdx}`, `${src.join} JOIN ${tableName}${onClause}`);
        } else {
          setNode(`node_from_${i + 1}`, `FROM ${tableName}`);
        }
      });
    }
  } catch {
    setNode("node_from", "Complex From Operation");
  }

  if (isOverLimit()) return nodes;

  // WHERE
  try {
    if (target.where) {
      setNode("node_where", `WHERE ${sanitizeNoJson(stringifyExpression(target.where))}`);
    }
  } catch {
    setNode("node_where", "Complex Where Operation");
  }

  // GROUP BY
  try {
    if (target.groupby) {
      const gbObj = Array.isArray(target.groupby) ? target.groupby : [target.groupby];
      const cols = gbObj.map((g) => {
        const item = ((g as { expr?: unknown }).expr || g) as Record<string, unknown>;
        if (item.table && item.column) return `${item.table}.${item.column}`;
        if (item.column) return item.column;
        return stringifyExpression(item);
      }).join(", ");
      setNode("node_groupby", `GROUP BY ${sanitizeNoJson(cols)}`);
    }
  } catch {
    setNode("node_groupby", "Complex Group By Operation");
  }

  // HAVING
  try {
    if (target.having) {
      let havingElements = "";
      if (Array.isArray(target.having)) {
        havingElements = target.having.map((h) => stringifyExpression((h as { expr?: unknown }).expr || h)).join(", ");
      } else {
        havingElements = stringifyExpression(target.having);
      }
      setNode("node_having", `HAVING ${sanitizeNoJson(havingElements)}`);
    }
  } catch {
    setNode("node_having", "Complex Having Operation");
  }

  // ORDER BY
  try {
    if (target.orderby) {
      const obObj = Array.isArray(target.orderby) ? target.orderby : [target.orderby];
      const orderElements = obObj.map((ob) => {
        const item = ((ob as { expr?: unknown }).expr || ob) as Record<string, unknown>;
        let colStr = "";
        if (item.table && item.column) {
            colStr = `${item.table}.${item.column}`;
        } else if (item.column) {
            colStr = String(item.column);
        } else {
            colStr = stringifyExpression(item);
        }
        const type = (ob as { type?: string }).type;
        return type ? `${colStr} ${type}` : colStr;
      }).join(", ");
      setNode("node_orderby", `ORDER BY ${sanitizeNoJson(orderElements)}`);
    }
  } catch {
    setNode("node_orderby", "Complex Order By Operation");
  }

  // LIMIT
  try {
    if (target.limit) {
      let limitStr = "";
      if (typeof target.limit === "object" && target.limit !== null && "value" in target.limit) {
        const limitVal = (target.limit as { value?: unknown }).value;
        limitStr =  Array.isArray(limitVal)
          ? limitVal
              .map((v) => ((v as { value?: unknown }).value ?? stringifyExpression(v)))
              .join(", ")
          : String(limitVal);
      } else {
        limitStr = stringifyExpression(target.limit);
      }
      setNode("node_limit", `LIMIT ${sanitizeNoJson(limitStr)}`);
    }
  } catch {
    setNode("node_limit", "Complex Limit Operation");
  }
  
  // Try processing unions
  try {
    if (target._next) {
       let curr = target._next as Record<string, unknown> | undefined;
       let uIndex = 1;
       while(curr) {
          if (isOverLimit()) break;
          setNode(`node_union_${uIndex}`, "UNION");
          const currClone = { ...curr };
          delete currClone._next;
          
          const subNodes = flattenAstToNodeMap(currClone as AstNode);
          for (const key in subNodes) {
             if (isOverLimit()) break;
             setNode(`${key}_u${uIndex}`, subNodes[key].sql, subNodes[key]);
          }
          curr = curr._next as Record<string, unknown> | undefined;
          uIndex++;
       }
    }
  } catch {
      setNode("node_union", "Complex Union Operation");
  }

  return nodes;
}


/** Utility to clean up stringified JSON if it somehow escapes */
function sanitizeNoJson(str: string): string {
  if (!str) return "";
  // Check if it's literal json like { "type": ... }
  if (str.includes("{") || str.includes("[")) {
    try {
      JSON.parse(str);
      // It is pure JSON. Provide a fallback so raw JSON never renders.
      return "[Complex Clause]";
    } catch {
      // It might be a string that happens to contain {, like a regular string.
      // But let's avoid rendering raw object formats.
      if (str.includes('{"') || str.includes('[{')) {
        return "[Complex Clause]";
      }
    }
  }
  return str;
}

/** Best-effort expression stringifier for WHERE/ON/HAVING clauses */
export function stringifyExpression(expr: unknown): string {
  if (!expr || typeof expr !== "object") return String(expr ?? "");

  // If array, recursively stringify
  if (Array.isArray(expr)) {
    return expr.map(x => stringifyExpression(x)).join(", ");
  }

  try {
    const e = expr as Record<string, unknown>;
    const argsObj =
      e.args && typeof e.args === "object" && !Array.isArray(e.args)
        ? (e.args as { expr?: unknown; exprList?: unknown[] })
        : null;

    if (e.type === "binary_expr") {
      const left = stringifyExpression(e.left);
      const right = stringifyExpression(e.right);
      return `${left} ${e.operator || ""} ${right}`;
    }
    if (e.type === "column_ref") {
      return e.table ? `${e.table}.${e.column}` : String(e.column);
    }
    if (e.type === "number" || e.type === "single_quote_string" || e.type === "string") {
      return String(e.value);
    }
    if (e.type === "aggr_func" || e.type === "function") {
      const name = e.name || "";
      let args = "";
      if (e.args) {
        if (argsObj?.expr !== undefined) {
          const exprArg = argsObj.expr;
          const exprRecord =
            exprArg && typeof exprArg === "object" ? (exprArg as { type?: string }) : null;
          if (exprRecord?.type === "star") {
            args = "*";
          } else {
            args = stringifyExpression(exprArg);
          }
        } else if (Array.isArray(argsObj?.exprList)) {
          args = argsObj.exprList
            .map((x) => {
              const xRecord = x && typeof x === "object" ? (x as { expr?: unknown }) : null;
              return stringifyExpression(xRecord?.expr ?? x);
            })
            .join(", ");
        } else if (Array.isArray(e.args)) {
          args = e.args.map((x: unknown) => stringifyExpression(x)).join(", ");
        } else {
          args = stringifyExpression(e.args);
        }
      }
      return `${name}(${args})`;
    }
    if (e.type === "star") {
      return "*";
    }

    // Backup extraction to avoid JSON serialization
    if (e.expr !== undefined) {
      return stringifyExpression(e.expr);
    }
    if (e.columns && Array.isArray(e.columns)) {
      return e.columns
        .map((c) => {
          const column = c as { expr?: unknown };
          return stringifyExpression(column.expr || c);
        })
        .join(", ");
    }
    if (e.value !== undefined) {
      return Array.isArray(e.value)
        ? e.value.map(v => stringifyExpression(v)).join(", ")
        : String(e.value);
    }
    if (e.column !== undefined) {
      return e.table ? `${e.table}.${e.column}` : String(e.column);
    }
    
    // Check for UNION or unhandled subquery expressions.
    if (e.ast) {
        return stringifyExpression(e.ast);
    }

    // Default fallback to JSON stringify, but caught by sanitizeNoJson later
    return JSON.stringify(expr);
  } catch {
    return "[Complex Expression]";
  }
}
