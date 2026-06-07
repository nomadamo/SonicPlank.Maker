import { createRootRouteWithContext } from "@tanstack/react-router";
import App, { SonicContext } from "./App"; // Adjust the path to your App.tsx
import { LoadingAnimation } from "@/components/animations/loading-animation";
import ErrorBoundary from "@/components/errorboundary";
// import { FlowStoreProvider, useFlowStore } from "@/store/flowStoreProvider";
// import { appControl } from "@/utils/global";
import { ExitDialog } from "@/components/exit-dialog";
import { StateMachineProvider } from "@/store/stateMachine";
import { WaveSurferProvider } from "@/store/wavesurferprovider";

// Bind your App component as the root route layout
export const Route = createRootRouteWithContext<SonicContext>()({
  component: () => {
    return (
      <WaveSurferProvider>
        <StateMachineProvider>
          <ExitDialog />
          <App />
        </StateMachineProvider>
      </WaveSurferProvider>
    );
  },
  pendingComponent: LoadingAnimation,
  wrapInSuspense: true,
  errorComponent: ErrorBoundary,
});
