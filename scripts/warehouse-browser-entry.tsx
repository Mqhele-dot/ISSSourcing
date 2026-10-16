import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "../client/src/lib/queryClient";
import InventoryPositions from "../client/src/pages/inventory-positions";
import { ItemRequestDialog } from "../client/src/components/inventory/item-request-dialog";
import "../client/src/index.css";
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <main style={{padding:16,maxWidth:1200,margin:"auto"}}>
      <p>Disposable integration fixture — not your live database</p>
      <ItemRequestDialog/>
      <InventoryPositions/>
    </main>
  </QueryClientProvider>,
);
