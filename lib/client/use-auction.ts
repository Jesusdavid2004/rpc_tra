"use client";

import { useEffect, useRef, useState } from "react";
import type { AuctionEvent, Lot } from "@/gen/remateya/v1/auction_pb";
import { LotStatus } from "@/gen/remateya/v1/auction_pb";
import { auctionClient } from "@/lib/client/rpc";

export type ConnectionStatus = "connecting" | "live" | "reconnecting";

const MAX_HISTORY = 50;
const RECONNECT_DELAY_MS = 1000;

export interface AuctionView {
  name: string;
  activeLot: Lot | null;
  closedLots: Lot[];
  history: AuctionEvent[];
  connection: ConnectionStatus;
  serverOffsetMs: number;
  error: string | null;
}

const EMPTY: AuctionView = {
  name: "",
  activeLot: null,
  closedLots: [],
  history: [],
  connection: "connecting",
  serverOffsetMs: 0,
  error: null,
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function reduceEvent(view: AuctionView, event: AuctionEvent): AuctionView {
  const serverOffsetMs = Number(event.serverTimeMs) - Date.now();
  const withClock = { ...view, serverOffsetMs };
  const body = event.event;

  switch (body.case) {
    case "lotOpened":
      return {
        ...withClock,
        activeLot: body.value.lot ?? null,
        history: [event, ...view.history].slice(0, MAX_HISTORY),
      };
    case "bidAccepted": {
      const lot = view.activeLot;
      const updated =
        lot && lot.id === body.value.lotId
          ? { ...lot, highestBid: body.value.amount, highestBidder: body.value.bidder }
          : lot;
      return {
        ...withClock,
        activeLot: updated,
        history: [event, ...view.history].slice(0, MAX_HISTORY),
      };
    }
    case "bidRejected":
      return {
        ...withClock,
        history: [event, ...view.history].slice(0, MAX_HISTORY),
      };
    case "timeExtended": {
      const lot = view.activeLot;
      const updated =
        lot && lot.id === body.value.lotId
          ? { ...lot, closesAtMs: body.value.newClosesAtMs }
          : lot;
      return {
        ...withClock,
        activeLot: updated,
        history: [event, ...view.history].slice(0, MAX_HISTORY),
      };
    }
    case "lotClosed": {
      const closed = body.value.lot;
      return {
        ...withClock,
        activeLot: null,
        closedLots: closed ? [closed, ...view.closedLots] : view.closedLots,
        history: [event, ...view.history].slice(0, MAX_HISTORY),
      };
    }
    case "timerTick": {
      const lot = view.activeLot;
      const updated =
        lot && lot.id === body.value.lotId
          ? { ...lot, closesAtMs: body.value.closesAtMs }
          : lot;
      return { ...withClock, activeLot: updated };
    }
    default:
      return withClock;
  }
}

/**
 * Loads the snapshot, then follows WatchAuction. When the server closes the
 * stream (maxDuration safety) or the network drops, it reconnects using the
 * last sequence it saw, so no event is lost or duplicated.
 */
export function useAuction(auctionId: string | null): AuctionView {
  const [view, setView] = useState<AuctionView>(EMPTY);
  const lastSequence = useRef(0n);

  useEffect(() => {
    if (!auctionId) return;
    const controller = new AbortController();
    setView(EMPTY);

    async function run(id: string): Promise<void> {
      try {
        const state = await auctionClient.getAuctionState(
          { auctionId: id },
          { signal: controller.signal },
        );
        lastSequence.current = state.lastSequence;
        setView((current) => ({
          ...current,
          name: state.name,
          activeLot: state.activeLot ?? null,
          closedLots: state.closedLots.filter(
            (lot) => lot.status === LotStatus.CLOSED,
          ),
          serverOffsetMs: Number(state.serverTimeMs) - Date.now(),
        }));
      } catch (error) {
        if (!controller.signal.aborted) {
          setView((current) => ({
            ...current,
            error: error instanceof Error ? error.message : String(error),
          }));
        }
        return;
      }

      while (!controller.signal.aborted) {
        try {
          setView((current) => ({ ...current, connection: "live", error: null }));
          const stream = auctionClient.watchAuction(
            { auctionId: id, lastSeenSequence: lastSequence.current },
            { signal: controller.signal },
          );
          for await (const event of stream) {
            if (event.sequence > lastSequence.current) {
              lastSequence.current = event.sequence;
            }
            setView((current) => reduceEvent(current, event));
          }
        } catch {
          // Network error or server timeout: fall through and reconnect.
        }
        if (controller.signal.aborted) return;
        setView((current) => ({ ...current, connection: "reconnecting" }));
        await delay(RECONNECT_DELAY_MS);
      }
    }

    void run(auctionId);
    return () => controller.abort();
  }, [auctionId]);

  return view;
}
