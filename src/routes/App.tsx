import { ComponentProps, ReactNode, useState, useEffect, useRef } from "react";
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
  LayoutTemplate as LayoutTemplateIcon,
  ChevronUp as ChevronUpIcon,
} from "lucide-react";
import {
  ChromeCloseIcon,
  ChromeMinimizeIcon,
  ChromeRestoreIcon,
} from "@fluentui/react-icons-mdl2";
import { Button } from "@/components/ui/button";
import { RouteAnimationContainer } from "@/components/route-animation-container";
import { createRootRoute, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
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
import { useVodTracking } from "@/hooks/use-vod-tracking";
import { ApiBridge } from "@/components/api-bridge";
import appIcon from "@/img/icon.png";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  globalPlayingItemIdAtom,
  currentPlaybackAtom,
  useLibraryStore,
  pollSpotifyPlaybackAtom,
  spotifyNeedsReauthAtom,
  authenticateSpotify,
  spotifyPlayerVisibleAtom,
} from "@/store/libraryStore";
import { toast } from "sonner";
import {
  timelineDataAtom,
  loadTimelineDataAtom,
  sonicsCurrentPathAtom,
  sonicsHasUnsavedChangesAtom,
} from "@/store/timelineStore";
import {
  flowDataAtom,
  loadFlowDataAtom,
  flowCurrentPathAtom,
  flowHasUnsavedChangesAtom,
  updateNodeDataAtom,
} from "@/store/flowStore";
import { resolveThemeElements } from "@/utils/resolve-theme";
import type { OverlayThemeLayout } from "@/types/flow-node";
import { LibraryAudioPlayerWrapper } from "@/components/library-audio-player";
import { SpotifyLibraryPlayer } from "@/components/spotify-library-player";
import { VisualizerBackdrop } from "@/components/visualizer-backdrop";
import { motion } from "motion/react";

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
  const { setQuitRequested } = useStateMachine();
  const sonicsUnsaved = useAtomValue(sonicsHasUnsavedChangesAtom);
  const sonicsPath = useAtomValue(sonicsCurrentPathAtom);
  const flowUnsaved = useAtomValue(flowHasUnsavedChangesAtom);
  const hasUnsavedChanges = (sonicsUnsaved && !!sonicsPath) || flowUnsaved;

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
  const { setQuitRequested } = useStateMachine();
  const sonicsUnsaved = useAtomValue(sonicsHasUnsavedChangesAtom);
  const sonicsPath = useAtomValue(sonicsCurrentPathAtom);
  const flowUnsaved = useAtomValue(flowHasUnsavedChangesAtom);
  const hasUnsavedChanges = (sonicsUnsaved && !!sonicsPath) || flowUnsaved;

  function CheckUnsaved() {
    if (hasUnsavedChanges) {
      setQuitRequested(true);
    } else {
      appControl("closeApp");
    }
  }

  return <MenubarItem onClick={CheckUnsaved}>Exit</MenubarItem>;
}

