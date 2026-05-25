import React from "react";
import { createRoot } from "react-dom/client";

// Placeholder SPA. The real views (timeline, board, audit drawer) land in
// later tasks per design/dashboard.md.
function App(): JSX.Element {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 24 }}>
      <h1>Agent Dashboard</h1>
      <p>Skeleton only — views land in later layers.</p>
    </main>
  );
}

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root not found");
createRoot(rootEl).render(<App />);
