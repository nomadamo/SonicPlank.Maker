import { ComponentProps, ReactNode, useState, useEffect } from "react";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { Separator } from "@/components/ui/separator";
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
  Moon,
  Sun,
  WorkflowIcon,
  LibraryIcon,
  SettingsIcon,
  ListMusicIcon,
  ClapperboardIcon,
} from "lucide-react";
import {
  ChromeCloseIcon,
  ChromeMinimizeIcon,
  ChromeRestoreIcon,
} from "@fluentui/react-icons-mdl2";
import { Button } from "@/components/ui/button";
import { RouteAnimationContainer } from "@/components/route-animation-container";
import { createRootRoute, Outlet } from "@tanstack/react-router";
import LicenseViewer from "@/components/license-viewer";
import FloatingNav, { TabProps } from "@/components/floating-nav";
import { LoadingAnimation } from "@/components/animations/loading-animation";
import ErrorBoundary from "@/components/errorboundary";
import { Toaster } from "@/components/ui/sonner";
import { IconAlertOctagon } from "@tabler/icons-react";
import { appControl, AppControlProps } from "@/utils/global";
import { useStateMachine } from "@/store/stateMachine";
import { useSettings } from "@/store/settingsStore";
import { SettingsDialog } from "@/components/settings-dialog";
import { inDevelopment } from "@/constants";
import appIcon from "@/img/icon.png";

interface TitleBarButtonProps extends ComponentProps<typeof Button> {
  message?: AppControlProps;
  children: ReactNode;
}

function TitleBarButton({
  message,
  children,
  onClick,
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
      onClick={(e) => {
        if (onClick) {
          onClick(e);
        } else if (message) {
          try {
            appControl(message);
          } catch (error) {
            console.error(error);
          }
        }
      }}
    >
      {children}
    </Button>
  );
}

function CloseAppButton() {
  const { hasUnsavedChanges, setQuitRequested } = useStateMachine();

  function CheckUnsaved() {
    if (hasUnsavedChanges) {
      setQuitRequested(true);
    } else {
      appControl("closeApp");
    }
  }

  return (
    <TitleBarButton onClick={CheckUnsaved}>
      <ChromeCloseIcon />
    </TitleBarButton>
  );
}

function ExitMenuItem() {
  const { hasUnsavedChanges, setQuitRequested } = useStateMachine();

  function CheckUnsaved() {
    if (hasUnsavedChanges) {
      setQuitRequested(true);
    } else {
      appControl("closeApp");
    }
  }

  return <MenubarItem onClick={CheckUnsaved}>Exit</MenubarItem>;
}

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { settings, updateSettings } = useSettings();
  const theme = settings.theme;
  const setTheme = (newTheme: "light" | "dark" | "system") => {
    updateSettings({ theme: newTheme });
  };

  const items: TabProps[] = [
    {
      id: 0,
      label: "Library",
      icon: <LibraryIcon />,
      to: "/",
      className: "[&.active]:font-bold",
    },
    {
      id: 2,
      label: "Sonics",
      icon: <ListMusicIcon />,
      to: "/sonics",
      className: "[&.active]:font-bold",
    },
    {
      id: 3,
      label: "Scenes",
      icon: <ClapperboardIcon />,
      to: "/scenes",
      className: "[&.active]:font-bold",
    },
    {
      id: 1,
      label: "Flow",
      icon: <WorkflowIcon />,
      to: "/flow-editor",
      className: "[&.active]:font-bold",
    },
  ];

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  return (
    <>
      <div
        className="border-zinc-800/60 bg-zinc-950/40 backdrop-blur-md flex items-center justify-between"
        style={{
          width: "100%",
          height: "35px",
        }}
      >
        <FloatingNav items={items} />
        <Dialog>
          <DialogTrigger
            render={
              <button className="flex items-center justify-center h-[35px] w-[35px] hover:bg-zinc-800/40 transition-colors duration-150 outline-none cursor-pointer">
                <img
                  src={appIcon}
                  width={"20px"}
                  height={"20px"}
                  className="opacity-90"
                />
              </button>
            }
          />
          <DialogContent style={{ maxWidth: "500px" }}>
            <DialogHeader>
              <DialogTitle>SonicPlank.Maker</DialogTitle>
            </DialogHeader>
            <Separator />
            <div className="text-zinc-300 space-y-3">
              <p>
                A high-fidelity digital audio workstation, flow-based routing
                engine, and compositor environment.
              </p>
              <LicenseViewer />
            </div>
            <Separator />
            <DialogDescription>Copyright 2026 © Damon Batey</DialogDescription>
          </DialogContent>
        </Dialog>
        <div
          style={
            {
              WebkitAppRegion: "drag",
              display: "flex",
              alignItems: "center",
              flex: 1,
              height: "35px",
            } as React.CSSProperties
          }
        >
          <div
            id="windowTitle"
            className="text-[11px] font-semibold text-zinc-400 select-none tracking-wide"
            style={{
              marginLeft: "10px",
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
        <Button
          variant="ghost"
          style={{
            width: "35px",
            height: "35px",
            borderRadius: "0",
            margin: "0",
            padding: "0",
          }}
          onClick={() => setSettingsOpen(true)}
        >
          <SettingsIcon className="h-[1.2rem] w-[1.2rem]" />
          <span className="sr-only">Settings</span>
        </Button>
        <TitleBarButton message="minimizeApp">
          <ChromeMinimizeIcon />
        </TitleBarButton>
        <TitleBarButton message="maximizeApp">
          <ChromeRestoreIcon />
        </TitleBarButton>
        <CloseAppButton />
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
            <MenubarTrigger>File</MenubarTrigger>
            <MenubarContent>
              <MenubarGroup>
                {inDevelopment && (
                  <MenubarItem onClick={() => appControl("toggleDevTools")}>
                    DevTools
                    <MenubarShortcut>
                      <Kbd>Ctrl</Kbd>T
                    </MenubarShortcut>
                  </MenubarItem>
                )}
              </MenubarGroup>
              <MenubarGroup>
                <ExitMenuItem />
              </MenubarGroup>
            </MenubarContent>
          </MenubarMenu>
        </Menubar>
      </div>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />

      <RouteAnimationContainer>
        <Outlet />
      </RouteAnimationContainer>
      <div style={{ zIndex: 1000 }}>
        {/* <TanStackRouterDevtools
          position="top-right"
          containerElement="a"
          toggleButtonProps={{
            className: "nodrag nopan nowheel",
            style: {
              top: "70px",
              zIndex: 1000,
            },
          }}
        /> */}
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
export const Route = createRootRoute({
  component: App,
  pendingComponent: LoadingAnimation,
  errorComponent: ErrorBoundary,
});
