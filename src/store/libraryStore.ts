import { atom, useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { LibraryItem, LibraryCategory } from "@/types/library-item";

export const libraryItemsAtom = atom<LibraryItem[]>([]);
export const libraryCategoriesAtom = atom<LibraryCategory[]>([]);
export const libraryLoadedAtom = atom<boolean>(false);

export const updateLibraryItemAtom = atom(
  null,
  (get, set, { id, patch }: { id: string; patch: Partial<LibraryItem> }) => {
    const items = get(libraryItemsAtom);
    const updated = items.map((item) =>
      item.id === id ? { ...item, ...patch } : item,
    );
    set(libraryItemsAtom, updated);
  },
);

export function useLibraryStore() {
  const [items, setItems] = useAtom(libraryItemsAtom);
  const [categories, setCategories] = useAtom(libraryCategoriesAtom);
  const [loaded, setLoaded] = useAtom(libraryLoadedAtom);

  return { items, setItems, categories, setCategories, loaded, setLoaded };
}
