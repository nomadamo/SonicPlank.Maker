import { createRoot } from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { routeTree } from "./routeTree.gen";
import { useTheme, ThemeProvider } from "@/store/themeprovider";
import "./styles/globals.css";
import { Theme } from "@radix-ui/themes";

// Import the generated route tree (compiled by the TanStack Vite/Rsbuild plugin)

// window.electron.onMessage((event, data) => {
//   console.log("Data received from main process:", data, "From:", event);
//   // Update your UI here
// });

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: 1000 * 60 * 30,
      staleTime: 1000 * 60 * 5,
      refetchOnWindowFocus: false,
    },
  },
});

function Root() {
  // Create a new router instance using the generated tree
  const router = createRouter({
    routeTree,
    defaultStructuralSharing: true,
    context: {
      appTheme: useTheme().theme,
    },
  });
  return (
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>
  );
}

const body = document.getElementById("root");

if (!body) {
  throw new Error(
    'Root element not found. Ensure an element with id="root" exists in your HTML.',
  );
}

const root = createRoot(body);

root.render(
  <QueryClientProvider client={queryClient}>
    <Theme>
      <Root />
    </Theme>
  </QueryClientProvider>,
);
