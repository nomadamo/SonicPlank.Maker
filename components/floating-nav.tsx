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
import { Button, ButtonProps } from "@/components/ui/button";

export interface TabProps {
  id: number;
  label: string;
  icon: ReactElement;
  to?: string | undefined;
  className?: string | undefined;
}

interface ButtonLinkProps extends ButtonProps {
  ref: Ref<HTMLButtonElement>;
}

const ButtonLinkComponent = React.forwardRef<
  HTMLAnchorElement,
  ButtonLinkProps
>((props, ref) => {
  return (
    <Button
      ref={ref}
      {...props}
      component="link"
      variant="ghost"
      type="button"
      className="relative flex flex-row items-center justify-center rounded-full! hover:bg-neutral-800 flex-1 px-1 py-1 font-small text-gray-600 dark:text-gray-300"
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
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);

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
    <div className="absolute left-1/2 -translate-x-1/2 z-50 w-full rounded-md max-w-lg px-20">
      <div
        ref={containerRef}
        className="relative flex items-center justify-between font-small dark:bg-neutral-900 shadow-lg top-1 rounded-full gap-2 px-1 py-1 border border-gray-800 dark:border-gray-800"
      >
        {items.map((item, index) => (
          <RouteButton
            key={item.id}
            ref={(el) => (btnRefs.current[index] = el)}
            onClick={() => setActive(index)}
            to={item.to}
            className={item?.className ? item.className : ""}
          >
            <div className="z-10">{item.icon}</div>
            {/* hide labels on small screens */}
            <span className="text-xs hidden sm:block">{item.label}</span>
          </RouteButton>
        ))}

        {/* Sliding Active Indicator */}
        <motion.div
          animate={indicatorStyle}
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
          className="absolute top-1 bottom-1 rounded-full bg-gray-200/8 dark:bg-gray-100/9"
        />
      </div>
    </div>
  );
};

export default FloatingNav;
