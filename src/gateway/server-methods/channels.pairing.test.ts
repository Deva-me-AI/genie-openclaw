import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayRequestHandlerOptions } from "./types.js";

const hoisted = vi.hoisted(() => ({
  listPairingChannels: vi.fn(),
  notifyPairingApproved: vi.fn(),
  listChannelPairingRequests: vi.fn(),
  approveChannelPairingCode: vi.fn(),
}));

vi.mock("../../channels/plugins/pairing.js", () => ({
  listPairingChannels: hoisted.listPairingChannels,
  notifyPairingApproved: hoisted.notifyPairingApproved,
}));

vi.mock("../../pairing/pairing-store.js", () => ({
  listChannelPairingRequests: hoisted.listChannelPairingRequests,
  approveChannelPairingCode: hoisted.approveChannelPairingCode,
}));

const { channelsHandlers } = await import("./channels.js");

type TestHandlerOptions = GatewayRequestHandlerOptions & {
  respond: ReturnType<typeof vi.fn>;
  context: GatewayRequestHandlerOptions["context"] & {
    broadcast: ReturnType<typeof vi.fn>;
  };
};

function createOptions(method: string, params: Record<string, unknown>): TestHandlerOptions {
  const respond = vi.fn();
  const broadcast = vi.fn();
  return {
    params,
    respond,
    context: {
      getRuntimeConfig: () => ({}),
      broadcast,
    },
    req: { type: "req", id: "req-1", method, params },
    client: null,
    isWebchatConnect: () => false,
  } as unknown as TestHandlerOptions;
}

describe("channels pairing handlers", () => {
  beforeEach(() => {
    hoisted.listPairingChannels.mockReset();
    hoisted.notifyPairingApproved.mockReset();
    hoisted.listChannelPairingRequests.mockReset();
    hoisted.approveChannelPairingCode.mockReset();
  });

  it("lists pending pairing requests for pairing-capable channels", async () => {
    hoisted.listPairingChannels.mockReturnValue(["telegram", "discord"]);
    hoisted.listChannelPairingRequests.mockImplementation(async (channel: string) => [
      { id: `${channel}-sender`, code: "ABCD2345", createdAt: "2026-06-02T00:00:00.000Z" },
    ]);
    const opts = createOptions("channels.pairing.list", {});

    await channelsHandlers["channels.pairing.list"]?.(opts);

    expect(hoisted.listChannelPairingRequests).toHaveBeenCalledWith("telegram");
    expect(hoisted.listChannelPairingRequests).toHaveBeenCalledWith("discord");
    expect(opts.respond).toHaveBeenCalledWith(
      true,
      {
        channels: {
          telegram: [
            {
              id: "telegram-sender",
              code: "ABCD2345",
              createdAt: "2026-06-02T00:00:00.000Z",
            },
          ],
          discord: [
            {
              id: "discord-sender",
              code: "ABCD2345",
              createdAt: "2026-06-02T00:00:00.000Z",
            },
          ],
        },
      },
      undefined,
    );
  });

  it("approves a pairing code, notifies the requester, and broadcasts approval", async () => {
    hoisted.approveChannelPairingCode.mockResolvedValue({ id: "sender-1" });
    const opts = createOptions("channels.pairing.approve", {
      channel: "telegram",
      code: "ABCD2345",
    });

    await channelsHandlers["channels.pairing.approve"]?.(opts);

    expect(hoisted.approveChannelPairingCode).toHaveBeenCalledWith({
      channel: "telegram",
      code: "ABCD2345",
    });
    expect(hoisted.notifyPairingApproved).toHaveBeenCalledWith({
      channelId: "telegram",
      id: "sender-1",
      cfg: {},
      runtime: expect.any(Object),
    });
    expect(opts.context.broadcast).toHaveBeenCalledWith("channels.pairing.approved", {
      channel: "telegram",
      code: "ABCD2345",
      ts: expect.any(Number),
    });
    expect(opts.respond).toHaveBeenCalledWith(true, { id: "sender-1" }, undefined);
  });
});
