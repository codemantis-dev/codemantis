import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Show visible error if React fails to mount
window.addEventListener("error", (e) => {
  const root = document.getElementById("root");
  if (root && !root.hasChildNodes()) {
    root.innerHTML = `<div style="color:#f87171;padding:40px;font-family:monospace;white-space:pre-wrap;">
      <h2 style="color:#e4e4e7;margin-bottom:12px;">ClaudeForge failed to start</h2>
      ${e.message}\n${e.filename}:${e.lineno}
    </div>`;
  }
});

window.addEventListener("unhandledrejection", (e) => {
  console.error("[unhandled rejection]", e.reason);
});

try {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
} catch (e) {
  const root = document.getElementById("root");
  if (root) {
    root.innerHTML = `<div style="color:#f87171;padding:40px;font-family:monospace;white-space:pre-wrap;">
      <h2 style="color:#e4e4e7;margin-bottom:12px;">ClaudeForge failed to start</h2>
      ${e}
    </div>`;
  }
}
