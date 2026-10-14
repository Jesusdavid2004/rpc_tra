import { Code, ConnectError } from "@connectrpc/connect";
import { Prisma, type Lot as LotRow } from "@prisma/client";
import { applyBid, DomainError, type LotState } from "@/lib/domain/rules";
import { prisma } from "@/lib/server/db";
import {
  eventPayloadSchema,
  type EventPayload,
  type LotSnapshot,
} from "@/lib/server/schemas";

type Tx = Prisma.TransactionClient;

export interface OpenLotCommand {
  auctionId: string;
  animalType: string;
  breed: string;
  weightKg: number;
  ageMonths: number;
  basePrice: number;
  minIncrement: number;
  durationSeconds: number;
}

export interface PlaceBidCommand {
  auctionId: string;
  lotId: string;
  bidder: string;
  amount: number;
  idempotencyKey: string;
}

export interface StoredEvent {
  sequence: number;
  payload: EventPayload;
}

export function toSnapshot(row: LotRow): LotSnapshot {
  return {
    id: row.id,
    auctionId: row.auctionId,
    animalType: row.animalType,
    breed: row.breed,
    weightKg: row.weightKg,
    ageMonths: row.ageMonths,
    basePrice: row.basePrice,
    minIncrement: row.minIncrement,
    status: row.status,
    highestBid: row.highestBid,
    highestBidder: row.highestBidder,
    closesAtMs: row.closesAt.getTime(),
    winner: row.winner,
    finalPrice: row.finalPrice,
  };
}

function toLotState(row: LotRow): LotState {
  return {
    basePrice: row.basePrice,
    minIncrement: row.minIncrement,
    highestBid: row.highestBid,
    highestBidder: row.highestBidder,
    closesAtMs: row.closesAt.getTime(),
    closed: row.status === "CLOSED",
  };
}

/**
 * Allocates the next event sequence. The UPDATE keeps a row lock on the
 * auction until commit, so sequences are committed in order and a reader
 * polling "sequence > last_seen" can never skip an event.
 */
async function appendEvent(
  tx: Tx,
  auctionId: string,
  payload: EventPayload,
): Promise<number> {
  const { lastSequence } = await tx.auction.update({
    where: { id: auctionId },
    data: { lastSequence: { increment: 1 } },
    select: { lastSequence: true },
  });
  await tx.event.create({
    data: {
      auctionId,
      sequence: lastSequence,
      type: payload.type,
      payload,
    },
  });
  return lastSequence;
}

async function lockLot(tx: Tx, lotId: string): Promise<LotRow | null> {
  await tx.$queryRaw`SELECT id FROM lots WHERE id = ${lotId} FOR UPDATE`;
  return tx.lot.findUnique({ where: { id: lotId } });
}

async function closeLot(tx: Tx, lot: LotRow): Promise<LotRow> {
  const closed = await tx.lot.update({
    where: { id: lot.id },
    data: {
      status: "CLOSED",
      winner: lot.highestBidder,
      finalPrice: lot.highestBid,
    },
  });
  await appendEvent(tx, lot.auctionId, {
    type: "LOT_CLOSED",
    lot: toSnapshot(closed),
  });
  return closed;
}

function translateDatabaseError(error: unknown): never {
  if (error instanceof ConnectError || error instanceof DomainError) {
    throw error instanceof DomainError
      ? new ConnectError(error.message, error.code)
      : error;
  }
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2034" || error.code === "P2002")
  ) {
    throw new ConnectError("Concurrent update, retry", Code.Aborted);
  }
  throw error;
}

export class AuctionService {
  async createAuction(name: string): Promise<string> {
    const auction = await prisma.auction.create({ data: { name } });
    return auction.id;
  }

