import "@rainbow-me/rainbowkit/styles.css";

import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import { App } from "@/App";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { registerLazyLoadRecovery } from "@/lib/lazyLoadRecovery";
import { AppProviders } from "@/providers/AppProviders";
import { BoosterOpeningProvider } from "@/providers/BoosterOpeningProvider";

import "@/globals.css";

registerLazyLoadRecovery();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AppProviders>
        <AppErrorBoundary>
          <BoosterOpeningProvider>
            <App />
          </BoosterOpeningProvider>
        </AppErrorBoundary>
      </AppProviders>
    </BrowserRouter>
  </React.StrictMode>
);
