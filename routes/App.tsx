import { ComponentProps, ReactNode, useState } from "react";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { Separator } from "@/components/ui/separator";
import { type Theme, useTheme } from "@/store/themeprovider";
import {
  Menubar,
  MenubarContent,
  MenubarGroup,
  MenubarItem,
  MenubarMenu,
  MenubarShortcut,
  MenubarTrigger,
} from "@/components/ui/menubar";
import { Kbd } from "@/components/ui/kbd";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  XIcon,
  Moon,
  Sun,
  WorkflowIcon,
  LibraryIcon,
  SettingsIcon,
  AppWindowIcon,
} from "lucide-react";
import {
  ChromeCloseIcon,
  ChromeMinimizeIcon,
  ChromeRestoreIcon,
} from "@fluentui/react-icons-mdl2";
import { Button } from "@/components/ui/button";
import { ExitDialog } from "@/components/exit-dialog";
import { RouteAnimationContainer } from "@/components/route-animation-container";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import LicenseViewer from "@/components/license-viewer";
import FloatingNav, { TabProps } from "@/components/floating-nav";
import { LoadingAnimation } from "@/components/animations/loading-animation";
import ErrorBoundary from "@/components/errorboundary";
import { Toaster } from "@/components/ui/sonner";
import {
  IconAlertOctagon,
  IconMinimize,
  IconUnderline,
} from "@tabler/icons-react";
import { appControl, AppControlProps } from "@/utils/global";
// import { FlowStoreProvider, useFlowStore } from "@/store/flowStoreProvider";
import { StateMachineProvider, useStateMachine } from "@/store/stateMachine";

export interface SonicContext {
  appTheme: Theme;
}

export default function App() {
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const { hasUnsavedChanges, setQuitRequested } = useStateMachine();

  function CheckUnsaved() {
    if (hasUnsavedChanges) {
      setQuitRequested(true);
    } else {
      appControl("closeApp");
    }
  }

  interface TitleBarButtonProps extends ComponentProps<typeof Button> {
    message: AppControlProps;
    children: ReactNode;
  }

  function TitleBarButton({
    message,
    children,
    ...props
  }: TitleBarButtonProps) {
    return (
      <Button
        variant="ghost"
        style={{
          width: "40px",
          height: "35px",
          borderRadius: "0",
          margin: "0",
          padding: "0",
        }}
        {...props}
        onClick={() => {
          try {
            appControl(message);
          } catch (error) {
            console.error(error);
          }
        }}
      >
        {children}
      </Button>
    );
  }

  const { theme, setTheme } = useTheme();

  const items: TabProps[] = [
    {
      id: 0,
      label: "Library",
      icon: <LibraryIcon />,
      to: "/",
      className: "[&.active]:font-bold",
    },
    {
      id: 1,
      label: "Flow Editor",
      icon: <WorkflowIcon />,
      to: "/flow-editor",
      className: "[&.active]:font-bold",
    },
    {
      id: 2,
      label: "Settings",
      icon: <SettingsIcon />,
      to: "/settings",
      className: "[&.active]:font-bold",
    },
  ];

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  return (
    <>
      <div
        style={{
          display: "flex",
          alignContent: "space-between",
          width: "100%",
          height: "30px",
        }}
      >
        <Dialog>
          <DialogTrigger>
            <img src="/img/icon.png" width={"38px"} height={"38px"} />
          </DialogTrigger>
          <DialogContent style={{ maxWidth: "600px", maxHeight: "600px" }}>
            <DialogHeader>
              <DialogTitle>SonicPlank.Maker</DialogTitle>
            </DialogHeader>
            <Separator />
            <p>
              {/*
                // TODO: Fill out a proper about section
               */}
              Beginning with shutting the fuck up, takes time to jump up an
              asshole of levinsworth. It's almost today fucked your hello.
            </p>
            <LicenseViewer />
            <Separator />
            <DialogDescription>Copyright 2026 © Damon Batey</DialogDescription>
          </DialogContent>
        </Dialog>
        <div
          style={{
            appRegion: "drag",
            display: "flex",
            alignContent: "start",
            width: "100%",
            height: "30px",
          }}
        >
          <div
            id="windowTitle"
            style={{
              marginTop: "5px",
              marginLeft: "10px",
              height: "40px",
            }}
          >
            SonicPlank.Maker
          </div>
        </div>
        <Menubar style={{ height: "35px", border: "0" }}>
          <MenubarMenu>
            <MenubarTrigger
              style={{ width: "35px", height: "35px", borderRadius: "0" }}
            >
              <Sun className="h-[1.2rem] w-[1.2rem] scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
              <Moon className="absolute h-[1.2rem] w-[1.2rem] scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
              <span className="sr-only">Toggle theme</span>
            </MenubarTrigger>
            <MenubarContent align="end">
              <MenubarItem onClick={() => setTheme("light")}>Light</MenubarItem>
              <MenubarItem onClick={() => setTheme("dark")}>Dark</MenubarItem>
              <MenubarItem onClick={() => setTheme("system")}>
                System
              </MenubarItem>
            </MenubarContent>
          </MenubarMenu>
        </Menubar>
        <TitleBarButton message="minimizeApp">
          <ChromeMinimizeIcon />
        </TitleBarButton>
        <TitleBarButton message="maximizeApp">
          <ChromeRestoreIcon />
        </TitleBarButton>
        <TitleBarButton message="closeApp">
          <ChromeCloseIcon />
        </TitleBarButton>
      </div>
      <div
        style={{
          display: "flex",
          alignContent: "space-between",
          width: "100%",
          height: "30px",
        }}
      >
        <Menubar
          style={{
            height: "30px",
            width: "100%",
            borderTop: "0",
            borderLeft: "0",
            borderRight: "0",
            borderRadius: "0",
          }}
        >
          <MenubarMenu>
            <MenubarTrigger style={{ borderRadius: "0" }}>File</MenubarTrigger>
            <MenubarContent>
              <MenubarGroup>
                <MenubarItem onClick={() => appControl("toggleDevTools")}>
                  DevTools
                  <MenubarShortcut>
                    <Kbd>Ctrl</Kbd>T
                  </MenubarShortcut>
                </MenubarItem>
              </MenubarGroup>
              <MenubarGroup>
                <MenubarItem
                  onClick={() => {
                    CheckUnsaved();
                  }}
                >
                  Exit
                </MenubarItem>
              </MenubarGroup>
            </MenubarContent>
          </MenubarMenu>
        </Menubar>
      </div>
      {/* <Suspense fallback={LoadingAnimation()}> */}
      <FloatingNav items={items} />

      <RouteAnimationContainer>
        <Outlet />
      </RouteAnimationContainer>
      {/* </Suspense> */}
      <div style={{ zIndex: 1000 }}>
        <TanStackRouterDevtools
          position="top-right"
          containerElement="a"
          toggleButtonProps={{
            className: "nodrag nopan nowheel",
            style: {
              top: "70px",
              zIndex: 1000,
            },
          }}
        />
      </div>
      <Toaster
        icons={{ error: <IconAlertOctagon className="size-4" /> }}
        duration={2000}
        closeButton={false}
        position="bottom-right"
        visibleToasts={1}
      />
    </>
  );
}

// Bind your App component as the root route layout
export const Route = createRootRouteWithContext<SonicContext>()({
  component: () => <App />,
  pendingComponent: LoadingAnimation,
  errorComponent: ErrorBoundary,
});
