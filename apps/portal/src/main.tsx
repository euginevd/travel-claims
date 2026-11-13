import "@fontsource/plus-jakarta-sans/latin-400.css";
import "@fontsource/plus-jakarta-sans/latin-500.css";
import "@fontsource/plus-jakarta-sans/latin-600.css";
import "@fontsource/plus-jakarta-sans/latin-700.css";
import "@fontsource/newsreader/latin-400.css";
import "@fontsource/newsreader/latin-400-italic.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import "./brand.css";
import "./chat/chat.css";

const root = document.getElementById("root");
if (!root) throw new Error("The page has no #root element");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
