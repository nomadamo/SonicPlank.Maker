import { useViewport } from "@xyflow/react";
import { memo, useRef } from "react";

function Background() {
  const ref = useRef<SVGSVGElement>(null);
  const { x, y, zoom } = useViewport();

  const patternSize = 1;
  const gapXY: [number, number] = [50, 50];
  const scaledGap: [number, number] = [gapXY[0] * zoom, gapXY[1] * zoom];
  const scaledSize = patternSize * zoom;

  const patternOffset = [scaledSize / 2, scaledSize / 2];

  let type = "pattern";

  if (type == "triangle") {
    return (
      <svg
        style={{
          position: "absolute",
          width: "100%",
          height: "100%",
          top: 0,
          left: 0,
          background: "var(--sidebar)",
        }}
        ref={ref}
        data-testid="rf__background"
      >
        <defs>
          <pattern
            id="gridPattern"
            x={x % scaledGap[0]}
            y={y % scaledGap[1]}
            width={scaledGap[0]}
            height={scaledGap[1]}
            patternUnits="userSpaceOnUse"
            patternTransform={`translate(-${patternOffset[0]},-${patternOffset[1]})`}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              style={{ transform: `scale(${zoom})` }}
              width="50"
              height="50"
              viewBox="0 0 50 50"
            >
              <defs>
                <linearGradient
                  x1="50%"
                  y1="0%"
                  x2="50%"
                  y2="100%"
                  id="nnneon-grad"
                >
                  <stop stopColor="hsl(157, 100%, 54%)" offset="0%" />
                  <stop stopColor="hsl(331, 87%, 61%)" offset="100%" />
                </linearGradient>

                <filter
                  id="nnneon-filter"
                  x="-50%"
                  y="-50%"
                  width="200%"
                  height="200%"
                >
                  <feGaussianBlur
                    stdDeviation="2 1"
                    in="SourceGraphic"
                    result="blur"
                  />
                </filter>
                <filter
                  id="nnneon-filter2"
                  x="-50%"
                  y="-50%"
                  width="200%"
                  height="200%"
                >
                  <feGaussianBlur
                    stdDeviation="1 2"
                    in="SourceGraphic"
                    result="blur"
                  />
                </filter>
              </defs>

              <g strokeWidth="1.5" stroke="url(#nnneon-grad)" fill="none">
                <path d="M30 20 L40 40 H20 Z" filter="url(#nnneon-filter)" />
                <path
                  d="M40 20 L50 40 H30 Z"
                  filter="url(#nnneon-filter2)"
                  opacity="0.25"
                />
                <path
                  d="M20 20 L30 40 H10 Z"
                  filter="url(#nnneon-filter2)"
                  opacity="0.25"
                />
                <path d="M30 20 L40 40 H20 Z" />
              </g>
            </svg>
          </pattern>
        </defs>

        <rect
          width="100%"
          height="100%"
          fill="var(--color-transparent)"
          opacity="1"
        />

        <rect
          width="100%"
          height="100%"
          fill="url(#gridPattern)"
          opacity="0.05"
        />
      </svg>
    );
  }
  if (type == "pattern") {
    return (
      <svg
        style={{
          position: "absolute",
          width: "100%",
          height: "100%",
          top: 0,
          left: 0,
          background: "var(--sidebar)",
        }}
        ref={ref}
        data-testid="rf__background"
      >
        <defs>
          <pattern
            id="gridPattern"
            x={x % scaledGap[0]}
            y={y % scaledGap[1]}
            width={scaledGap[0]}
            height={scaledGap[1]}
            patternUnits="userSpaceOnUse"
            patternTransform={`translate(-${patternOffset[0]},-${patternOffset[1]})`}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              version="1.1"
              opacity="0.56"
              style={{ transform: `scale(${zoom * 2})` }}
              width="50"
              height="50"
              viewBox="0 0 50 50"
            >
              <g strokeWidth="0.75" stroke="hsl(261, 60%, 38%)" fill="none">
                <rect width="25" height="25" x="0" y="0" opacity="0.45" />
                <circle
                  r="1.082105263157895"
                  cx="0"
                  cy="0"
                  fill="hsl(261, 60%, 38%)"
                  stroke="none"
                />
                <rect width="25" height="25" x="25" y="0" opacity="0.45" />
                <circle
                  r="1.082105263157895"
                  cx="25"
                  cy="0"
                  fill="hsl(261, 60%, 38%)"
                  stroke="none"
                />
                <rect width="25" height="25" x="50" y="0" opacity="0.45" />
                <circle
                  r="1.082105263157895"
                  cx="50"
                  cy="0"
                  fill="hsl(261, 60%, 38%)"
                  stroke="none"
                />
                <rect width="25" height="25" x="0" y="25" opacity="0.45" />
                <circle
                  r="1.082105263157895"
                  cx="0"
                  cy="25"
                  fill="hsl(261, 60%, 38%)"
                  stroke="none"
                />
                <rect width="25" height="25" x="25" y="25" opacity="0.45" />
                <circle
                  r="1.082105263157895"
                  cx="25"
                  cy="25"
                  fill="hsl(261, 60%, 38%)"
                  stroke="none"
                />
                <rect width="25" height="25" x="50" y="25" opacity="0.45" />
                <circle
                  r="1.082105263157895"
                  cx="50"
                  cy="25"
                  fill="hsl(261, 60%, 38%)"
                  stroke="none"
                />
                <rect width="25" height="25" x="0" y="50" opacity="0.45" />
                <circle
                  r="1.082105263157895"
                  cx="0"
                  cy="50"
                  fill="hsl(261, 60%, 38%)"
                  stroke="none"
                />
                <rect width="25" height="25" x="25" y="50" opacity="0.45" />
                <circle
                  r="1.082105263157895"
                  cx="25"
                  cy="50"
                  fill="hsl(261, 60%, 38%)"
                  stroke="none"
                />
                <rect width="25" height="25" x="50" y="50" opacity="0.45" />
                <circle
                  r="1.082105263157895"
                  cx="50"
                  cy="50"
                  fill="hsl(261, 60%, 38%)"
                  stroke="none"
                />
              </g>
            </svg>
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="var(--background)" opacity="1" />

        <rect width="100%" height="100%" fill="url(#gridPattern)" opacity="1" />
      </svg>
    );
  }
}

Background.displayName = "FlowBackground";
export const SonicBackground = memo(Background);
