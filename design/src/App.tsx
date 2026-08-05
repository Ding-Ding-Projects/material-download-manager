import { useEffect, useState } from "react";
import type { StateSnapshot } from "@shared/types";

// Placeholder root component. This gets fleshed out into the full
// AB-Download-Manager-style UI (title bar, sidebar, download list, dialogs).
export default function App() {
  const [state, setState] = useState<StateSnapshot | null>(null);

  useEffect(() => {
    window.api.getState().then(setState);
    return window.api.onStateChanged(setState);
  }, []);

  return (
    <div style={{ color: "#e6e6e6", padding: 24, fontFamily: "sans-serif" }}>
      <h1>Material Download Manager</h1>
      <p>{state ? `${state.items.length} downloads tracked` : "Loading…"}</p>
    </div>
  );
}
