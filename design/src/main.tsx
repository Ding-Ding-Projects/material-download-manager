import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import CompletionWindow from "./components/CompletionWindow";
import BrowserHandoffStartWindow from "./components/BrowserHandoffStartWindow";
import ProgressWindow from "./components/ProgressWindow";
import "./styles/theme.css";
import "./styles/global.css";

const isProgressWindow = new URLSearchParams(window.location.search).get("view") === "progress";
const isBrowserHandoffWindow = new URLSearchParams(window.location.search).get("view") === "browser-handoff";
const isCompletionWindow = new URLSearchParams(window.location.search).get("view") === "completion";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isProgressWindow ? <ProgressWindow /> : isBrowserHandoffWindow ? <BrowserHandoffStartWindow /> : isCompletionWindow ? <CompletionWindow /> : <App />}
  </React.StrictMode>
);
