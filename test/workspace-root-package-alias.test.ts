import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DEPENDENCY_SECTIONS = ["dependencies", "devDependencies", "optionalDependencies"] as const;

type PackageManifest = {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

function readPackageManifest(manifestPath: string): PackageManifest {
  return JSON.parse(readFileSync(manifestPath, "utf8")) as PackageManifest;
}

function listWorkspaceManifestPaths(): string[] {
  const manifestPaths = ["package.json", "ui/package.json"];
  for (const workspaceRoot of ["packages", "extensions", "examples"]) {
    for (const entry of readdirSync(workspaceRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const manifestPath = path.join(workspaceRoot, entry.name, "package.json");
      if (existsSync(manifestPath)) {
        manifestPaths.push(manifestPath);
      }
    }
  }
  return manifestPaths;
}

describe("workspace root package aliases", () => {
  it("links openclaw imports to the actual root package name", () => {
    const rootPackageName = readPackageManifest("package.json").name;
    expect(rootPackageName).toBeTruthy();
    const expectedSpecifier =
      rootPackageName === "openclaw" ? "workspace:*" : `workspace:${rootPackageName}@*`;
    const mismatches: string[] = [];

    for (const manifestPath of listWorkspaceManifestPaths()) {
      const manifest = readPackageManifest(manifestPath);
      for (const section of DEPENDENCY_SECTIONS) {
        const specifier = manifest[section]?.openclaw;
        if (specifier?.startsWith("workspace:") && specifier !== expectedSpecifier) {
          mismatches.push(`${manifestPath} ${section}.openclaw=${specifier}`);
        }
      }
    }

    expect(mismatches).toEqual([]);
  });
});
