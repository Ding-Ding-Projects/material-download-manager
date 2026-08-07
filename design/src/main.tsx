import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import ProgressWindow from "./components/ProgressWindow";
import "./styles/theme.css";
import "./styles/global.css";

const isProgressWindow = new URLSearchParams(window.location.search).get("view") === "progress";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isProgressWindow ? <ProgressWindow /> : <App />}
  </React.StrictMode>
);
