import { z } from "zod";

export const lotSnapshotSchema = z.object({
  id: z.string(),
  auctionId: z.string(),
  animalType: z.string(),
  breed: z.string(),
  weightKg: z.number().int(),
  ageMonths: z.number().int(),
  basePrice: z.number().int(),
  minIncrement: z.number().int(),
  status: z.enum(["ACTIVE", "CLOSED"]),
  highestBid: z.number().int().nullable(),
  highestBidder: z.string().nullable(),
  closesAtMs: z.number(),
  winner: z.string().nullable(),
  finalPrice: z.number().int().nullable(),
});

export type LotSnapshot = z.infer<typeof lotSnapshotSchema>;

// Shape of the JSON stored in events.payload (validated when read back).
export const eventPayloadSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("LOT_OPENED"), lot: lotSnapshotSchema }),
  z.object({
    type: z.literal("BID_ACCEPTED"),
    lotId: z.string(),
    bidder: z.string(),
    amount: z.number().int(),
  }),
  z.object({
    type: z.literal("BID_REJECTED"),
    lotId: z.string(),
    bidder: z.string(),
    amount: z.number().int(),
    reason: z.string(),
  }),
  z.object({
    type: z.literal("TIME_EXTENDED"),
    lotId: z.string(),
    newClosesAtMs: z.number(),
  }),
  z.object({ type: z.literal("LOT_CLOSED"), lot: lotSnapshotSchema }),
]);

export type EventPayload = z.infer<typeof eventPayloadSchema>;

export const openLotInputSchema = z.object({
  auctionId: z.string().uuid(),
  animalType: z.string().trim().min(1).max(40),
  breed: z.string().trim().min(1).max(60),
  weightKg: z.number().int().min(1).max(3000),
  ageMonths: z.number().int().min(0).max(600),
  basePrice: z.number().int().min(1),
  minIncrement: z.number().int().min(1),
  durationSeconds: z.number().int().min(15).max(3600),
});

export const placeBidInputSchema = z.object({
  auctionId: z.string().uuid(),
  lotId: z.string().uuid(),
  amount: z.number().int().min(1),
  idempotencyKey: z.string().min(8).max(100),
});

export const loginInputSchema = z.object({
  displayName: z.string().trim().min(2).max(30),
  pin: z.string().max(100),
});
