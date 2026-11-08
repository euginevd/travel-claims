import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "@fontsource/geist/latin-600.css";
import "@fontsource/geist-mono/latin-400.css";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-600.css";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("The page has no #root element");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
