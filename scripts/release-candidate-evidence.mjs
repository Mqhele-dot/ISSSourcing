import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const inputs=["server","shared","client","scripts","migrations","e2e",".github","package.json","package-lock.json","playwright.config.ts","tsconfig.json","drizzle.config.ts","vite.config.ts","theme.json"];

export function fingerprintSourceFiles(root, files) {
  const hash=createHash("sha256");
  for(const file of [...new Set(files)].sort()) {
    hash.update(file); hash.update("\0");
    try { hash.update(createHash("sha256").update(readFileSync(path.join(root,file))).digest()); }
    catch(error) { if(error.code!=="ENOENT")throw error; hash.update("missing"); }
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function captureReleaseCandidate(root=process.cwd()) {
  const options={cwd:root,encoding:"utf8",maxBuffer:16*1024*1024,windowsHide:true};
  const revision=execFileSync("git",["rev-parse","HEAD"],options).trim();
  const files=execFileSync("git",["ls-files","-z","--cached","--others","--exclude-standard","--",...inputs],options).split("\0").filter(Boolean);
  return {revision,sourceFingerprint:fingerprintSourceFiles(root,files),sourceFileCount:new Set(files).size};
}
