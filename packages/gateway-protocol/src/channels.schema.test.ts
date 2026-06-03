import { Compile } from "typebox/compile";
import { describe, expect, it } from "vitest";
import {
  ChannelsPairingApproveParamsSchema,
  ChannelsPairingListParamsSchema,
  ChannelsStatusResultSchema,
  WebLoginWaitParamsSchema,
} from "./schema/channels.js";

describe("WebLoginWaitParamsSchema", () => {
  const validate = Compile(WebLoginWaitParamsSchema);

  it("bounds caller-provided QR data URLs", () => {
    expect(
      validate.Check({
        currentQrDataUrl: "data:image/png;base64,qr",
      }),
    ).toBe(true);

    expect(
      validate.Check({
        currentQrDataUrl: "x".repeat(16_385),
      }),
    ).toBe(false);
    expect(
      validate.Check({
        currentQrDataUrl: "https://example.com/qr.png",
      }),
    ).toBe(false);
  });
});

describe("ChannelsStatusResultSchema", () => {
  const validate = Compile(ChannelsStatusResultSchema);

  it("accepts gateway event-loop diagnostics emitted by channels.status", () => {
    expect(
      validate.Check({
        ts: Date.now(),
        channelOrder: ["discord"],
        channelLabels: { discord: "Discord" },
        channels: { discord: { configured: true } },
        channelAccounts: {
          discord: [
            {
              accountId: "default",
              enabled: true,
              configured: true,
              running: true,
              connected: false,
              healthState: "stale-socket",
            },
          ],
        },
        channelDefaultAccountId: { discord: "default" },
        partial: true,
        warnings: ["discord:default probe timed out after 1000ms"],
        eventLoop: {
          degraded: true,
          reasons: ["event_loop_delay", "cpu"],
          intervalMs: 62_000,
          delayP99Ms: 1_250.5,
          delayMaxMs: 62_000,
          utilization: 0.98,
          cpuCoreRatio: 1.2,
        },
      }),
    ).toBe(true);
  });
});

describe("channel pairing schemas", () => {
  it("accepts list and approve params for web channel pairing", () => {
    const validateList = Compile(ChannelsPairingListParamsSchema);
    const validateApprove = Compile(ChannelsPairingApproveParamsSchema);

    expect(validateList.Check({})).toBe(true);
    expect(validateList.Check({ channel: "telegram" })).toBe(true);
    expect(validateList.Check({ channel: "" })).toBe(false);

    expect(validateApprove.Check({ channel: "telegram", code: "ABCD2345" })).toBe(true);
    expect(validateApprove.Check({ channel: "telegram", code: "ABCD2345", notify: false })).toBe(
      true,
    );
    expect(validateApprove.Check({ channel: "telegram" })).toBe(false);
  });
});
