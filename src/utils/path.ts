import path from "node:path";

export function getBasePath() {
  return typeof __dirname === "undefined"
    ? process.cwd()
    : __dirname;
}
