import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@eigen-air-ui/ui/styles";
import { initServices } from "./init";
import App from "./App";

initServices();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
