"use client";

import { useState, useRef, useEffect, ReactElement, Ref } from "react";
import { motion } from "framer-motion";
import {
  createLink,
  Link,
  LinkComponent,
  LinkComponentProps,
  useLocation,
} from "@tanstack/react-router";
import React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface TabProps {
  id: number;
  label: string;
  icon: ReactElement;
  to?: string | undefined;
  className?: string | undefined;
}

interface ButtonLinkProps extends React.ComponentPropsWithoutRef<
  typeof Button
> {}

const ButtonLinkComponent = React.forwardRef<
  HTMLAnchorElement,
  ButtonLinkProps
>(({ className, ...props }, ref) => {
  return (
    <Button
      ref={ref as any}
      {...props}
      size="icon-xs"
      variant="ghost"
      type="button"
      className={cn(
        "relative flex flex-row rounded-full items-center justify-center flex-1 px-3 py-1.5 font-medium text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/20 transition-all duration-200 [&.active]:text-zinc-100 [&.active]:font-semibold",
        className,
      )}
    />
  );
});

const RouteButtonComponent = createLink(ButtonLinkComponent);

const RouteButton: LinkComponent<typeof RouteButtonComponent> = (props) => {
  return <RouteButtonComponent preload={"intent"} {...props} />;
};

const FloatingNav = ({ items }: { items: TabProps[] }) => {
  const [active, setActive] = useState(0);
  const [indicatorStyle, setIndicatorStyle] = useState({ width: 0, left: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<(HTMLElement | null)[]>([]);
  const location = useLocation();

  // Sync active state with the current route
  useEffect(() => {
    const currentIndex = items.findIndex(
      (item) => item.to === location.pathname,
    );
    if (currentIndex !== -1 && currentIndex !== active) {
      setActive(currentIndex);
    }
  }, [location.pathname, items, active]);

  // Update indicator position when active changes or resize
  useEffect(() => {
    const updateIndicator = () => {
      if (btnRefs.current[active] && containerRef.current) {
        const btn = btnRefs.current[active];
        const container = containerRef.current;
        if (!btn) return;
        const btnRect = btn.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();

        setIndicatorStyle({
          width: btnRect.width,
          left: btnRect.left - containerRect.left,
        });
      }
    };

    updateIndicator();
    window.addEventListener("resize", updateIndicator);
    return () => window.removeEventListener("resize", updateIndicator);
  }, [active]);

  return (
    <div className="absolute left-1/2 z-50 -translate-x-1/2 w-dvw rounded-full max-w-lg mt-15 px-20">
      <div
        ref={containerRef}
        className="relative bg-zinc-950/80 backdrop-blur-md flex items-center justify-between font-medium shadow-2xl rounded-full gap-2 px-1 py-1 border border-zinc-800"
      >
        {items.map((item, index) => (
          <RouteButton
            key={item.id}
            ref={(el) => {
              btnRefs.current[index] = el;
            }}
            to={item.to}
            className={item?.className ? item.className : ""}
          >
            <div className="z-10 pr-2">{item.icon}</div>
            {/* hide labels on small screens */}
            <span className="text-xs hidden sm:block">{item.label}</span>
          </RouteButton>
        ))}

        {/* Sliding Active Indicator */}
        <motion.div
          animate={indicatorStyle}
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
          className="absolute top-1 bottom-1 rounded-full bg-zinc-800/85 border border-zinc-700/60 shadow-lg"
        />
      </div>
    </div>
  );
};

export default FloatingNav;
