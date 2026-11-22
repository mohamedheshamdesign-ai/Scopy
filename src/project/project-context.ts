import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const PROJECT_DOCUMENTS = [
  "IMPLEMENTED_FEATURES.md",
  "PLANNED_FEATURES.md",
  "ARCHITECTURE.md",
  "IMPLEMENTATION_PLAN.md",
] as const;

function getTrackedFiles(rootDir: string): Promise<string[]> {
  return new Promise((resolvePromise, reject) => {
    execFile(
      "git",
      ["ls-files"],
      {
        cwd: rootDir,
        encoding: "utf8",
        windowsHide: true,
        maxBuffer: 1_000_000,
      },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolvePromise(stdout.split(/\r?\n/).map((path) => path.trim()).filter(Boolean));
      },
    );
  });
}

export function formatTrackedInventory(paths: readonly string[]): string {
  return [
    "# Live tracked repository inventory",
    "Source: read-only git ls-files executed in the current Scopy checkout.",
    "These are exact tracked paths, not proposed architecture paths.",
    "A listed test file does not prove that its tests pass.",
    "",
    ...[...paths].sort((a, b) => a.localeCompare(b)),
  ].join("\n");
}

async function readOptionalDocument(rootDir: string, name: string): Promise<string | null> {
  try {
    return await readFile(resolve(rootDir, "docs", name), "utf8");
  } catch {
    return null;
  }
}

export async function loadProjectContext(rootDir = process.cwd()): Promise<string> {
  const sections: string[] = [];

  try {
    const trackedPaths = await getTrackedFiles(rootDir);
    sections.push(formatTrackedInventory(trackedPaths));
  } catch {
    const snapshot = await readOptionalDocument(rootDir, "REPOSITORY_INVENTORY.md");
    if (snapshot) sections.push(snapshot);
  }

  for (const documentName of PROJECT_DOCUMENTS) {
    const document = await readOptionalDocument(rootDir, documentName);
    if (document) sections.push(document);
  }

  return sections.join("\n\n");
}
