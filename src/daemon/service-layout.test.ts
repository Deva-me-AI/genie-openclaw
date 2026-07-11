import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { withTempDir } from "../test-helpers/temp-dir.js";
import {
  resolveGatewayServiceEntrypoint,
  summarizeGatewayServiceLayout,
} from "./service-layout.js";

describe("resolveGatewayServiceEntrypoint", () => {
  it("resolves a relative entrypoint against an absolute working directory", () => {
    expect(
      resolveGatewayServiceEntrypoint({
        programArguments: ["node", "dist/index.js", "gateway", "run"],
        workingDirectory: "/repo/openclaw",
      }),
    ).toBe(path.join("/repo/openclaw", "dist", "index.js"));
  });

  it("resolves Windows service entrypoints with Windows path semantics", () => {
    expect(
      resolveGatewayServiceEntrypoint({
        programArguments: ["node.exe", "dist\\index.js", "gateway", "run"],
        workingDirectory: "C:\\openclaw",
      }),
    ).toBe("C:\\openclaw\\dist\\index.js");
  });

  it("rejects a relative entrypoint without an absolute service working directory", () => {
    expect(
      resolveGatewayServiceEntrypoint({
        programArguments: ["node", "dist/index.js", "gateway", "run"],
      }),
    ).toBeUndefined();
    expect(
      resolveGatewayServiceEntrypoint({
        programArguments: ["node", "dist/index.js", "gateway", "run"],
        workingDirectory: "./checkout",
      }),
    ).toBeUndefined();
  });

  it("recognizes the Genie package root", async () => {
    await withTempDir({ prefix: "genie-service-layout-" }, async (packageRoot) => {
      const entrypoint = path.join(packageRoot, "dist", "index.js");
      await fs.mkdir(path.dirname(entrypoint), { recursive: true });
      await fs.writeFile(
        path.join(packageRoot, "package.json"),
        JSON.stringify({ name: "@bitplanet/genie-openclaw", version: "1.0.0" }),
      );
      await fs.writeFile(entrypoint, "export {};\n");

      const layout = await summarizeGatewayServiceLayout({
        programArguments: ["node", entrypoint, "gateway", "run"],
      });

      expect(layout?.packageRoot).toBe(packageRoot);
      expect(layout?.packageVersion).toBe("1.0.0");
    });
  });
});
