import { AnimatedRoute } from "@/components/animated-route";
import { LoadingAnimation } from "@/components/animations/loading-animation";
import { createFileRoute } from "@tanstack/react-router";
import { ClapperboardIcon, PlusIcon } from "lucide-react";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/scenes")({
  component: Scenes,
  pendingComponent: LoadingAnimation,
});

function Scenes() {
  return (
    <AnimatedRoute variant="fade">
      <div
        className="flex flex-col items-center justify-center mt-13"
        style={{ height: "calc(100vh - 125px)" }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.1, duration: 0.3 }}
          className="flex flex-col items-center gap-4"
        >
          <ClapperboardIcon
            className="text-muted-foreground"
            size={56}
            strokeWidth={1}
            style={{ opacity: 0.5 }}
          />
          <h2 className="text-xl font-medium text-muted-foreground">
            No scenes yet
          </h2>
          <p className="text-sm text-muted-foreground/70 max-w-sm text-center">
            Scenes let you switch between different stream layouts instantly.
          </p>
          <Button variant="outline" size="lg" className="gap-2 mt-2" disabled>
            <PlusIcon className="h-4 w-4" />
            New Scene
          </Button>
        </motion.div>
      </div>
    </AnimatedRoute>
  );
}
