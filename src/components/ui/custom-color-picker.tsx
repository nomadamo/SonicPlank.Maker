import * as React from "react";
import { useState } from "react";
import {
  ColorArea,
  ColorField,
  ColorPicker,
  ColorSlider,
  ColorSwatch,
  ColorSwatchPicker,
  ColorSwatchPickerItem,
  ColorThumb,
  SliderTrack,
} from "@/components/ui/color";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCopyToClipboard } from "usehooks-ts";
import { Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface CustomColorPickerProps {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  disabled?: boolean;
}

export function CustomColorPicker({
  value,
  onChange,
  id,
  disabled = false,
}: CustomColorPickerProps) {
  const [copiedText, copyToClipboard] = useCopyToClipboard();
  const [isCopied, setIsCopied] = useState(false);
  const colorId = id || React.useId();

  const handleCopy = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    copyToClipboard(safeValue);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 1500);
  };

  // Ensure color value is a valid hex string starting with #
  const safeValue = value && value.startsWith("#") ? value : "#000000";

  return (
    <div className="nodrag nopan nowheel flex items-center">
      <ColorPicker
        value={safeValue}
        onChange={(col) => onChange(col.toString("hex"))}
      >
      <Popover>
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              className={cn(
                "nodrag nopan nowheel flex h-fit items-center gap-2 p-0.5 border border-border rounded bg-background hover:bg-muted transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-700",
                disabled && "opacity-50 pointer-events-none"
              )}
              disabled={disabled}
            >
              <div
                className="w-7 h-6 rounded shadow-inner"
                style={{ backgroundColor: safeValue }}
              />
            </Button>
          }
        />
        <PopoverContent className="nodrag nopan nowheel w-fit bg-background border border-border p-3 rounded-xl flex flex-col gap-3 shadow-2xl">
          <div className="flex flex-col gap-2">
            <ColorArea
              colorSpace="hsb"
              xChannel="saturation"
              yChannel="brightness"
              className="h-[140px] w-[180px] rounded-lg border border-border/80 shadow-md"
            >
              <ColorThumb className="z-50 border-white shadow-lg cursor-grab active:cursor-grabbing" />
            </ColorArea>
            <ColorSlider colorSpace="hsb" channel="hue">
              <SliderTrack className="h-4 w-[180px] rounded-full border border-border/80">
                <ColorThumb className="top-1/2 border-white shadow-lg cursor-grab active:cursor-grabbing" />
              </SliderTrack>
            </ColorSlider>
          </div>
          
          <div className="flex flex-row gap-1.5 items-center">
            <ColorField colorSpace="rgb" className="flex-1">
              <Input
                id={`picker_input_${colorId}`}
                className="h-8 text-xs bg-muted border-border text-foreground focus-visible:ring-zinc-700 font-mono"
                aria-label="Hex Color"
                value={safeValue}
              />
            </ColorField>
            <Button
              size="icon"
              variant="outline"
              className="h-8 w-8 bg-muted border-border text-muted-foreground hover:text-zinc-250 hover:bg-secondary transition-colors"
              onClick={handleCopy}
            >
              {isCopied ? (
                <Check className="h-3.5 w-3.5 text-green-500" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>

          <ColorSwatchPicker className="w-[180px] gap-1.5 flex flex-wrap justify-between">
            <ColorSwatchPickerItem color="#ef4444">
              <ColorSwatch className="size-6 rounded-md border border-border shadow-sm" />
            </ColorSwatchPickerItem>
            <ColorSwatchPickerItem color="#f97316">
              <ColorSwatch className="size-6 rounded-md border border-border shadow-sm" />
            </ColorSwatchPickerItem>
            <ColorSwatchPickerItem color="#eab308">
              <ColorSwatch className="size-6 rounded-md border border-border shadow-sm" />
            </ColorSwatchPickerItem>
            <ColorSwatchPickerItem color="#22c55e">
              <ColorSwatch className="size-6 rounded-md border border-border shadow-sm" />
            </ColorSwatchPickerItem>
            <ColorSwatchPickerItem color="#06b6d4">
              <ColorSwatch className="size-6 rounded-md border border-border shadow-sm" />
            </ColorSwatchPickerItem>
            <ColorSwatchPickerItem color="#3b82f6">
              <ColorSwatch className="size-6 rounded-md border border-border shadow-sm" />
            </ColorSwatchPickerItem>
            <ColorSwatchPickerItem color="#a855f7">
              <ColorSwatch className="size-6 rounded-md border border-border shadow-sm" />
            </ColorSwatchPickerItem>
            <ColorSwatchPickerItem color="#ffffff">
              <ColorSwatch className="size-6 rounded-md border border-border shadow-sm" />
            </ColorSwatchPickerItem>
          </ColorSwatchPicker>
        </PopoverContent>
      </Popover>
    </ColorPicker>
    </div>
  );
}
