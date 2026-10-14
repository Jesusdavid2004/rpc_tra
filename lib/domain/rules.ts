import { Code } from "@connectrpc/connect";

export const SNIPING_WINDOW_MS = 10_000;
export const SNIPING_EXTENSION_MS = 10_000;

export class DomainError extends Error {
  constructor(
    public readonly code: Code,
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export interface LotState {
  basePrice: number;
  minIncrement: number;
  highestBid: number | null;
  highestBidder: string | null;
  closesAtMs: number;
  closed: boolean;
}

export interface BidResult {
  state: LotState;
  extended: boolean;
}

export function minimumNextBid(state: LotState): number {
  return state.highestBid === null
    ? state.basePrice
    : state.highestBid + state.minIncrement;
}

export function isExpired(state: LotState, nowMs: number): boolean {
  return nowMs >= state.closesAtMs;
}

/**
 * Pure business rule: validates a bid against the current lot state and
 * returns the next state. Applying bids one after another (as the DB row
 * lock does) means two equal bids can never both win.
 */
export function applyBid(
  state: LotState,
  bidder: string,
  amount: number,
  nowMs: number,
): BidResult {
  if (state.closed || isExpired(state, nowMs)) {
    throw new DomainError(Code.FailedPrecondition, "Lot is closed");
  }
  const minimum = minimumNextBid(state);
  if (amount < minimum) {
    throw new DomainError(
      Code.FailedPrecondition,
      `Bid must be at least ${minimum}`,
    );
  }
  const extended = state.closesAtMs - nowMs <= SNIPING_WINDOW_MS;
  return {
    extended,
    state: {
      ...state,
      highestBid: amount,
      highestBidder: bidder,
      closesAtMs: extended
        ? state.closesAtMs + SNIPING_EXTENSION_MS
        : state.closesAtMs,
    },
  };
}
