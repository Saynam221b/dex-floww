export interface SqlWorkload {
  name: "tiny" | "medium" | "large" | "cte-heavy" | "union-heavy";
  sql: string;
  dialect: "mysql" | "postgresql" | "sqlite" | "transactsql";
}

export const WORKLOADS: SqlWorkload[] = [
  {
    name: "tiny",
    dialect: "mysql",
    sql: `SELECT id, email FROM users WHERE active = 1 ORDER BY created_at DESC LIMIT 20;`,
  },
  {
    name: "medium",
    dialect: "mysql",
    sql: `SELECT c.name, COUNT(o.id) AS order_count, SUM(o.total) AS revenue
FROM customers c
JOIN orders o ON c.id = o.customer_id
JOIN order_items oi ON o.id = oi.order_id
WHERE o.created_at >= '2025-01-01'
GROUP BY c.name
HAVING SUM(o.total) > 1000
ORDER BY revenue DESC
LIMIT 50;`,
  },
  {
    name: "large",
    dialect: "postgresql",
    sql: `SELECT
  u.id,
  u.email,
  r.region_name,
  SUM(CASE WHEN o.status = 'paid' THEN o.total ELSE 0 END) AS paid_revenue,
  COUNT(DISTINCT o.id) AS order_count,
  AVG(CASE WHEN o.status = 'paid' THEN o.total END) AS avg_paid_order,
  MAX(o.created_at) AS last_order_at
FROM users u
JOIN accounts a ON a.user_id = u.id
JOIN regions r ON r.id = a.region_id
LEFT JOIN orders o ON o.account_id = a.id
LEFT JOIN order_items oi ON oi.order_id = o.id
LEFT JOIN products p ON p.id = oi.product_id
LEFT JOIN categories cat ON cat.id = p.category_id
WHERE u.deleted_at IS NULL
  AND a.is_test = FALSE
  AND (cat.name IS NULL OR cat.name <> 'internal')
GROUP BY u.id, u.email, r.region_name
HAVING COUNT(DISTINCT o.id) > 3
ORDER BY paid_revenue DESC, order_count DESC
LIMIT 150;`,
  },
  {
    name: "cte-heavy",
    dialect: "mysql",
    sql: `WITH signups AS (
  SELECT user_id, DATE(created_at) AS signup_date
  FROM users
  WHERE created_at >= '2025-01-01'
),
first_purchase AS (
  SELECT s.user_id, s.signup_date, MIN(o.order_date) AS first_order_date
  FROM signups s
  JOIN orders o ON s.user_id = o.user_id
  GROUP BY s.user_id, s.signup_date
),
retention AS (
  SELECT
    signup_date,
    COUNT(DISTINCT user_id) AS converted_users,
    AVG(DATEDIFF(first_order_date, signup_date)) AS avg_days_to_convert
  FROM first_purchase
  GROUP BY signup_date
),
regional_rollup AS (
  SELECT
    r.name AS region,
    DATE(o.order_date) AS day,
    SUM(o.total) AS revenue
  FROM orders o
  JOIN users u ON u.id = o.user_id
  JOIN regions r ON r.id = u.region_id
  GROUP BY r.name, DATE(o.order_date)
)
SELECT rr.region, rr.day, rr.revenue, rt.converted_users, rt.avg_days_to_convert
FROM regional_rollup rr
JOIN retention rt ON rt.signup_date = rr.day
ORDER BY rr.day DESC, rr.revenue DESC
LIMIT 200;`,
  },
  {
    name: "union-heavy",
    dialect: "postgresql",
    sql: `SELECT user_id, event_at, 'login' AS event_type
FROM login_events
WHERE event_at >= NOW() - INTERVAL '30 day'
UNION ALL
SELECT user_id, purchase_at AS event_at, 'purchase' AS event_type
FROM purchases
WHERE purchase_at >= NOW() - INTERVAL '30 day'
UNION ALL
SELECT user_id, refund_at AS event_at, 'refund' AS event_type
FROM refunds
WHERE refund_at >= NOW() - INTERVAL '30 day'
UNION ALL
SELECT user_id, support_at AS event_at, 'support' AS event_type
FROM support_tickets
WHERE support_at >= NOW() - INTERVAL '30 day'
ORDER BY event_at DESC
LIMIT 500;`,
  },
];
