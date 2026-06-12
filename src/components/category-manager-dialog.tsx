import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useLibraryStore } from "@/store/libraryStore";
import { TagsIcon, Trash2Icon, PlusIcon } from "lucide-react";
import { Icon, IconName, IconPicker } from "@/components/ui/icon-picker";
import { LibraryCategory } from "@/types/library-item";
import { useStateMachine } from "../store/stateMachine";
import "@arkn/react-icon-picker/dist/style.css";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
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
import { useCopyToClipboard } from "usehooks-ts";

interface CategoryManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CategoryManagerDialog({
  open,
  onOpenChange,
}: CategoryManagerDialogProps) {
  const { categories, setCategories, items, setItems } = useLibraryStore();
  const { theme } = useStateMachine();
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryIcon, setNewCategoryIcon] = useState("");
  const [newCategoryColor, setNewCategoryColor] = useState("#fca");
  const [copiedText, copyToClipboard] = useCopyToClipboard();

  const handleAddCategory = () => {
    if (!newCategoryName.trim()) return;
    const newCategory: LibraryCategory = {
      id: crypto.randomUUID(),
      name: newCategoryName.trim(),
      icon: newCategoryIcon as IconName,
      color: newCategoryColor,
    };
    setCategories([...categories, newCategory]);
    setNewCategoryName("");
    setNewCategoryIcon("");
    setNewCategoryColor("#fca");
  };

  const handleUpdateCategoryName = (id: string, newName: string) => {
    setCategories(
      categories.map((c) => (c.id === id ? { ...c, name: newName } : c)),
    );
  };

  const handleUpdateCategoryIcon = (id: string, newIcon: IconName) => {
    setCategories(
      categories.map((c) => (c.id === id ? { ...c, icon: newIcon } : c)),
    );
  };

  const handleUpdateCategoryColor = (id: string, newColor: string) => {
    setCategories(
      categories.map((c) => (c.id === id ? { ...c, color: newColor } : c)),
    );
  };

  const handleDeleteCategory = (id: string) => {
    // Remove category
    setCategories(categories.filter((c) => c.id !== id));
    // Remove category assignment from items
    const updatedItems = items.map((item) => {
      if (item.categoryId === id) {
        const { categoryId, ...rest } = item;
        return rest;
      }
      return item;
    });
    setItems(updatedItems);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent style={{ maxWidth: "580px" }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TagsIcon className="h-5 w-5 text-primary" />
            Manage Categories
          </DialogTitle>
          <DialogDescription>
            Add, edit, or remove categories for your library items.
          </DialogDescription>
        </DialogHeader>

        <Separator />

        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto pr-2">
            {categories.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No categories found.
              </p>
            ) : (
              categories.map((category) => (
                <div key={category.id} className="flex items-center gap-2">
                  <Input
                    value={category.name}
                    onChange={(e) =>
                      handleUpdateCategoryName(category.id, e.target.value)
                    }
                    className="flex-1 h-8"
                  />
                  <ColorPicker
                    value={category.color || "#fcf"}
                    onChange={(col) =>
                      handleUpdateCategoryColor(
                        category.id,
                        col.toString("hex"),
                      )
                    }
                  >
                    <Popover>
                      <PopoverTrigger
                        render={
                          <Button
                            variant="ghost"
                            className="flex h-fit items-center gap-2 p-1"
                          >
                            <ColorSwatch className="size-8 rounded-md border-2" />
                          </Button>
                        }
                      />
                      <PopoverContent className="w-fit">
                        {/* <Dialog className="flex flex-col gap-4 p-3 outline-none"> */}
                        <div>
                          <ColorArea
                            colorSpace="hsb"
                            xChannel="saturation"
                            yChannel="brightness"
                            className="h-[162px] rounded-b-none border-b-0"
                          >
                            <ColorThumb className="z-50" />
                          </ColorArea>
                          <ColorSlider colorSpace="hsb" channel="hue">
                            <SliderTrack className="rounded-t-none border-t-0">
                              <ColorThumb className="top-1/2" />
                            </SliderTrack>
                          </ColorSlider>
                        </div>
                        <div className="flex flex-row gap-2">
                          <ColorField colorSpace="rgb" className="w-[140px]">
                            <Input
                              id={`category_${category.id}_color`}
                              className=""
                              aria-label="Hex"
                              value={category.color}
                            />
                          </ColorField>
                          <Button
                            onClick={() => {
                              const copyValue = (
                                document.getElementById(
                                  `category_${category.id}_color`,
                                ) as HTMLInputElement
                              ).value;
                              copyToClipboard(copyValue);
                            }}
                          >
                            <Icon name="copy" />
                          </Button>
                        </div>
                        <ColorSwatchPicker className="w-[192px]">
                          <ColorSwatchPickerItem color="#F00">
                            <ColorSwatch />
                          </ColorSwatchPickerItem>
                          <ColorSwatchPickerItem color="#f90">
                            <ColorSwatch />
                          </ColorSwatchPickerItem>
                          <ColorSwatchPickerItem color="#0F0">
                            <ColorSwatch />
                          </ColorSwatchPickerItem>
                          <ColorSwatchPickerItem color="#08f">
                            <ColorSwatch />
                          </ColorSwatchPickerItem>
                          <ColorSwatchPickerItem color="#00f">
                            <ColorSwatch />
                          </ColorSwatchPickerItem>
                        </ColorSwatchPicker>
                      </PopoverContent>
                    </Popover>
                  </ColorPicker>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <IconPicker
                          categorized={false}
                          value={category.icon || undefined}
                          onValueChange={(icon) =>
                            handleUpdateCategoryIcon(category.id, icon)
                          }
                          render={
                            <Button variant="outline">
                              {category.icon != "" ? (
                                <Icon name={category.icon} />
                              ) : (
                                <Icon name="message-circle-question-mark" />
                              )}
                            </Button>
                          }
                        />
                      }
                    />
                    <TooltipContent>Choose an icon (optional)</TooltipContent>
                  </Tooltip>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => handleDeleteCategory(category.id)}
                    title="Delete category"
                  >
                    <Trash2Icon className="h-4 w-4" />
                  </Button>
                </div>
              ))
            )}
          </div>

          <Separator />

          <div className="flex items-center gap-2 mt-2">
            <Input
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              placeholder="New category name"
              className="flex-1"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddCategory();
              }}
            />
            <ColorPicker
              value={newCategoryColor}
              onChange={(col) => setNewCategoryColor(col.toString("hex"))}
            >
              <Popover>
                <PopoverTrigger
                  render={
                    <Button
                      variant="ghost"
                      className="flex h-fit items-center gap-2 p-1"
                    >
                      <ColorSwatch className="size-8 rounded-md border-2" />
                    </Button>
                  }
                />
                <PopoverContent className="w-fit">
                  {/* <Dialog className="flex flex-col gap-4 p-3 outline-none"> */}
                  <div>
                    <ColorArea
                      colorSpace="hsb"
                      xChannel="saturation"
                      yChannel="brightness"
                      className="h-[162px] rounded-b-none border-b-0"
                    >
                      <ColorThumb className="z-50" />
                    </ColorArea>
                    <ColorSlider colorSpace="hsb" channel="hue">
                      <SliderTrack className="rounded-t-none border-t-0">
                        <ColorThumb className="top-1/2" />
                      </SliderTrack>
                    </ColorSlider>
                  </div>
                  <div className="flex flex-row gap-2">
                    <ColorField colorSpace="rgb" className="w-[140px]">
                      <Input
                        id={`category_new_color`}
                        className=""
                        aria-label="Hex"
                        value={newCategoryColor}
                      />
                    </ColorField>
                    <Button
                      onClick={() => {
                        const copyValue = (
                          document.getElementById(
                            "category_new_color",
                          ) as HTMLInputElement
                        ).value;
                        copyToClipboard(copyValue);
                      }}
                    >
                      <Icon name="copy" />
                    </Button>
                  </div>
                  <ColorSwatchPicker className="w-[192px]">
                    <ColorSwatchPickerItem color="#F00">
                      <ColorSwatch />
                    </ColorSwatchPickerItem>
                    <ColorSwatchPickerItem color="#f90">
                      <ColorSwatch />
                    </ColorSwatchPickerItem>
                    <ColorSwatchPickerItem color="#0F0">
                      <ColorSwatch />
                    </ColorSwatchPickerItem>
                    <ColorSwatchPickerItem color="#08f">
                      <ColorSwatch />
                    </ColorSwatchPickerItem>
                    <ColorSwatchPickerItem color="#00f">
                      <ColorSwatch />
                    </ColorSwatchPickerItem>
                  </ColorSwatchPicker>
                </PopoverContent>
              </Popover>
            </ColorPicker>
            <Tooltip>
              <TooltipTrigger
                render={
                  <IconPicker
                    categorized={false}
                    aria-selected={true}
                    value={
                      newCategoryIcon == ""
                        ? undefined
                        : (newCategoryIcon as IconName)
                    }
                    onValueChange={(icon) => setNewCategoryIcon(icon)}
                    render={
                      <Button variant="outline">
                        {newCategoryIcon == "" ? (
                          <Icon name="message-circle-question-mark" />
                        ) : (
                          <Icon name={newCategoryIcon as IconName} />
                        )}
                      </Button>
                    }
                  />
                }
              />
              <TooltipContent>Choose an icon (optional)</TooltipContent>
            </Tooltip>
            <Button onClick={handleAddCategory} className="gap-2">
              <PlusIcon className="h-4 w-4" />
              Add
            </Button>
            <Button
              onClick={() => onOpenChange(false)}
              variant="outline"
              className="gap-2"
            >
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
