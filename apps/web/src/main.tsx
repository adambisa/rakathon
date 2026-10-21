import "#styles.css";

import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { AppProviders } from "#providers/app-providers";
import { router } from "#router";

const rootElement = document.querySelector("#root");
if (!rootElement) {
  throw new Error("#root not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  </StrictMode>,
);
