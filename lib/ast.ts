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
  if (target.columns) {
    if (target.columns === "*") {
      nodes["node_select"] = "SELECT *";
    } else if (Array.isArray(target.columns)) {
      const cols = target.columns
        .map((c: { expr?: { column?: string; table?: string }; as?: string }) => {
          const col = c.expr?.table
            ? `${c.expr.table}.${c.expr.column}`
            : c.expr?.column || "*";
          return c.as ? `${col} AS ${c.as}` : col;
        })
        .join(", ");
      nodes["node_select"] = `SELECT ${target.distinct ? "DISTINCT " : ""}${cols}`;
    }
  }

  // FROM tables & JOINs
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

  // WHERE
  if (target.where) {
    nodes["node_where"] = `WHERE ${stringifyExpression(target.where)}`;
  }

  // GROUP BY
  if (target.groupby) {
    if (Array.isArray(target.groupby)) {
      const groupElements = target.groupby.map((gb: any) => stringifyExpression(gb.expr || gb)).join(", ");
      nodes["node_groupby"] = `GROUP BY ${groupElements}`;
    } else {
      nodes["node_groupby"] = `GROUP BY ${stringifyExpression(target.groupby)}`;
    }
  }

  // HAVING
  if (target.having) {
    if (Array.isArray(target.having)) {
      const havingElements = target.having.map((h: any) => stringifyExpression(h.expr || h)).join(", ");
      nodes["node_having"] = `HAVING ${havingElements}`;
    } else {
      nodes["node_having"] = `HAVING ${stringifyExpression(target.having)}`;
    }
  }

  // ORDER BY
  if (target.orderby) {
    if (Array.isArray(target.orderby)) {
      const orderElements = target.orderby.map((ob: any) => {
        const exprStr = stringifyExpression(ob.expr || ob);
        return ob.type ? `${exprStr} ${ob.type}` : exprStr;
      }).join(", ");
      nodes["node_orderby"] = `ORDER BY ${orderElements}`;
    } else {
      nodes["node_orderby"] = `ORDER BY ${stringifyExpression(target.orderby)}`;
    }
  }

  // LIMIT
  if (target.limit) {
    if (typeof target.limit === "object" && target.limit !== null && "value" in target.limit) {
      const limitVal = (target.limit as any).value;
      const limitStr = Array.isArray(limitVal) ? limitVal.map((v: any) => v.value ?? stringifyExpression(v)).join(", ") : limitVal;
      nodes["node_limit"] = `LIMIT ${limitStr}`;
    } else {
      nodes["node_limit"] = `LIMIT ${stringifyExpression(target.limit)}`;
    }
  }

  return nodes;
}

/** Best-effort expression stringifier for WHERE/ON/HAVING clauses */
export function stringifyExpression(expr: unknown): string {
  if (!expr || typeof expr !== "object") return String(expr ?? "");

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

  return JSON.stringify(expr);
}
