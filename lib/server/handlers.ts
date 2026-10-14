import { timingSafeEqual } from "node:crypto";
import { Code, ConnectError, type HandlerContext } from "@connectrpc/connect";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { z } from "zod";
import {
  type AuctionEventSchema,
  LotStatus,
  type LotSchema,
  Role,
  type CloseLotRequest,
  type CreateAuctionRequest,
  type GetAuctionStateRequest,
  type LoginRequest,
  type OpenLotRequest,
  type PlaceBidRequest,
  type WatchAuctionRequest,
} from "@/gen/remateya/v1/auction_pb";
import { requireRole, signToken } from "@/lib/server/auth";
import { auctionService, type StoredEvent } from "@/lib/server/auction-service";
import {
  loginInputSchema,
  openLotInputSchema,
  placeBidInputSchema,
  type LotSnapshot,
} from "@/lib/server/schemas";

type LotInit = MessageInitShape<typeof LotSchema>;
type EventInit = MessageInitShape<typeof AuctionEventSchema>;

export const STREAM_LIFETIME_MS = 50_000;
const POLL_INTERVAL_MS = 500;
const TICK_INTERVAL_MS = 1_000;

function parseOrThrow<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new ConnectError(detail, Code.InvalidArgument);
  }
  return result.data;
}

function lotToProto(lot: LotSnapshot): LotInit {
  return {
    id: lot.id,
    auctionId: lot.auctionId,
    animalType: lot.animalType,
    breed: lot.breed,
    weightKg: lot.weightKg,
    ageMonths: lot.ageMonths,
    basePrice: lot.basePrice,
    minIncrement: lot.minIncrement,
    status:
      lot.status === "ACTIVE" ? LotStatus.ACTIVE : LotStatus.CLOSED,
    highestBid: lot.highestBid ?? 0,
    highestBidder: lot.highestBidder ?? "",
    closesAtMs: BigInt(lot.closesAtMs),
    winner: lot.winner ?? "",
    finalPrice: lot.finalPrice ?? 0,
  };
}

