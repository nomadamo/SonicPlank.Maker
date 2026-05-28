
import { ComponentProps, ReactNode, useState, useEffect, useEffectEvent, useRef, useLayoutEffect } from 'react';
import '@radix-ui/themes/styles.css';
import { Text, Box, useThemeContext, Theme, ThemePanel, Separator } from "@radix-ui/themes";
import { useTheme } from '@/components/themeprovider';
import { Background, FitViewOptions, ReactFlow, ColorMode, Controls, ControlButton, MiniMap, ReactFlowProvider } from "@xyflow/react";
import { DevTools } from "@/components/devtools";
import {
  Menubar,
  MenubarContent,
  MenubarGroup,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarShortcut,
  MenubarTrigger,
} from "@/components/ui/menubar"
import { Kbd } from '@/components/ui/kbd';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
  DialogFooter
} from "@/components/ui/dialog"
import { Flow } from './Flow'
import { Maximize2Icon, Minimize2Icon, XIcon, Moon, Sun } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { BookOpen, Layers } from "lucide-react";
import { Label } from '@/components/ui/label';

const nodeTypes = {
  test: Flow,
};

const fitViewOptions: FitViewOptions = {
  padding: "100px",
};


const defaultNodes = [{
    id: "2",
    position: { x: 200, y: 200 },
    data: {
      title: 'Fuck you',
      content: <Label>Suck my nuts</Label>,
      description: 'Look, a little bitch'
    },
    type: "test",
  },
{
    id: "3",
    position: { x: 400, y: 400 },
    data: {
      title: 'Yeah you',
      content: <Text size="1">Are the nuts sucked yet?</Text>,
      description: 'Hey, bitch'
    },
    type: "test",
  }];

interface TitleBarButtonProps extends ComponentProps<typeof Button> {
  message: "minimizeApp" | "maximizeApp" | "closeApp" | "appMenu" | null,
  children: ReactNode,
}

function TitleBarButton ({message, children, ...props}: TitleBarButtonProps) {
  return(
    <Button variant="ghost" style={{ width: '40px', height: '35px', borderRadius: '0', margin: '0', padding: '0' }} {...props} onClick={() => {
      try {
        sendIpcMessage(message);
      } catch (error) {
        console.error(error);
      }
    }}>
    {children}
    </Button>
  );
}

function sendIpcMessage(message: string | null) {
  try {
    window.electron.sendMessage(message);
  } catch (error) {
    console.error(error);
  }
}

const unsavedChanges = true;

export default function App() {

  const { theme, setTheme } = useTheme();
  const [ _, setAppearance ] = useState(useThemeContext().appearance);
  const [ colorMode, setColorMode ] = useState(theme as ColorMode)
  const [ showSaveDialog, setShowSaveDialog ] = useState(false);
  const themeRef = useRef(theme);
  const colorModeRef = useRef(colorMode);

  function CheckUnsaved() {
    if (unsavedChanges) {
      setShowSaveDialog(true);
    } else {
      window.electron.sendMessage("closeApp");
    }
  }

  useEffect(() => {
    if (themeRef.current != theme) {

      setColorMode(theme as ColorMode);
      setAppearance(theme != 'system' ? theme : 'inherit')

    }
    if (colorModeRef.current != colorMode) {

      setTheme(colorMode);
      setAppearance(theme != 'system' ? theme : 'inherit')

    }
    themeRef.current = theme;
    colorModeRef.current = colorMode;
  }, [theme, colorMode])

  return (
    <ReactFlowProvider>
        <ThemePanel style={{ top: '60px' }}/>
        <div style={{ width: '100vw', marginTop: '0px', height: 'calc(100vh - 61px)' }}>
          <div style={{ display: 'flex', alignContent: 'space-between', width: '100%', height:'30px' }}>
            <Dialog open={showSaveDialog} modal={true} closeOnEscape={true}>
              <DialogTrigger />
              <DialogContent showCloseButton={false}>
                <DialogHeader>
                  <DialogTitle>Unsaved changes</DialogTitle>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setShowSaveDialog(false) }>Cancel</Button>
                  <Button variant="outline" onClick={() => sendIpcMessage("closeApp")}>Discard</Button>
                  <Button variant="outline" role='button' color='primary' onClick={() => sendIpcMessage("closeApp")}>Save</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="ghost" style={{ width: '30px', height: '30px', borderRadius: '0', margin: '2px', padding: '2px' }}><img src="/src/img/icon.png" width={'38px'} height={'38px'}/></Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>SonicPlank.Maker</DialogTitle>
                  <Separator/>
                  <Box>
                    <Text>Beginning with shutting the fuck up, takes time to just up an ass</Text>
                  </Box>
                  <Separator/>
                  <DialogDescription>
                    Copyright 2026 © Damon Batey
                  </DialogDescription>
                </DialogHeader>
                <DialogClose></DialogClose>
              </DialogContent>
            </Dialog>
            <div style={{ appRegion: 'drag', display:'flex', alignContent:'start', width: '100%', height: '30px' }}>
              <Text id='windowTitle' style={{  marginTop:'5px', marginLeft: '10px', height: '40px'}}>SonicPlank.Maker</Text>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" style={{ width: '40px', height: '35px' }}>
                  <Sun className="h-[1.2rem] w-[1.2rem] scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
                  <Moon className="absolute h-[1.2rem] w-[1.2rem] scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
                  <span className="sr-only">Toggle theme</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setColorMode("light")}>
                  Light
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setColorMode("dark")}>
                  Dark
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() =>  setColorMode("system")}>
                  System
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <TitleBarButton message="minimizeApp"><Minimize2Icon /></TitleBarButton>
            <TitleBarButton message="maximizeApp"><Maximize2Icon /></TitleBarButton>
            <TitleBarButton message="closeApp"><XIcon /></TitleBarButton>
          </div>
          <div style={{ display: 'flex', alignContent: 'space-between', width: '100%', height:'30px' }}>
          <Menubar style={{ height:'30px', width:'100%', borderTop: '0', borderLeft: '0', borderRight: '0', borderRadius: '0' }}>
            <MenubarMenu>
              <MenubarTrigger>File</MenubarTrigger>
              <MenubarContent>
                <MenubarGroup>
                  <MenubarItem>
                    New Tab <MenubarShortcut><Kbd>Ctrl</Kbd>T</MenubarShortcut>
                  </MenubarItem>
                  <MenubarItem>New Window</MenubarItem>
                </MenubarGroup>
                <MenubarSeparator />
                <MenubarGroup>
                  <MenubarItem>Share</MenubarItem>
                  <MenubarItem>Print</MenubarItem>
                </MenubarGroup>
                <MenubarSeparator />
                <MenubarGroup>
                  <MenubarItem onClick={() => { CheckUnsaved(); }}>Exit</MenubarItem>
                </MenubarGroup>
              </MenubarContent>
            </MenubarMenu>
          </Menubar>
          </div>
          <ReactFlow
            id='reactFlowProvider'
            colorMode={theme}
            defaultNodes={defaultNodes}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={fitViewOptions}
            proOptions={{
              hideAttribution: true
            }}
          >

            <DevTools position="top-left" />
            <Controls position="bottom-left" style={{ bottom: '36px' }}/>
            <MiniMap position="bottom-left" style={{ left: '30px', bottom: '30px' }}/>
            <Background/>
          </ReactFlow>
        </div>
    </ReactFlowProvider>
  );
}
