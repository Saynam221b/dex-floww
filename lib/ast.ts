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
  [key: string]: unknown;
}

export function flattenAstToNodeMap(ast: AstNode | AstNode[]): Record<string, string> {
  const nodes: Record<string, string> = {};
  const target: AstNode = Array.isArray(ast) ? ast[0] : ast;

  if (!target) return nodes;

  // SELECT columns
  try {
    if (target.columns) {
      if (target.columns === "*") {
        nodes["node_select"] = "SELECT *";
      } else if (Array.isArray(target.columns)) {
        const cols = target.columns.map((c: any) => {
          const item = c.expr || c;
          const table = item.table;
          const colname = item.column;
          let colStr = "";
          if (table && colname) {
             colStr = `${table}.${colname}`;
          } else if (colname) {
             colStr = colname;
          } else {
             colStr = stringifyExpression(item);
          }
          return c.as ? `${colStr} AS ${c.as}` : colStr;
        }).join(", ");
        nodes["node_select"] = `SELECT ${target.distinct ? "DISTINCT " : ""}${cols}`;
      }
    }
  } catch {
    nodes["node_select"] = "Complex Select Operation";
  }

  // FROM tables & JOINs
  try {
    if (Array.isArray(target.from)) {
      let joinIdx = 0;
      target.from.forEach((src, i) => {
        const tableName = src.as ? `${src.table} AS ${src.as}` : src.table || `source_${i}`;

        if (src.join) {
          joinIdx++;
          const onClause = src.on ? ` ON ${stringifyExpression(src.on)}` : "";
          nodes[`node_join_${joinIdx}`] = `${src.join} JOIN ${tableName}${onClause}`;
        } else {
          nodes[`node_from_${i + 1}`] = `FROM ${tableName}`;
        }
      });
    }
  } catch {
    nodes["node_from"] = "Complex From Operation";
  }

  // WHERE
  try {
    if (target.where) {
      nodes["node_where"] = `WHERE ${sanitizeNoJson(stringifyExpression(target.where))}`;
    }
  } catch {
    nodes["node_where"] = "Complex Where Operation";
  }

  // GROUP BY
  try {
    if (target.groupby) {
      const gbObj = Array.isArray(target.groupby) ? target.groupby : [target.groupby];
      const cols = gbObj.map((g: any) => {
        const item = g.expr || g;
        if (item.table && item.column) return `${item.table}.${item.column}`;
        if (item.column) return item.column;
        return stringifyExpression(item);
      }).join(", ");
      nodes["node_groupby"] = `GROUP BY ${sanitizeNoJson(cols)}`;
    }
  } catch {
    nodes["node_groupby"] = "Complex Group By Operation";
  }

  // HAVING
  try {
    if (target.having) {
      let havingElements = "";
      if (Array.isArray(target.having)) {
        havingElements = target.having.map((h: any) => stringifyExpression(h.expr || h)).join(", ");
      } else {
        havingElements = stringifyExpression(target.having);
      }
      nodes["node_having"] = `HAVING ${sanitizeNoJson(havingElements)}`;
    }
  } catch {
    nodes["node_having"] = "Complex Having Operation";
  }

  // ORDER BY
  try {
    if (target.orderby) {
      const obObj = Array.isArray(target.orderby) ? target.orderby : [target.orderby];
      const orderElements = obObj.map((ob: any) => {
        const item = ob.expr || ob;
        let colStr = "";
        if (item.table && item.column) {
            colStr = `${item.table}.${item.column}`;
        } else if (item.column) {
            colStr = item.column;
        } else {
            colStr = stringifyExpression(item);
        }
        return ob.type ? `${colStr} ${ob.type}` : colStr;
      }).join(", ");
      nodes["node_orderby"] = `ORDER BY ${sanitizeNoJson(orderElements)}`;
    }
  } catch {
    nodes["node_orderby"] = "Complex Order By Operation";
  }

  // LIMIT
  try {
    if (target.limit) {
      let limitStr = "";
      if (typeof target.limit === "object" && target.limit !== null && "value" in target.limit) {
        const limitVal = (target.limit as any).value;
        limitStr =  Array.isArray(limitVal) ? limitVal.map((v: any) => v.value ?? stringifyExpression(v)).join(", ") : String(limitVal);
      } else {
        limitStr = stringifyExpression(target.limit);
      }
      nodes["node_limit"] = `LIMIT ${sanitizeNoJson(limitStr)}`;
    }
  } catch {
    nodes["node_limit"] = "Complex Limit Operation";
  }
  
  // Try processing unions
  try {
    if (target._next) {
       // UNION queries have _next recursively in node-sql-parser
       let curr: any = target._next;
       let uIndex = 1;
       while(curr) {
          nodes[`node_union_${uIndex}`] = `UNION`;
          const subNodes = flattenAstToNodeMap(curr);
          for (const key in subNodes) {
             nodes[`${key}_u${uIndex}`] = subNodes[key];
          }
          curr = curr._next;
          uIndex++;
       }
    }
  } catch {
      nodes["node_union"] = "Complex Union Operation";
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
        if ((e.args as any).expr) {
          if ((e.args as any).expr.type === "star") {
            args = "*";
          } else {
            args = stringifyExpression((e.args as any).expr);
          }
        } else if (Array.isArray((e.args as any).exprList)) {
          args = (e.args as any).exprList.map((x: any) => stringifyExpression(x.expr || x)).join(", ");
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
      return e.columns.map((c: any) => stringifyExpression(c.expr || c)).join(", ");
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