function eventToProto(stored: StoredEvent): EventInit {
  const base = {
    sequence: BigInt(stored.sequence),
    serverTimeMs: BigInt(Date.now()),
  };
  const payload = stored.payload;
  switch (payload.type) {
    case "LOT_OPENED":
      return {
        ...base,
        event: { case: "lotOpened", value: { lot: lotToProto(payload.lot) } },
      };
    case "BID_ACCEPTED":
      return {
        ...base,
        event: {
          case: "bidAccepted",
          value: {
            lotId: payload.lotId,
            bidder: payload.bidder,
            amount: payload.amount,
          },
        },
      };
    case "BID_REJECTED":
      return {
        ...base,
        event: {
          case: "bidRejected",
          value: {
            lotId: payload.lotId,
            bidder: payload.bidder,
            amount: payload.amount,
            reason: payload.reason,
          },
        },
      };
    case "TIME_EXTENDED":
      return {
        ...base,
        event: {
          case: "timeExtended",
          value: {
            lotId: payload.lotId,
            newClosesAtMs: BigInt(payload.newClosesAtMs),
          },
        },
      };
    case "LOT_CLOSED":
      return {
        ...base,
        event: { case: "lotClosed", value: { lot: lotToProto(payload.lot) } },
      };
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

function pinMatches(candidate: string): boolean {
  const expected = process.env.AUCTIONEER_PIN;
  if (!expected) {
    throw new ConnectError("Server misconfigured", Code.Internal);
  }
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const auctionHandlers = {
  async login(req: LoginRequest) {
    const input = parseOrThrow(loginInputSchema, {
      displayName: req.displayName,
      pin: req.pin,
    });
    if (req.role === Role.AUCTIONEER) {
      if (!pinMatches(input.pin)) {
        throw new ConnectError("Invalid PIN", Code.Unauthenticated);
      }
      const token = await signToken({
        sub: input.displayName,
        role: "AUCTIONEER",
      });
      return { token, role: Role.AUCTIONEER, displayName: input.displayName };
    }
    if (req.role === Role.BIDDER) {
      const token = await signToken({ sub: input.displayName, role: "BIDDER" });
      return { token, role: Role.BIDDER, displayName: input.displayName };
    }
    throw new ConnectError("Role is required", Code.InvalidArgument);
  },

  async createAuction(req: CreateAuctionRequest, ctx: HandlerContext) {
    await requireRole(ctx.requestHeader, [Role.AUCTIONEER]);
    const name = parseOrThrow(z.string().trim().min(2).max(80), req.name);
    return { auctionId: await auctionService.createAuction(name) };
  },

  async openLot(req: OpenLotRequest, ctx: HandlerContext) {
    await requireRole(ctx.requestHeader, [Role.AUCTIONEER]);
    const input = parseOrThrow(openLotInputSchema, req);
    return { lot: lotToProto(await auctionService.openLot(input)) };
  },

  async placeBid(req: PlaceBidRequest, ctx: HandlerContext) {
    const claims = await requireRole(ctx.requestHeader, [Role.BIDDER]);
    const input = parseOrThrow(placeBidInputSchema, req);
    const result = await auctionService.placeBid({
      ...input,
      bidder: claims.sub,
    });
    return {
      lot: lotToProto(result.lot),
      sequence: BigInt(result.sequence),
    };
  },

  async closeLot(req: CloseLotRequest, ctx: HandlerContext) {
    await requireRole(ctx.requestHeader, [Role.AUCTIONEER]);
    const input = parseOrThrow(
      z.object({ auctionId: z.string().uuid(), lotId: z.string().uuid() }),
      req,
    );
    return {
      lot: lotToProto(await auctionService.closeLot(input.auctionId, input.lotId)),
    };
  },

  async getAuctionState(req: GetAuctionStateRequest) {
    const auctionId = parseOrThrow(z.string().uuid(), req.auctionId);
    const state = await auctionService.getState(auctionId);
    return {
      auctionId,
      name: state.name,
      activeLot: state.activeLot ? lotToProto(state.activeLot) : undefined,
      closedLots: state.closedLots.map(lotToProto),
      lastSequence: BigInt(state.lastSequence),
      serverTimeMs: BigInt(Date.now()),
    };
  },

  async *watchAuction(
    req: WatchAuctionRequest,
    ctx: HandlerContext,
  ): AsyncGenerator<EventInit> {
    const auctionId = parseOrThrow(z.string().uuid(), req.auctionId);
    if (!(await auctionService.auctionExists(auctionId))) {
      throw new ConnectError("Auction not found", Code.NotFound);
    }
    let lastSeen = Number(req.lastSeenSequence);
    const deadline = Date.now() + STREAM_LIFETIME_MS;
    let lastTick = 0;

    // Close before the platform limit so the client reconnects cleanly.
    while (Date.now() < deadline && !ctx.signal.aborted) {
      await auctionService.settleExpired(auctionId);

      for (const stored of await auctionService.eventsAfter(auctionId, lastSeen)) {
        lastSeen = stored.sequence;
        yield eventToProto(stored);
      }

      const now = Date.now();
      if (now - lastTick >= TICK_INTERVAL_MS) {
        lastTick = now;
        const lot = await auctionService.activeLot(auctionId);
        if (lot) {
          yield {
            sequence: 0n,
            serverTimeMs: BigInt(now),
            event: {
              case: "timerTick",
              value: {
                lotId: lot.id,
                closesAtMs: BigInt(lot.closesAtMs),
                remainingMs: BigInt(Math.max(0, lot.closesAtMs - now)),
              },
            },
          };
        }
      }
      await sleep(POLL_INTERVAL_MS, ctx.signal);
    }
  },
};
