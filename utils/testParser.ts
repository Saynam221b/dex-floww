/* eslint-disable @typescript-eslint/no-explicit-any */
import { Parser } from "node-sql-parser";
import { flattenAstToNodeMap, type AstNode } from "@/lib/ast";

const COMPLEX_QUERIES = [
  // 1. UNION with complex expressions
  `SELECT u.id, u.name FROM users u WHERE u.status = 'active'
   UNION
   SELECT a.id, a.name FROM admins a WHERE a.role = 'superadmin'`,

  // 2. Nested Subqueries in FROM and SELECT
  `SELECT (SELECT MAX(score) FROM game_stats) as max_score, t.team_name, t.city
   FROM (SELECT id, name AS team_name, city FROM teams WHERE active = 1) t
   WHERE t.id IN (1, 2, 3)`,

  // 3. Multiple JOIN types with complex ON conditions
  `SELECT o.order_id, c.name, p.product_name, COALESCE(s.status, 'pending')
   FROM orders o
   INNER JOIN customers c ON o.customer_id = c.id
   LEFT JOIN products p ON o.product_id = p.id AND p.is_active = 1
   RIGHT JOIN shipments s ON o.order_id = s.order_id
   WHERE o.total > 1000`,

  // 4. Combined GROUP BY, HAVING, ORDER BY, LIMIT
  `SELECT department, COUNT(id) as employee_count, AVG(salary) as avg_salary
   FROM employees
   WHERE hire_date > '2020-01-01'
   GROUP BY department
   HAVING avg_salary > 75000 AND employee_count > 5
   ORDER BY avg_salary DESC, employee_count ASC
   LIMIT 10`,

  // 5. Boss Fight Query (Multiple columns in GROUP BY and ORDER BY)
  `SELECT c.name, c.id, SUM(o.total) as LTV
   FROM customers c
   JOIN orders o ON c.id = o.customer_id
   WHERE c.status = 'VIP'
   GROUP BY c.name, c.id
   ORDER BY LTV DESC, c.name ASC
   LIMIT 50`,

  // 6. Complex Aggr filters and distinct
  `SELECT DISTINCT a.region, count(DISTINCT b.store_id)
   FROM regions a
   LEFT JOIN stores b ON a.id = b.region_id
   GROUP BY a.region
   ORDER BY a.region`,

  // 7. Case Statements (Node-sql-parser might treat these as complex expressions)
  `SELECT employee_id,
          CASE WHEN salary > 100000 THEN 'High' WHEN salary > 50000 THEN 'Medium' ELSE 'Low' END as salary_band
   FROM payroll
   ORDER BY salary DESC`,

  // 8. Deeply nested where conditions with arithmetic
  `SELECT inventory_id, item_name, stock * price AS total_value
   FROM inventory
   WHERE (stock > 0) OR (price = 100)
   ORDER BY total_value DESC`
];

export function runParserDiagnostics() {
  console.log("🛠️ Starting AST Parser Diagnostics...");
  const parser = new Parser();
  let passed = 0;

  COMPLEX_QUERIES.forEach((query, index) => {
    try {
      const ast = parser.astify(query);
      const flattened = flattenAstToNodeMap(ast as unknown as AstNode);

      // Check for raw JSON leakage
      for (const [key, value] of Object.entries(flattened)) {
        if (typeof value !== "string") {
            throw new Error(`Non-string value found at ${key}`);
        }
        if (value.includes('{"') || value.includes('[{')) {
            throw new Error(`Raw JSON detected in node ${key}: ${value}`);
        }
      }
      passed++;
      console.log(`✅ Query ${index + 1} passed`);
    } catch (err: any) {
      console.error(`❌ Query ${index + 1} failed:`, err.message);
      throw new Error(`Diagnostic failed on Query ${index + 1}. See console for details.`);
    }
  });

  if (passed === COMPLEX_QUERIES.length) {
    console.log("🟢 All Tests Passed. The AST Parser is Bulletproof.");
  }
}
