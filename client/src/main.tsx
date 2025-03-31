import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { TutorialProvider } from "./contexts/tutorial-context";

createRoot(document.getElementById("root")!).render(
  <TutorialProvider>
    <App />
  </TutorialProvider>
);