  async openLot(command: OpenLotCommand): Promise<LotSnapshot> {
    try {
      return await prisma.$transaction(async (tx) => {
        // Touching the auction row first serializes lot/event operations.
        const locked = await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM auctions WHERE id = ${command.auctionId} FOR UPDATE`;
        if (locked.length === 0) {
          throw new ConnectError("Auction not found", Code.NotFound);
        }

        const active = await tx.lot.findFirst({
          where: { auctionId: command.auctionId, status: "ACTIVE" },
        });
        if (active) {
          throw new ConnectError(
            "Auction already has an active lot",
            Code.FailedPrecondition,
          );
        }
        const lot = await tx.lot.create({
          data: {
            auctionId: command.auctionId,
            animalType: command.animalType,
            breed: command.breed,
            weightKg: command.weightKg,
            ageMonths: command.ageMonths,
            basePrice: command.basePrice,
            minIncrement: command.minIncrement,
            closesAt: new Date(Date.now() + command.durationSeconds * 1000),
          },
        });
        const snapshot = toSnapshot(lot);
        await appendEvent(tx, command.auctionId, {
          type: "LOT_OPENED",
          lot: snapshot,
        });
        return snapshot;
      });
    } catch (error) {
      return translateDatabaseError(error);
    }
  }

  async placeBid(
    command: PlaceBidCommand,
  ): Promise<{ lot: LotSnapshot; sequence: number }> {
    type Outcome =
      | { kind: "ok"; lot: LotSnapshot; sequence: number }
      | { kind: "rejected"; lot: LotSnapshot; message: string; code: Code };

    let outcome: Outcome;
    try {
      outcome = await prisma.$transaction(async (tx): Promise<Outcome> => {
        const lot = await lockLot(tx, command.lotId);
        if (!lot || lot.auctionId !== command.auctionId) {
          throw new ConnectError("Lot not found", Code.NotFound);
        }

        const duplicate = await tx.bid.findUnique({
          where: {
            lotId_idempotencyKey: {
              lotId: lot.id,
              idempotencyKey: command.idempotencyKey,
            },
          },
        });
        if (duplicate) {
          const auction = await tx.auction.findUniqueOrThrow({
            where: { id: lot.auctionId },
          });
          return {
            kind: "ok",
            lot: toSnapshot(lot),
            sequence: auction.lastSequence,
          };
        }

        const nowMs = Date.now();
        if (lot.status === "ACTIVE" && nowMs >= lot.closesAt.getTime()) {
          const closed = await closeLot(tx, lot);
          return {
            kind: "rejected",
            lot: toSnapshot(closed),
            message: "Lot is closed",
            code: Code.FailedPrecondition,
          };
        }

        let result;
        try {
          result = applyBid(toLotState(lot), command.bidder, command.amount, nowMs);
        } catch (error) {
          if (error instanceof DomainError) {
            return {
              kind: "rejected",
              lot: toSnapshot(lot),
              message: error.message,
              code: error.code,
            };
          }
          throw error;
        }

        await tx.bid.create({
          data: {
            lotId: lot.id,
            bidder: command.bidder,
            amount: command.amount,
            idempotencyKey: command.idempotencyKey,
          },
        });
        const updated = await tx.lot.update({
          where: { id: lot.id },
          data: {
            highestBid: result.state.highestBid,
            highestBidder: result.state.highestBidder,
            closesAt: new Date(result.state.closesAtMs),
          },
        });
        let sequence = await appendEvent(tx, lot.auctionId, {
          type: "BID_ACCEPTED",
          lotId: lot.id,
          bidder: command.bidder,
          amount: command.amount,
        });
        if (result.extended) {
          sequence = await appendEvent(tx, lot.auctionId, {
            type: "TIME_EXTENDED",
            lotId: lot.id,
            newClosesAtMs: result.state.closesAtMs,
          });
        }
        return { kind: "ok", lot: toSnapshot(updated), sequence };
      });
    } catch (error) {
      return translateDatabaseError(error);
    }

    if (outcome.kind === "rejected") {
      await this.recordRejection(command, outcome.message);
      throw new ConnectError(outcome.message, outcome.code);
    }
    return { lot: outcome.lot, sequence: outcome.sequence };
  }

  async closeLot(auctionId: string, lotId: string): Promise<LotSnapshot> {
    try {
      return await prisma.$transaction(async (tx) => {
        const lot = await lockLot(tx, lotId);
        if (!lot || lot.auctionId !== auctionId) {
          throw new ConnectError("Lot not found", Code.NotFound);
        }
        if (lot.status === "CLOSED") {
          throw new ConnectError("Lot already closed", Code.FailedPrecondition);
        }
        return toSnapshot(await closeLot(tx, lot));
      });
    } catch (error) {
      return translateDatabaseError(error);
    }
  }

  /** Lazily closes the active lot once the server clock passes closesAt. */
  async settleExpired(auctionId: string): Promise<void> {
    const candidate = await prisma.lot.findFirst({
      where: { auctionId, status: "ACTIVE", closesAt: { lte: new Date() } },
      select: { id: true },
    });
    if (!candidate) return;
    await prisma.$transaction(async (tx) => {
      const lot = await lockLot(tx, candidate.id);
      if (lot && lot.status === "ACTIVE" && lot.closesAt.getTime() <= Date.now()) {
        await closeLot(tx, lot);
      }
    });
  }

  async getState(auctionId: string) {
    await this.settleExpired(auctionId);
    const auction = await prisma.auction.findUnique({
      where: { id: auctionId },
      include: {
        lots: { orderBy: { createdAt: "desc" }, take: 20 },
      },
    });
    if (!auction) throw new ConnectError("Auction not found", Code.NotFound);
    const active = auction.lots.find((lot) => lot.status === "ACTIVE");
    return {
      name: auction.name,
      activeLot: active ? toSnapshot(active) : null,
      closedLots: auction.lots
        .filter((lot) => lot.status === "CLOSED")
        .map(toSnapshot),
      lastSequence: auction.lastSequence,
    };
  }

  async activeLot(auctionId: string): Promise<LotSnapshot | null> {
    const lot = await prisma.lot.findFirst({
      where: { auctionId, status: "ACTIVE" },
    });
    return lot ? toSnapshot(lot) : null;
  }

  async eventsAfter(
    auctionId: string,
    lastSeenSequence: number,
  ): Promise<StoredEvent[]> {
    const rows = await prisma.event.findMany({
      where: { auctionId, sequence: { gt: lastSeenSequence } },
      orderBy: { sequence: "asc" },
      take: 100,
    });
    return rows.map((row) => ({
      sequence: row.sequence,
      payload: eventPayloadSchema.parse(row.payload),
    }));
  }

  async auctionExists(auctionId: string): Promise<boolean> {
    const count = await prisma.auction.count({ where: { id: auctionId } });
    return count > 0;
  }

  private async recordRejection(
    command: PlaceBidCommand,
    reason: string,
  ): Promise<void> {
    await prisma.$transaction((tx) =>
      appendEvent(tx, command.auctionId, {
        type: "BID_REJECTED",
        lotId: command.lotId,
        bidder: command.bidder,
        amount: command.amount,
        reason,
      }),
    );
  }
}

export const auctionService = new AuctionService();
