import { createRootRoute, Outlet, useLocation } from "@tanstack/react-router";
import App from "./App"; // Adjust the path to your App.tsx
import { LoadingAnimation } from "@/components/animations/loading-animation";
import ErrorBoundary from "@/components/errorboundary";
import { ExitDialog } from "@/components/exit-dialog";
import { StateMachineProvider } from "@/store/stateMachine";
import { useSetAtom } from "jotai";
import { initSpotifyFromStorage } from "@/store/libraryStore";
import { useEffect } from "react";

function RootComponent() {
  const location = useLocation();
  const isPreview = location.pathname === "/preview";
  const isOverlay = location.pathname === "/overlay";

  const initSpotify = useSetAtom(initSpotifyFromStorage);
  useEffect(() => {
    void initSpotify();
  }, []);

  if (isPreview || isOverlay) {
    return (
      <StateMachineProvider>
        <Outlet />
      </StateMachineProvider>
    );
  }

  return (
    <StateMachineProvider>
      <ExitDialog />
      <App />
    </StateMachineProvider>
  );
}

// Bind your App component as the root route layout
export const Route = createRootRoute({
  component: RootComponent,
  pendingComponent: LoadingAnimation,
  wrapInSuspense: true,
  errorComponent: ErrorBoundary,
});
