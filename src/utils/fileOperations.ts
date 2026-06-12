import { app } from "electron";
import * as fs from "fs";
import * as path from "path";

const userDataPath = app.getPath("appData");
const igxDirectoryPath = path.join(userDataPath, "SonicPlank.Maker");
const parentDirectoryPath = path.join(igxDirectoryPath, "Data");

function ensureICSDirectory(): void {
  if (!fs.existsSync(parentDirectoryPath)) {
    fs.mkdirSync(parentDirectoryPath, { recursive: true });
    console.log("Directory created successfully:", parentDirectoryPath);
  }
}

// Ensure directory and file existence
function ensureFileExistence(filePath: string): void {
  const dirname = path.dirname(filePath);
  if (!fs.existsSync(dirname)) {
    fs.mkdirSync(dirname, { recursive: true });
  }

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify({}), "utf-8");
  }
}

export async function writeData(data: any): Promise<void> {
  const directoryPath = path.join(parentDirectoryPath);
  const filePath = path.join(directoryPath, "storednodes.json");
  ensureFileExistence(filePath);

  const dataToWrite =
    typeof data === "string" ? data : JSON.stringify(data, null, 2);
  fs.writeFileSync(filePath, dataToWrite, "utf-8");
}

// Read data from a file
export function readData(): any {
  ensureICSDirectory();
  const filePath = path.join(parentDirectoryPath, "storednodes.json");
  if (fs.existsSync(filePath)) {
    const data = fs.readFileSync(filePath, "utf-8");
    return data;
  } else {
    return "{}";
  }
}

// Read library data
export function readLibrary(): string {
  ensureICSDirectory();
  const filePath = path.join(parentDirectoryPath, "library.json");
  if (fs.existsSync(filePath)) {
    const data = fs.readFileSync(filePath, "utf-8");
    return data;
  } else {
    return JSON.stringify({ items: [] });
  }
}

// Write library data
export async function writeLibrary(data: any): Promise<void> {
  const filePath = path.join(parentDirectoryPath, "library.json");
  ensureFileExistence(filePath);

  const dataToWrite =
    typeof data === "string" ? data : JSON.stringify(data, null, 2);
  fs.writeFileSync(filePath, dataToWrite, "utf-8");
}

// Read timeline data
export function readTimeline(): string {
  ensureICSDirectory();
  const filePath = path.join(parentDirectoryPath, "timeline.json");
  if (fs.existsSync(filePath)) {
    const data = fs.readFileSync(filePath, "utf-8");
    return data;
  } else {
    return JSON.stringify({ tracks: [] });
  }
}

// Write timeline data
export async function writeTimeline(data: any): Promise<void> {
  const filePath = path.join(parentDirectoryPath, "timeline.json");
  ensureFileExistence(filePath);

  const dataToWrite =
    typeof data === "string" ? data : JSON.stringify(data, null, 2);
  fs.writeFileSync(filePath, dataToWrite, "utf-8");
}
