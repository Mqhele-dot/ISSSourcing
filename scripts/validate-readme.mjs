#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const rootDir = process.cwd();
const docsFile = path.join(rootDir, "CODESPACES.md");
const envFile = path.join(rootDir, ".env.example");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function requireFile(filePath, label) {
  if (!fs.existsSync(filePath)) {
    fail(`Missing ${label}: ${filePath}`);
  }
  return fs.readFileSync(filePath, "utf8");
}

function requireContains(content, needle, message) {
  if (!content.includes(needle)) {
    fail(message);
  }
}

function requireLine(content, expected, message) {
  const lines = content.split(/\r?\n/);
  if (!lines.includes(expected)) {
    fail(message);
  }
}

const docs = requireFile(docsFile, "docs file");
const env = requireFile(envFile, "env template");

requireContains(docs, "npm run codespaces:up", "CODESPACES.md must document 'npm run codespaces:up'");
requireContains(docs, "Server | 5000", "CODESPACES.md must document server port 5000");
requireContains(docs, "PostgreSQL | 5432", "CODESPACES.md must document PostgreSQL port 5432");

requireLine(env, "PORT=5000", ".env.example must set PORT=5000");
requireLine(env, "CLIENT_PORT=5000", ".env.example must set CLIENT_PORT=5000");
requireLine(env, "DB_PORT=5432", ".env.example must set DB_PORT=5432");

console.log("Docs validation passed");
