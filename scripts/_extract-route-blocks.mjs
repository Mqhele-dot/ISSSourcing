import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const routesPath = path.join(__dirname, "../server/routes.ts");
const lines = fs.readFileSync(routesPath, "utf8").split(/\r?\n/);

function slice(startLine, endInclusive) {
  return lines.slice(startLine - 1, endInclusive).join("\n");
}

// Line numbers from current routes.ts (1-based)
fs.writeFileSync(
  path.join(__dirname, "../server/modules/suppliers/_body-a.txt"),
  slice(1315, 1631),
);
fs.writeFileSync(
  path.join(__dirname, "../server/modules/suppliers/_body-logos.txt"),
  slice(2388, 2479),
);
console.log("wrote supplier chunks");
