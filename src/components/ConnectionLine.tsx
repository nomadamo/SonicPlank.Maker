import React from "react";
import { useConnection } from "@xyflow/react";

export default ({ fromX, fromY, toX, toY }: { fromX: number; fromY: number; toX: number; toY: number }) => {
  const { fromHandle } = useConnection();
  const isSource = fromHandle?.type === "source";

  return (
    <g>
      <path
        fill="none"
        stroke={isSource ? "var(--primary)" : "var(--muted-foreground)"}
        strokeWidth={1.5}
        strokeDasharray="6 3"
        className="animated"
        d={`M${fromX},${fromY} C ${fromX} ${toY} ${fromX} ${toY} ${toX},${toY}`}
      />
      <circle
        cx={toX}
        cy={toY}
        fill="var(--background)"
        r={4}
        stroke={isSource ? "var(--primary)" : "var(--muted-foreground)"}
        strokeWidth={1.5}
      />
    </g>
  );
};
