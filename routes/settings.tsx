import { AnimatedRoute } from "@/components/animated-route";
import { LoadingAnimation } from "@/components/animations/loading-animation";
import { createFileRoute } from "@tanstack/react-router";
import { motion } from "motion/react";

export const Route = createFileRoute("/settings")({
  // Optional: You can intercept the theme context before loading data
  beforeLoad: () => {
    // console.log("Current theme in loader:", context.appTheme);
    console.log("Settings page");
  },
  component: Settings,
  pendingComponent: LoadingAnimation,
});

function Settings() {
  return (
    <AnimatedRoute variant="fade">
      <motion.h1
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.25 }}
        className="text-3xl font-bold mb-6"
      >
        Settings
      </motion.h1>
    </AnimatedRoute>
  );
}
