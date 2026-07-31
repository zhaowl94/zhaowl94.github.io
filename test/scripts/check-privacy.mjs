import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const excludedDirectories = new Set([
  ".git",
  "node_modules",
  "playwright-report",
  "test-results",
]);
const excludedFiles = new Set(["package-lock.json", "social-preview.png"]);
const allowedPublicRepositories = new Set([
  "html_sample",
  "ProcessSqlData-TS",
  "ReadWechatMessage",
  "ttjjCrawler",
  "youtube-dl",
  "yuanshen",
  "zhaowl94.github.io",
]);
const sensitivePatterns = [
  {
    label: "GitHub token",
    pattern:
      /\b(?:gh[oprsu]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/gu,
  },
  {
    label: "OpenAI-style token",
    pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/gu,
  },
  {
    label: "private key",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/gu,
  },
  {
    label: "Windows user path",
    pattern: /\b[A-Z]:\\Users\\[^\\\s]+/giu,
  },
  {
    label: "Unix home path",
    pattern: /\/(?:home|Users)\/[^/\s]+/gu,
  },
  {
    label: "email address",
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu,
  },
];

async function sourceFiles(directory) {
  const files = [];

  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) {
      continue;
    }

    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await sourceFiles(absolutePath)));
    } else if (!excludedFiles.has(entry.name)) {
      files.push(absolutePath);
    }
  }

  return files;
}

const failures = [];
const files = await sourceFiles(projectRoot);

for (const file of files) {
  const content = await readFile(file, "utf8");
  const relativePath = path.relative(projectRoot, file);

  for (const { label, pattern } of sensitivePatterns) {
    pattern.lastIndex = 0;
    if (pattern.test(content)) {
      failures.push(`${relativePath}: ${label}`);
    }
  }

  const repositoryPattern =
    /https:\/\/github\.com\/zhaowl94\/([A-Za-z0-9_.-]+)/gu;
  for (const match of content.matchAll(repositoryPattern)) {
    if (!allowedPublicRepositories.has(match[1])) {
      failures.push(
        `${relativePath}: link to an unapproved repository ${match[1]}`,
      );
    }
  }
}

if (failures.length > 0) {
  throw new Error(`Privacy checks failed:\n${failures.join("\n")}`);
}

console.log(`Privacy checks passed across ${files.length} source files.`);
