import type { FC } from "react";
import { AdaptiveErrorBoundary } from "@cognicatch/react";

export default function ErrorBoundary({ error }: { error: Error }) {
  return (
    // Lock the screen for critical errors
    <AdaptiveErrorBoundary showRefresh={true} error={error} />
  );
}
