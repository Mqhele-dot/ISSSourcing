import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { ShepherdJourneyProvider } from 'react-shepherd';
import { TutorialProvider } from "./contexts/TutorialContext";

// Shepherd tour options
const tourOptions = {
  defaultStepOptions: {
    cancelIcon: {
      enabled: true
    },
    classes: 'shadow-md rounded-lg',
    scrollTo: true
  },
  useModalOverlay: true
};

createRoot(document.getElementById("root")!).render(
  <ShepherdJourneyProvider config={tourOptions}>
    <App />
  </ShepherdJourneyProvider>
);
