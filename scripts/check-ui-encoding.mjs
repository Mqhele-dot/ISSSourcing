import fs from "node:fs";
import path from "node:path";

const roots = ["client/src", "server", "shared"];
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".mjs"]);
const mojibake = /(?:Ã.|Â.|â(?:€|€™|€œ|€|€¦|€“|€”|†|‡)|ðŸ|\uFFFD)/u;
const failures = [];

function visit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) visit(file);
    else if (sourceExtensions.has(path.extname(entry.name))) {
      const text = fs.readFileSync(file, "utf8");
      text.split(/\r?\n/).forEach((line, index) => {
        if (mojibake.test(line)) failures.push(`${file}:${index + 1}`);
      });
    }
  }
}

for (const root of roots) visit(root);
if (failures.length) {
  console.error(`Potential mojibake found:\n${failures.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log("UI/source encoding check passed.");
}
