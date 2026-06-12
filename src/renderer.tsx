import { createRoot } from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import "./styles/globals.css";

// Import the generated route tree (compiled by the TanStack Vite/Rsbuild plugin)

// Create the router ONCE, outside of any component
const router = createRouter({
  routeTree,
  defaultStructuralSharing: true,
});

const body = document.getElementById("root");

if (!body) {
  throw new Error(
    'Root element not found. Ensure an element with id="root" exists in your HTML.',
  );
}

const root = createRoot(body);
root.render(<RouterProvider router={router} />);
