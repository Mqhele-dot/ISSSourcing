#!/usr/bin/env node
import { execFileSync } from "node:child_process";

const productionBaseBranch = "cursor/project-codespace-compatibility-b14c";

function git(args) {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return "";
  }
}

const currentBranch =
  process.env.GITHUB_HEAD_REF ||
  process.env.GITHUB_REF_NAME ||
  git(["branch", "--show-current"]) ||
  "(unknown)";
const targetBranch = process.env.GITHUB_BASE_REF || "";

let descendsFromProductionBase = false;
if (!process.env.GITHUB_ACTIONS) {
  const mergeBase = git(["merge-base", "HEAD", productionBaseBranch]);
  const baseSha = git(["rev-parse", productionBaseBranch]);
  descendsFromProductionBase = Boolean(mergeBase && baseSha && mergeBase === baseSha);
}

const isProductionBase = currentBranch === productionBaseBranch;
const targetsProductionBase = targetBranch === productionBaseBranch;

if (isProductionBase || targetsProductionBase || descendsFromProductionBase) {
  console.log(`[production-base] OK: ${currentBranch}`);
  if (targetBranch) console.log(`[production-base] Target branch: ${targetBranch}`);
  process.exit(0);
}

console.warn(
  `[production-base] WARNING: current branch '${currentBranch}' is not the selected production-base branch '${productionBaseBranch}'.`,
);
if (targetBranch) {
  console.warn(`[production-base] Pull request target branch: ${targetBranch}`);
}
console.warn(
  "[production-base] This warning does not block feature branches, but production stabilisation changes should be rebased onto the selected branch before release.",
);
