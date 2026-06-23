import React, { useCallback, useState, useRef, useMemo, useEffect } from "react";
import { AutomationPoint } from "@/types/timeline";
import { cn } from "@/lib/utils";

interface VolumeEnvelopeOverlayProps {
  points: AutomationPoint[];
  duration: number;
  pixelsPerSecond: number;
  height: number;
  isInteractive?: boolean;
  onChange: (points: AutomationPoint[]) => void;
  onCommit: (points: AutomationPoint[]) => void;
  className?: string;
}

export function VolumeEnvelopeOverlay({
  points,
  duration,
  pixelsPerSecond,
  height,
  isInteractive = true,
  onChange,
  onCommit,
  className,
}: VolumeEnvelopeOverlayProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [localPoints, setLocalPoints] = useState<AutomationPoint[] | null>(null);

  // Default points if empty
  const activePoints = localPoints || (points.length > 0
    ? points
    : [
        { time: 0, value: 1.0, curve: "smooth" as const },
        { time: duration, value: 1.0, curve: "smooth" as const },
      ]);

  const activePointsRef = useRef(activePoints);
  useEffect(() => {
    activePointsRef.current = activePoints;
  }, [activePoints]);

  const dragPointsRef = useRef<AutomationPoint[]>(activePoints);

  // Map values to pixels
  // value 0.0 => y = height
  // value 1.0 => y = height / 2 (so we can boost up to 2.0)
  // value 2.0 => y = 0
  const valToY = (v: number) => {
    const clamped = Math.max(0, Math.min(2, v));
    return height - (clamped / 2) * height;
  };

  const yToVal = (y: number) => {
    const clamped = Math.max(0, Math.min(height, y));
    return 2 - (clamped / height) * 2;
  };

  const timeToX = (t: number) => t * pixelsPerSecond;
  const xToTime = (x: number) => {
    const clamped = Math.max(0, Math.min(duration * pixelsPerSecond, x));
    return clamped / pixelsPerSecond;
  };

  // Build SVG path
  const pathData = useMemo(() => {
    if (activePoints.length === 0) return "";
    
    let d = `M ${timeToX(activePoints[0].time)} ${valToY(activePoints[0].value)}`;
    
    for (let i = 1; i < activePoints.length; i++) {
      const p0 = activePoints[i - 1];
      const p1 = activePoints[i];
      const x0 = timeToX(p0.time);
      const y0 = valToY(p0.value);
      const x1 = timeToX(p1.time);
      const y1 = valToY(p1.value);

      if (p0.curve === "smooth" || p0.curve === undefined) {
        const cpX = x0 + (x1 - x0) / 2;
        d += ` C ${cpX} ${y0}, ${cpX} ${y1}, ${x1} ${y1}`;
      } else {
        d += ` L ${x1} ${y1}`;
      }
    }
    return d;
  }, [activePoints, pixelsPerSecond, height]);

  // Build fill path (for the background highlighting of modified volume)
  const fillPathData = useMemo(() => {
    if (activePoints.length === 0) return "";
    const w = timeToX(duration);
    const zeroY = valToY(0);
    return `${pathData} L ${w} ${zeroY} L 0 ${zeroY} Z`;
  }, [pathData, duration, pixelsPerSecond, height]);

  // Interaction handlers
  const handlePointerDownSVG = (e: React.PointerEvent) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (e.detail === 2) { // Double click to add point
      e.preventDefault();
      e.stopPropagation();
      const time = xToTime(x);
      const value = yToVal(y);
      
      const newPoints = [...activePoints, { time, value, curve: "smooth" as const }].sort((a, b) => a.time - b.time);
      onCommit(newPoints);
    }
  };

  const handlePointerDownPoint = (e: React.PointerEvent, index: number) => {
    e.stopPropagation();
    e.preventDefault(); // Prevent native drag and drop or selection
    
    if (e.detail === 2) { // Double click point to remove it
      if (activePoints.length > 2) { // Don't remove if only 2 left
        const newPoints = [...activePoints];
        newPoints.splice(index, 1);
        onCommit(newPoints);
      }
      return;
    }

    setDraggingIndex(index);
    dragPointsRef.current = activePoints;

    const handleMove = (moveEvent: PointerEvent) => {
      moveEvent.stopPropagation();
      if (!svgRef.current) return;

      const rect = svgRef.current.getBoundingClientRect();
      const x = moveEvent.clientX - rect.left;
      const y = moveEvent.clientY - rect.top;

      const newTime = xToTime(x);
      const newValue = yToVal(y);

      const currentPoints = dragPointsRef.current;
      const newPoints = [...currentPoints];
      const point = { ...newPoints[index] };

      // Don't let ends move horizontally
      if (index === 0) {
        point.time = 0;
      } else if (index === currentPoints.length - 1) {
        point.time = duration;
      } else {
        // Constrain time between neighbors
        const minTime = currentPoints[index - 1].time + 0.01;
        const maxTime = currentPoints[index + 1].time - 0.01;
        point.time = Math.max(minTime, Math.min(maxTime, newTime));
      }

      point.value = newValue;
      newPoints[index] = point;
      dragPointsRef.current = newPoints;
      setLocalPoints(newPoints);
      onChange(newPoints);
    };

    const handleUp = (upEvent: PointerEvent) => {
      upEvent.stopPropagation();
      setDraggingIndex(null);
      setLocalPoints(null);
      onCommit(dragPointsRef.current);
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  };

  const width = duration * pixelsPerSecond;

  return (
    <svg
      ref={svgRef}
      className={cn(
        "absolute inset-0 z-20 overflow-visible touch-none",
        isInteractive ? "pointer-events-auto" : "pointer-events-none",
        className
      )}
      style={{ width, height }}
      onPointerDown={(e) => {
        // If interactive, stop propagation so we NEVER trigger Track.tsx selection
        if (isInteractive) {
          e.stopPropagation();
        }
      }}
    >
      {/* Fill indicating the volume level */}
      <path
        d={fillPathData}
        className="fill-primary/20 pointer-events-none"
      />
      
      {/* The Envelope Line */}
      <path
        d={pathData}
        className={cn(
          "stroke-primary fill-none pointer-events-none transition-opacity",
          isInteractive ? "opacity-100 drop-shadow-[0_0_2px_rgba(var(--primary),0.5)]" : "opacity-40"
        )}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Invisible thick path for easier clicking to add points */}
      {isInteractive && (
        <path
          d={pathData}
          className="stroke-transparent fill-none pointer-events-auto cursor-pointer"
          strokeWidth={16}
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!svgRef.current) return;
            const rect = svgRef.current.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const time = xToTime(x);
            const value = yToVal(y);
            const newPoints = [...activePoints, { time, value, curve: "smooth" as const }].sort((a, b) => a.time - b.time);
            onCommit(newPoints);
          }}
        />
      )}

      {/* The Base 1.0 Line (Reference) */}
      <line
        x1={0}
        y1={valToY(1.0)}
        x2={width}
        y2={valToY(1.0)}
        className="stroke-muted-foreground/30 stroke-[1px] stroke-dasharray-4 pointer-events-none"
      />

      {/* Interactive Points */}
      {isInteractive && activePoints.map((pt, i) => {
        const cx = timeToX(pt.time);
        const cy = valToY(pt.value);
        return (
          <g key={i}>
            {/* Invisible Hit Area */}
            <circle
              cx={cx}
              cy={cy}
              r={16}
              className="fill-transparent stroke-transparent pointer-events-auto cursor-pointer"
              onPointerDown={(e) => handlePointerDownPoint(e, i)}
              onContextMenu={(e) => {
                // Right click to toggle curve type
                e.preventDefault();
                e.stopPropagation();
                const newPoints = [...activePoints];
                newPoints[i] = { 
                  ...newPoints[i], 
                  curve: newPoints[i].curve === "linear" ? "smooth" : "linear" 
                };
                onCommit(newPoints);
              }}
            />
            {/* Visible Point */}
            <circle
              cx={cx}
              cy={cy}
              r={draggingIndex === i ? 6 : 4}
              className={cn(
                "fill-background stroke-primary stroke-[2px] pointer-events-none transition-transform",
                draggingIndex === i && "scale-150 stroke-[3px]"
              )}
            />
          </g>
        );
      })}
    </svg>
  );
}
