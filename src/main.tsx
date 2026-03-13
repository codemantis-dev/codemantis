import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Show visible error if React fails to mount
window.addEventListener("error", (e) => {
  const root = document.getElementById("root");
  if (root && !root.hasChildNodes()) {
    const wrapper = document.createElement("div");
    wrapper.style.cssText = "color:#f87171;padding:40px;font-family:monospace;white-space:pre-wrap;";
    const heading = document.createElement("h2");
    heading.style.cssText = "color:#e4e4e7;margin-bottom:12px;";
    heading.textContent = "CodeMantis failed to start";
    const details = document.createElement("pre");
    details.textContent = `${e.message}\n${e.filename}:${e.lineno}`;
    wrapper.appendChild(heading);
    wrapper.appendChild(details);
    root.appendChild(wrapper);
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
    const wrapper = document.createElement("div");
    wrapper.style.cssText = "color:#f87171;padding:40px;font-family:monospace;white-space:pre-wrap;";
    const heading = document.createElement("h2");
    heading.style.cssText = "color:#e4e4e7;margin-bottom:12px;";
    heading.textContent = "CodeMantis failed to start";
    const details = document.createElement("pre");
    details.textContent = String(e);
    wrapper.appendChild(heading);
    wrapper.appendChild(details);
    root.appendChild(wrapper);
  }
}
