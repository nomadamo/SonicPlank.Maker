/**
 * This file will automatically be loaded by vite and run in the "renderer" context.
 * To learn more about the differences between the "main" and the "renderer" context in
 * Electron, visit:
 *
 * https://electronjs.org/docs/tutorial/process-model
 *
 * By default, Node.js integration in this file is disabled. When enabling Node.js integration
 * in a renderer process, please be aware of potential security implications. You can read
 * more about security risks here:
 *
 * https://electronjs.org/docs/tutorial/security
 *
 * To enable Node.js integration in this file, open up `main.ts` and enable the `nodeIntegration`
 * flag:
 *
 * ```
 *  // Create the browser window.
 *  mainWindow = new BrowserWindow({
 *    width: 800,
 *    height: 600,
 *    webPreferences: {
 *      nodeIntegration: true
 *    }
 *  });
 * ```
 */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Theme, useThemeContext } from "@radix-ui/themes";
import App from './App';
import { ThemeProvider } from '@/components/themeprovider';
import './styles/globals.css';

declare global {
  interface Window {
    electron: {
      sendMessage: (message: string, args: unknown[]) => void;
    }
  }
}

function ThemedRoot({...props}) {
  return (
    <ThemeProvider {...props}>
      <App />
    </ThemeProvider>
  )
}


const body = document.getElementById('root');
const root = createRoot(body);

root.render(
  <Theme accentColor="gray">
    <ThemedRoot/>
  </Theme>
);
