import { OverlayThemeLayout, OverlayElement } from "@/types/flow-node";

export function substituteVars(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

function resolveThemeElement(
  el: OverlayThemeLayout["elements"][number],
  idPrefix: string,
  layout: OverlayThemeLayout,
  vars: Record<string, string>,
  overrides?: Partial<OverlayElement>,
): OverlayElement {
  const resolved: OverlayElement = {
    id: `${idPrefix}::${el.id}`,
    type: el.type as OverlayElement["type"],
    x: el.x, y: el.y,
    width: el.width, height: el.height,
    opacity: el.opacity,
    ...overrides,
  };
  if (el.type === "image" && el.asset) {
    const assetPath = layout.themeDir.replace(/\\/g, "/") + "/" + el.asset.replace(/\\/g, "/");
    resolved.imagePath = `file:///${assetPath}`;
  }
  if (el.type === "text") {
    resolved.textContent = el.textContent ? substituteVars(el.textContent, vars) : "";
    resolved.fontSize    = el.fontSize;
    resolved.textColor   = el.textColor;
    resolved.fontFamily  = el.fontFamily;
    resolved.fontWeight  = el.fontWeight;
    resolved.fontStyle   = el.fontStyle;
  }
  if (el.type === "color") {
    resolved.backgroundColor = el.backgroundColor;
  }
  return resolved;
}

export function resolveThemeElements(layout: OverlayThemeLayout, vars: Record<string, string>): OverlayElement[] {
  const idPfx = `theme::${layout.id}`;

  const resolved: OverlayElement[] = layout.elements.map((el) =>
    resolveThemeElement(el, idPfx, layout, vars),
  );

  for (const comp of layout.components ?? []) {
    const sp = comp.styleProps;
    resolved.push({
      id:              `${idPfx}::comp::${comp.id}`,
      type:            comp.componentType,
      x: comp.x, y: comp.y,
      width: comp.width, height: comp.height,
      opacity:         comp.opacity,
      _isComponentBase: true,
      backgroundColor: sp.backgroundColor,
      textColor:       sp.textColor,
      textContent:     sp.textContent ?? "Text Overlay",
      fontSize:        sp.fontSize ?? 5,
      fontFamily:      sp.fontFamily ?? "sans-serif",
      fontWeight:      sp.fontWeight ?? "normal",
      fontStyle:       sp.fontStyle ?? "normal",
      visualizerType:  sp.visualizerType ?? "bars",
      barColor:        sp.barColor,
      progressColor:   sp.progressColor,
      maxMessages:     sp.maxMessages ?? 10,
      title:           "Now Playing",
      artist:          "Artist",
      duration:        0,
    });

    for (const dec of comp.decorations ?? []) {
      const decCanvasX = comp.x + (dec.x  / 100) * comp.width;
      const decCanvasY = comp.y + (dec.y  / 100) * comp.height;
      const decCanvasW =          (dec.width  / 100) * comp.width;
      const decCanvasH =          (dec.height / 100) * comp.height;
      resolved.push(
        resolveThemeElement(dec, `${idPfx}::comp::${comp.id}::dec`, layout, vars, {
          x: decCanvasX, y: decCanvasY,
          width: decCanvasW, height: decCanvasH,
        }),
      );
    }
  }

  return resolved;
}
