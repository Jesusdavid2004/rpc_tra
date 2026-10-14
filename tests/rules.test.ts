import { describe, expect, it } from "vitest";
import { Code } from "@connectrpc/connect";
import { applyBid, DomainError, type LotState } from "@/lib/domain/rules";

const NOW = 1_000_000;

function lot(overrides: Partial<LotState> = {}): LotState {
  return {
    basePrice: 1000,
    minIncrement: 100,
    highestBid: null,
    highestBidder: null,
    closesAtMs: NOW + 60_000,
    closed: false,
    ...overrides,
  };
}

function codeOf(fn: () => unknown): Code | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof DomainError) return error.code;
    throw error;
  }
  return undefined;
}

describe("auction rules", () => {
  it("accepts the base price as the first bid", () => {
    expect(applyBid(lot(), "ana", 1000, NOW).state.highestBid).toBe(1000);
  });

  it("rejects a bid below the minimum increment", () => {
    const state = lot({ highestBid: 1000, highestBidder: "ana" });
    expect(codeOf(() => applyBid(state, "bob", 1050, NOW))).toBe(
      Code.FailedPrecondition,
    );
    expect(applyBid(state, "bob", 1100, NOW).state.highestBidder).toBe("bob");
  });

  it("extends the close time by 10s when bidding in the last 10s", () => {
    const state = lot({ closesAtMs: NOW + 5_000 });
    const result = applyBid(state, "ana", 1000, NOW);
    expect(result.extended).toBe(true);
    expect(result.state.closesAtMs).toBe(NOW + 15_000);
  });

  it("does not extend the close time outside the sniping window", () => {
    const result = applyBid(lot(), "ana", 1000, NOW);
    expect(result.extended).toBe(false);
    expect(result.state.closesAtMs).toBe(NOW + 60_000);
  });

  it("serializes equal concurrent bids: only the first wins", () => {
    const first = applyBid(lot(), "ana", 1000, NOW).state;
    expect(codeOf(() => applyBid(first, "bob", 1000, NOW))).toBe(
      Code.FailedPrecondition,
    );
  });
});
