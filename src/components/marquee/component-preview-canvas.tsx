import { useEffect, useRef } from "react";
import type { OverlayThemeComponent, OverlayElement } from "@/types/flow-node";
import { renderOverlayElementSnapshot, MOCK_NOW_PLAYING } from "@/utils/overlay-snapshot";

function compToElement(comp: OverlayThemeComponent): OverlayElement {
  const sp = comp.styleProps;
  return {
    id: comp.id,
    type: comp.componentType,
    x: 0, y: 0, width: 100, height: 100,
    opacity: 1,
    textContent:     sp.textContent ?? "Text Overlay",
    fontSize:        sp.fontSize ?? 5,
    textColor:       sp.textColor ?? "#ffffff",
    fontFamily:      sp.fontFamily ?? "sans-serif",
    fontWeight:      sp.fontWeight ?? "normal",
    fontStyle:       sp.fontStyle ?? "normal",
    backgroundColor: sp.backgroundColor,
    imagePath:       sp.asset,
    visualizerType:  sp.visualizerType ?? "bars",
    barColor:        sp.barColor ?? "#6366f1",
    progressColor:   sp.progressColor ?? "#6366f1",
    maxMessages:     sp.maxMessages ?? 10,
    title:           MOCK_NOW_PLAYING.title,
    artist:          MOCK_NOW_PLAYING.artist,
    duration:        MOCK_NOW_PLAYING.duration,
  };
}

interface Props {
  component: OverlayThemeComponent;
}

export function ComponentPreviewCanvas({ component }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const render = () => {
      const W = canvas.offsetWidth;
      const H = canvas.offsetHeight;
      if (W === 0 || H === 0) return;
      canvas.width  = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, W, H);
      renderOverlayElementSnapshot(ctx, compToElement(component), W, H);
    };

    render();
    const ro = new ResizeObserver(render);
    ro.observe(canvas);
    return () => ro.disconnect();
  // Re-render whenever the component's visual properties change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [component]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
    />
  );
}
