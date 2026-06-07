declare global {
  interface window {
    electron: {
      sendMessage: (message: string, args: unknown[]) => void;
      readData: () => Promise<string>;
      saveData: () => Promise<void>;
      onLog: (callback: (event: any, data: string) => void) => void;
      removeOnLog: (callback: (event: any, data: string) => void) => void;
    };
  }
}
