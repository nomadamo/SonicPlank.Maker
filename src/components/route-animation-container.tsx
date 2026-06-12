// components/route-animation-container.tsx
import { useRouter } from "@tanstack/react-router";
import { AnimatePresence } from "motion/react";
import { ReactNode } from "react";

interface RouteAnimationContainerProps {
  children: ReactNode;
}

export function RouteAnimationContainer({
  children,
}: RouteAnimationContainerProps) {
  const router = useRouter();

  return (
    <AnimatePresence mode="wait" initial={false}>
      <div key={router.state.location.pathname}>{children}</div>
    </AnimatePresence>
  );
}
