import React from "react";
import type { Edge, EdgeProps, Position } from "@xyflow/react";
import {
  BaseEdge,
  getBezierPath,
  getStraightPath,
  getSmoothStepPath,
  useNodes,
} from "@xyflow/react";

export type AnimatedSvgEdge = Edge<{
  /**
   * The amount of time it takes, in seconds, to move the shape from one end of
   * the edge path to the other.
   */
  duration: number;
  /**
   * The direction in which the shape moves along the edge path.
   */
  direction?: "forward" | "reverse" | "alternate" | "alternate-reverse";
  /**
   * Which of React Flow's path algorithms to use.
   */
  path?: "bezier" | "smoothstep" | "step" | "straight";
  /**
   * The number of times to repeat the animation before stopping.
   */
  repeat?: number | "indefinite";
  shape?: string;
}>;

const getNodeColor = (type?: string): string => {
  switch (type) {
    case "audioFlowNode":
      return "#10b981"; // Emerald
    case "captureSourceNode":
      return "#6366f1"; // Indigo
    case "targetOutputNode":
    case "masterOutputNode":
      return "#ef4444"; // Red
    case "textOverlayNode":
    case "colorOverlayNode":
    case "imageOverlayNode":
      return "#6366f1"; // Indigo
    case "overlayGroupNode":
      return "#818cf8"; // Indigo
    case "visualizerOverlayNode":
      return "#06b6d4"; // Cyan
    default:
      return "#6366f1"; // Default Indigo
  }
};

/**
 * The `AnimatedSvgEdge` component renders a custom styled connection edge and animates
 * a glowing color-transitioning particle along the path.
 */
export function AnimatedSvgEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data = {
    duration: 1.5,
    direction: "forward",
    path: "bezier",
    repeat: "indefinite",
  },
  ...delegated
}: EdgeProps<AnimatedSvgEdge>) {
  const {
    source,
    target,
    sourceHandleId,
    targetHandleId,
    animated,
    selected,
    selectable,
    deletable,
    style,
    pathOptions: _pathOptions,
    ...restEdgeProps
  } = delegated;

  const nodes = useNodes();
  const sourceNode = nodes.find((n) => n.id === source);
  const targetNode = nodes.find((n) => n.id === target);

  const sourceColor = getNodeColor(sourceNode?.type);
  const targetColor = getNodeColor(targetNode?.type);
  const duration = data.duration ?? 1.5;

  const [path] = getPath({
    type: data.path ?? "bezier",
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const animateMotionProps = getAnimateMotionProps({
    duration,
    direction: data.direction ?? "forward",
    repeat: data.repeat ?? "indefinite",
    path,
  });

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{
          stroke: selected ? "#52525b" : "#27272a", // Selected: zinc-600, Default: zinc-800
          strokeWidth: selected ? 3.5 : 2.5,
          transition: "stroke 0.2s, stroke-width 0.2s",
          opacity: 0.8,
          ...style,
        }}
        {...restEdgeProps}
      />
      {animated && (
        <g>
          <animateMotion {...animateMotionProps} />
          <circle
            r="3"
            opacity="0.25"
            fill={targetColor}
            style={{ filter: "blur(2px)" }}
          >
            <animate
              attributeName="fill"
              values={`${targetColor};${sourceColor}`}
              dur={`${duration}s`}
              repeatCount="indefinite"
            />
          </circle>
          <circle r="1.5" opacity="0.7" fill={targetColor}>
            <animate
              attributeName="fill"
              values={`${targetColor};${sourceColor}`}
              dur={`${duration}s`}
              repeatCount="indefinite"
            />
          </circle>
        </g>
      )}
    </>
  );
}

/**
 * Chooses which of React Flow's edge path algorithms to use based on the provided
 * `type`.
 */
function getPath({
  type,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
}: {
  type: "bezier" | "smoothstep" | "step" | "straight";
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourcePosition: Position;
  targetPosition: Position;
}) {
  switch (type) {
    case "bezier":
      return getBezierPath({
        sourceX,
        sourceY,
        targetX,
        targetY,
        sourcePosition,
        targetPosition,
      });

    case "smoothstep":
      return getSmoothStepPath({
        sourceX,
        sourceY,
        targetX,
        targetY,
        sourcePosition,
        targetPosition,
      });

    case "step":
      return getSmoothStepPath({
        sourceX,
        sourceY,
        targetX,
        targetY,
        sourcePosition,
        targetPosition,
        borderRadius: 0,
      });

    case "straight":
      return getStraightPath({
        sourceX,
        sourceY,
        targetX,
        targetY,
      });
  }
}

/**
 * Construct the props for an `<animateMotion />` element based on an
 * `AnimatedSvgEdge`'s data.
 */
function getAnimateMotionProps({
  duration,
  direction,
  repeat,
  path,
}: {
  duration: number;
  direction: "forward" | "reverse" | "alternate" | "alternate-reverse";
  repeat: number | "indefinite";
  path: string;
}) {
  const base = {
    path,
    repeatCount: repeat,
    calcMode: "linear",
  };

  switch (direction) {
    case "forward":
      return {
        ...base,
        dur: `${duration}s`,
        keyTimes: "0.0; 1.0",
        keyPoints: "0.0; 1.0",
      };

    case "reverse":
      return {
        ...base,
        dur: `${duration}s`,
        keyTimes: "0;1",
        keyPoints: "1;0",
      };

    case "alternate":
      return {
        ...base,
        dur: `${duration}s`,
        keyTimes: "0;0.5;1",
        keyPoints: "0;1;0",
      };

    case "alternate-reverse":
      return {
        ...base,
        dur: `${duration}s`,
        keyTimes: "0;0.5;1",
        keyPoints: "1;0;1",
      };
  }
}
