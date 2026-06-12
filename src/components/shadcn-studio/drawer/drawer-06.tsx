import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { IconArrowRight } from "@tabler/icons-react";

const DrawerNoOverlay = () => {
  return (
    <Drawer direction="right" modal={false}>
      <DrawerTrigger render={<Button variant="outline" />}>
        No Overlay
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Shadcn Studio</DrawerTitle>
          <DrawerDescription>
            Accelerate your project development with ready-to-use, &
            customizable 1000+ Shadcn UI Components, Blocks, UI Kit,
            Boilerplate, Templates & Themes.
          </DrawerDescription>
        </DrawerHeader>
        <div className="no-scrollbar overflow-y-auto px-4">
          {Array.from({ length: 10 }).map((_, index) => (
            <p key={index} className="mb-4">
              Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do
              eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut
              enim ad minim veniam, quis nostrud exercitation ullamco laboris
              nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in
              reprehenderit in voluptate velit esse cillum dolore eu fugiat
              nulla pariatur. Excepteur sint occaecat cupidatat non proident,
              sunt in culpa qui officia deserunt mollit anim id est laborum.
            </p>
          ))}
        </div>
        <DrawerFooter>
          <Button>
            Learn more <IconArrowRight />
          </Button>
          <DrawerClose render={<Button variant="outline" />}>
            Got it !
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
};

export default DrawerNoOverlay;