function useSceneSwitchHandler() {
  const updateNodeData = useSetAtom(updateNodeDataAtom);
  const flowData = useAtomValue(flowDataAtom);
  const flowDataRef = useRef(flowData);
  flowDataRef.current = flowData;

  useEffect(() => {
    const handler = (event: { nodeId: string; sceneId: string }) => {
      const node = flowDataRef.current.nodes.find((n) => n.id === event.nodeId);
      if (!node) return;
      const themeLayout = node.data.themeLayout as OverlayThemeLayout | null;
      const variables = (node.data.themeVariables as Record<string, string>) ?? {};
      if (!themeLayout) return;
      const resolved = resolveThemeElements(themeLayout, variables, event.sceneId);
      updateNodeData({ id: event.nodeId, patch: { activeSceneId: event.sceneId, themeResolvedElements: resolved }, markUnsaved: false });
    };

    window.electron.onSceneSwitch(handler);
    return () => {
      window.electron.removeOnSceneSwitch();
    };
  }, [updateNodeData]);
}

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { settings, updateSettings } = useSettings();
  const theme = settings.theme;
  const setTheme = (newTheme: "light" | "dark" | "system") => {
    updateSettings({ theme: newTheme });
  };

  const [playingItemId, setPlayingItemId] = useAtom(globalPlayingItemIdAtom);
  const [currentPlayback, setCurrentPlayback] = useAtom(currentPlaybackAtom);
  const [spotifyPlayerVisible, setSpotifyPlayerVisible] = useAtom(spotifyPlayerVisibleAtom);
  const { items: libraryItems } = useLibraryStore();
  const [showVisualizer, setShowVisualizer] = useState(false);
  const pollPlayback = useSetAtom(pollSpotifyPlaybackAtom);
  const spotifyNeedsReauth = useAtomValue(spotifyNeedsReauthAtom);
  const reconnectSpotify = useSetAtom(authenticateSpotify);

  const [sonicsData] = useAtom(timelineDataAtom);
  const loadSonicsData = useSetAtom(loadTimelineDataAtom);
  const [sonicsPath, setSonicsPath] = useAtom(sonicsCurrentPathAtom);
  const [sonicsUnsaved, setSonicsUnsaved] = useAtom(sonicsHasUnsavedChangesAtom);

  const [flowData] = useAtom(flowDataAtom);
  const loadFlowData = useSetAtom(loadFlowDataAtom);
  const [flowPath, setFlowPath] = useAtom(flowCurrentPathAtom);
  const [flowUnsaved, setFlowUnsaved] = useAtom(flowHasUnsavedChangesAtom);

  useEffect(() => {
    const interval = setInterval(() => {
      pollPlayback();
    }, 3000);
    return () => clearInterval(interval);
  }, [pollPlayback]);

  useEffect(() => {
    if (!spotifyNeedsReauth) return;
    toast.error("Spotify session expired", {
      description: "Re-connect to restore playback.",
      duration: 12000,
      action: {
        label: "Re-connect",
        onClick: () => reconnectSpotify(),
      },
    });
  }, [spotifyNeedsReauth, reconnectSpotify]);

  useVodTracking();
  useSceneSwitchHandler();

  const { setQuitRequested } = useStateMachine();

  useEffect(() => {
    window.electron.onNativeWindowClose(() => {
      const hasUnsavedChanges = (sonicsUnsaved && !!sonicsPath) || flowUnsaved;
      if (hasUnsavedChanges) {
        setQuitRequested(true);
      } else {
        appControl("closeApp");
      }
    });
    return () => {
      window.electron.removeOnNativeWindowClose();
    };
  }, [sonicsUnsaved, sonicsPath, flowUnsaved, setQuitRequested]);

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
      label: "Marquee",
      icon: <LayoutTemplateIcon />,
      to: "/marquee",
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

  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "Tab") {
        e.preventDefault();
        const currentPath = location.pathname;
        const currentIndex = items.findIndex((item) => item.to === currentPath);
        if (currentIndex !== -1) {
          const nextIndex = (currentIndex + 1) % items.length;
          navigate({ to: items[nextIndex].to });
        } else {
          navigate({ to: items[0].to });
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [location.pathname, navigate]);

  const activeItem = items.find((item) => item.to === location.pathname);
  const activeTitle = activeItem ? activeItem.label : "";

  const initialSonicsRef = useRef(sonicsData);
  useEffect(() => {
    if (sonicsData !== initialSonicsRef.current) {
      if (sonicsPath) setSonicsUnsaved(true);
      initialSonicsRef.current = sonicsData;
    }
  }, [sonicsData, setSonicsUnsaved, sonicsPath]);

  const handleLoadSonics = async () => {
    const result = await window.electron.showOpenDialog({
      filters: [{ name: "SonicPlank Project", extensions: ["sonic"] }],
      properties: ["openFile"],
    });
    if (!result.canceled && result.filePaths.length > 0) {
      const path = result.filePaths[0];
      const dataStr = await window.electron.readProject(path);
      if (dataStr) {
        try {
          const parsed = JSON.parse(dataStr);
          initialSonicsRef.current = parsed;
          loadSonicsData(parsed);
          setSonicsPath(path);
          setSonicsUnsaved(false);
        } catch (e) {
          console.error("Failed to parse sonics project", e);
        }
      }
    }
  };

  const handleSaveSonics = async () => {
    if (sonicsPath) {
      const success = await window.electron.saveProject(sonicsPath, JSON.stringify(sonicsData));
      if (success) {
        initialSonicsRef.current = sonicsData;
        setSonicsUnsaved(false);
      }
    } else {
      handleSaveSonicsAs();
    }
  };

  const handleSaveSonicsAs = async () => {
    const result = await window.electron.showSaveDialog({
      filters: [{ name: "SonicPlank Project", extensions: ["sonic"] }],
    });
    if (!result.canceled && result.filePath) {
      const success = await window.electron.saveProject(result.filePath, JSON.stringify(sonicsData));
      if (success) {
        initialSonicsRef.current = sonicsData;
        setSonicsPath(result.filePath);
        setSonicsUnsaved(false);
      }
    }
  };

  const handleLoadFlow = async () => {
    const result = await window.electron.showOpenDialog({
      filters: [{ name: "SonicPlank Flow", extensions: ["flow"] }],
      properties: ["openFile"],
    });
    if (!result.canceled && result.filePaths.length > 0) {
      const path = result.filePaths[0];
      const dataStr = await window.electron.readProject(path);
      if (dataStr) {
        try {
          const parsed = JSON.parse(dataStr);
          loadFlowData(parsed);
          setFlowPath(path);
          setFlowUnsaved(false);
        } catch (e) {
          console.error("Failed to parse flow project", e);
        }
      }
    }
  };

  const handleSaveFlow = async () => {
    if (flowPath) {
      const success = await window.electron.saveProject(flowPath, JSON.stringify(flowData));
      if (success) {
        setFlowUnsaved(false);
      }
    } else {
      handleSaveFlowAs();
    }
  };

  const handleSaveFlowAs = async () => {
    const result = await window.electron.showSaveDialog({
      filters: [{ name: "SonicPlank Flow", extensions: ["flow"] }],
    });
    if (!result.canceled && result.filePath) {
      const success = await window.electron.saveProject(result.filePath, JSON.stringify(flowData));
      if (success) {
        setFlowPath(result.filePath);
        setFlowUnsaved(false);
      }
    }
  };

  useEffect(() => {
    const handleSaveShortcut = (e: KeyboardEvent) => {
      // Use e.ctrlKey for Windows/Linux or e.metaKey for Mac
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (activeTitle === "Sonics" && sonicsUnsaved) {
          void handleSaveSonics();
        } else if (activeTitle === "Flow" && flowUnsaved) {
          void handleSaveFlow();
        }
      }
    };
    window.addEventListener("keydown", handleSaveShortcut);
    return () => window.removeEventListener("keydown", handleSaveShortcut);
  });

  const getFileName = (path: string | null) => {
    if (!path) return "";
    return path.split(/[/\\]/).pop() || "";
  };

  const activeFilePath =
    activeTitle === "Sonics"
      ? sonicsPath
      : activeTitle === "Flow"
      ? flowPath
      : null;
  const activeFileName = getFileName(activeFilePath);

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  return (
    <>
      <ApiBridge />
      <div
        className="border-border/60 bg-background/40 backdrop-blur-md flex items-center justify-between"
        style={{
          width: "100%",
          height: "35px",
        }}
      >
        <FloatingNav items={items} />
        <Dialog>
          <DialogTrigger
            render={
              <button className="flex items-center justify-center h-[35px] w-[35px] hover:bg-secondary/40 transition-colors duration-150 outline-none cursor-pointer">
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
            <div className="text-foreground/80 space-y-3">
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
            className="text-[11px] font-semibold text-muted-foreground select-none tracking-wide flex items-center gap-2"
            style={{
              marginLeft: "10px",
            }}
          >
            <span>SonicPlank.Maker {activeTitle ? `[${activeTitle}]` : ""}</span>
            {activeFileName && (
              <span className="text-muted-foreground font-normal">
                — {activeFileName}
              </span>
            )}
            <span className="text-red-400">
              {activeTitle === "Sonics" && sonicsUnsaved ? "*" : ""}
              {activeTitle === "Flow" && flowUnsaved ? "*" : ""}
            </span>
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
              {activeTitle === "Sonics" && (
                <MenubarGroup>
                  <MenubarItem onClick={handleLoadSonics}>Load Sonics Project...</MenubarItem>
                  <MenubarItem onClick={handleSaveSonics}>Save Sonics Project</MenubarItem>
                  <MenubarItem onClick={handleSaveSonicsAs}>Save Sonics Project As...</MenubarItem>
                  <Separator className="my-1" />
                </MenubarGroup>
              )}
              {activeTitle === "Flow" && (
                <MenubarGroup>
                  <MenubarItem onClick={handleLoadFlow}>Load Flow...</MenubarItem>
                  <MenubarItem onClick={handleSaveFlow}>Save Flow</MenubarItem>
                  <MenubarItem onClick={handleSaveFlowAs}>Save Flow As...</MenubarItem>
                  <Separator className="my-1" />
                </MenubarGroup>
              )}
              <MenubarGroup>
                <MenubarItem onClick={() => appControl("toggleDevTools")}>
                  Dev Tools
                  <MenubarShortcut>
                    <Kbd>Ctrl</Kbd>T
                  </MenubarShortcut>
                </MenubarItem>
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

      {/* Mini Spotify indicator — shown when there's ambient playback but player is dismissed */}
      {currentPlayback && !spotifyPlayerVisible && !playingItemId && (
        <button
          onClick={() => setSpotifyPlayerVisible(true)}
          className="fixed bottom-0 left-0 right-0 z-50 flex items-center gap-2 px-4 h-8 bg-card/90 backdrop-blur-sm border-t border-border/60 text-xs text-muted-foreground hover:text-foreground hover:bg-card transition-colors cursor-pointer"
          style={{ pointerEvents: "auto" }}
        >
          <ChevronUpIcon className="h-3 w-3 shrink-0" />
          <span className="truncate font-medium">{currentPlayback.title}</span>
          <span className="truncate text-muted-foreground/70">— {currentPlayback.artist}</span>
        </button>
      )}

      {/* Global Player Container */}
      <motion.div
        initial={false}
        animate={{ y: playingItemId || spotifyPlayerVisible ? 0 : "100%" }}
        transition={{ type: "spring", bounce: 0, duration: 0.4 }}
        className="fixed bottom-0 left-0 right-0 z-50 p-0 border-t shadow-2xl rounded-t-xl bg-card max-h-[80vh] flex flex-col overflow-hidden"
        style={{
          pointerEvents: playingItemId || spotifyPlayerVisible ? "auto" : "none",
        }}
      >
        <VisualizerBackdrop visible={!!playingItemId && showVisualizer} />
        <div className="w-full flex flex-col py-1 relative z-10">
          {(() => {
            if (playingItemId) {
              const playingItem = libraryItems.find(
                (i) => i.id === playingItemId,
              );
              if (!playingItem) return null;
              return playingItem.isSpotifyStream ||
                playingItem.isSpotifyPlaylist ? (
                <SpotifyLibraryPlayer
                  key={playingItemId}
                  item={playingItem}
                  onStop={() => setPlayingItemId(null)}
                />
              ) : (
                <LibraryAudioPlayerWrapper
                  key={playingItemId}
                  item={playingItem}
                  onStop={() => setPlayingItemId(null)}
                  showVisualizer={showVisualizer}
                  onToggleVisualizer={() => setShowVisualizer(!showVisualizer)}
                />
              );
            }
            if (currentPlayback && spotifyPlayerVisible) {
              return (
                <SpotifyLibraryPlayer
                  key="__current_playback__"
                  item={{
                    id: "__current_playback__",
                    title: currentPlayback.title,
                    artist: currentPlayback.artist,
                    albumArt: currentPlayback.albumArt,
                    filePath: currentPlayback.uri,
                    duration: currentPlayback.duration,
                    addedAt: Date.now(),
                    isSpotifyStream: !currentPlayback.isPlaylist || undefined,
                    isSpotifyPlaylist: currentPlayback.isPlaylist || undefined,
                  }}
                  autoPlay={false}
                  onStop={() => setSpotifyPlayerVisible(false)}
                />
              );
            }
            return null;
          })()}
        </div>
      </motion.div>
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
        visibleToasts={3}
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
