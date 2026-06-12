export type AppControlProps = "minimizeApp" | "maximizeApp" | "closeApp" | "toggleDevTools";
export type FileOpsProps = "readstorage" | "writestorage";

export const appControl = (appControlMessage: AppControlProps) => {
  try {
    window.electron.sendMessage(appControlMessage, []);
  } catch (error) {
    console.error(error);
  }
}

export const onLogMessage = (_event: any, value: string) => {
  try {
    console.log(value);
  } catch (error) {
    console.error(error);
  }
}

export default { appControl, onLogMessage };
