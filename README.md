# 🌌 D3xTRverse Flow

**The ultimate companion for Data Engineers and SQL Architects. Visualize. Decode. Dominate.**

![D3xTRverse Flow Hero](./public/hero.png)

> **D3xTRverse Flow** transforms raw, tangled SQL strings into clear, interactive Directed Acyclic Graphs (DAGs) powered by deterministic AST parsing and deterministic-first AI enrichment. Graph semantics never depend on an LLM response.

---

## ⚡ The Chaos to Clarity Promise

**The Problem:** Legacy SQL is a labyrinth. Subqueries nested 5 levels deep, 10-way joins across fragmented schemas, and parallel CTEs make mental modeling a slow, error-prone nightmare. Reading someone else's code shouldn't feel like deciphering an ancient scroll.

**The Solution:** Instant, deterministic visualization. **D3xTRverse Flow** parses your SQL using a strict Abstract Syntax Tree (AST), maps out the data flow with mathematical precision, and leverages language models to generate a play-by-play of exactly what's happening at every node.

---

## 🚀 Core Capabilities

*   **🎯 Deterministic AST Parsing:** 100% accurate node relationships. Handles complex `JOIN` logic, parallel `CTE`s, `UNION`s, and deeply nested subqueries with a rigorous AST-to-Graph pipeline backed by `node-sql-parser`.
*   **🧠 Deterministic-First Insights:** Every node gets a heuristic baseline explanation instantly; Groq enrichment is optional for low-confidence nodes.
*   **👶 ELI5 Mode:** Hit the "Explain Like I'm 5" button on any complex node to fetch a real-world analogy for the underlying SQL logic. 
*   **📤 Frictionless State Syncing:** Your entire query state is encoded directly into the URL using `lz-string`. Just copy the link and share your exact workspace state with your team—no backend storage required.
*   **📸 High-Res Canvas Export:** 1-click PNG/SVG export of the DAG for technical documentation or PR descriptions.
*   **🎮 Premium Cyberpunk Environment:** Built with a dark "Classy Modern Gaming" aesthetic. Features **Monaco/CodeMirror** integration, glassmorphic node styling, ambient glow fields, and **Framer Motion** for precise state transitions.

---

## 🛠️ Architecture & Stack

| Layer | Technology |
| :--- | :--- |
| **Framework** | [Next.js 16.2.2 (App Router)](https://nextjs.org/), [React 19](https://reactjs.org/) |
| **Parsing Engine** | [node-sql-parser](https://github.com/taozhi8833932/node-sql-parser) |
| **Layout & Metrics** | [Dagre](https://github.com/dagrejs/dagre) (Auto-routing & Coordinates) |
| **LLM Inference** | [Groq SDK](https://groq.com/) (Llama 3.3 70B) with automatic key rotation |
| **Canvas** | [React Flow (XYFlow)](https://reactflow.dev/) |
| **Styling & Motion** | [Tailwind CSS 4](https://tailwindcss.com/) + [Framer Motion](https://www.framer.com/motion/) |
| **Utilities** | `lz-string` (Compression), `html-to-image` (Export) |

### Pipeline Workflow

1.  **Lexical Analysis:** Raw SQL is fed into the parser to generate a comprehensive AST.
2.  **Transmutation:** The system flattens the AST into a hierarchical `NodeMap` representing sources (`FROM`), transformations (`JOIN`, `WHERE`), and outputs (`SELECT`), grouping them by CTE context.
3.  **Algorithmic Layout:** The Dagre engine calculates X/Y coordinates to ensure a clean, collision-free Left-to-Right DAG layout.
4.  **Inference Layer:** The system generates deterministic heuristic explanations first, then applies optional Groq enrichment.
5.  **Reactive Canvas:** React Flow mounts the Nodes and Edges, injecting interactive states, dynamic edge highlighting, and glassmorphic styling.

---

## 🏁 Quick Start

### 1. Clone & Install
```bash
git clone https://github.com/Saynam221b/dex-floww.git
cd dex-floww
npm install
```

### 2. Environment Setup
Create a `.env.local` file based on `.env.example` and add your Groq API keys. The application supports key rotation for rate-limit resilience.
```env
GROQ_API_KEY_1=gsk_your_primary_key
```

### 3. Run Development
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to spin up the workspace.

---

## ✅ Validation Commands

```bash
npm run lint
npm run test
npm run test:integration
npm run test:e2e
npm run test:perf-smoke
```

---

## 🔌 API Contracts

### `POST /api/parse`
- Default response: `{ requestId, graph, warnings, metrics }`
- Compatibility mode: append `?verbose=1` to include `ast` and `nodeMap`.

### `POST /api/explain`
- Request accepts normalized graph node map.
- Response includes `{ explanations, source, cached, requestId }`.
- `source` is `heuristic` or `hybrid`; deterministic fallback is always available.

### `POST /api/optimize`
- Always returns deterministic confidence metadata.
- If LLM is unavailable, returns deterministic fallback with explicit `fallbackReason`.

### `POST /api/explain-eli5`
- Rate limited and cached.
- Deterministic fallback is always available when enrichment is unavailable.

---

## 🛡️ Production Readiness

- **Secret Management:** API keys are restricted strictly to server-side Next.js `/api/*` routes. No `NEXT_PUBLIC_` secrets are exposed.
- **Resilience:** The API layer implements key rotation, deterministic fallbacks, per-route rate limiting, and bounded TTL+LRU caches.
- **Performance Guardrails:** CI enforces perf-smoke budgets for visualize, click-highlight, deterministic explain fallback, and export latency.

---

## 🎭 Author

**Built by Saynam | D3xTRverse**

*   [Portfolio](https://saynam-portfolio-19qy.vercel.app/)
*   [GitHub](https://github.com/Saynam221b)
*   [X / Twitter](https://x.com/d3xtrverse)

---

*Because reading code shouldn't require a whiteboard.*
