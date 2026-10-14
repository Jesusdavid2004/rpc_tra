import { Code, ConnectError, createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";
import { AuctionService, Role } from "../gen/remateya/v1/auction_pb";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

function clientFor(token?: string) {
  const transport = createConnectTransport({
    baseUrl: `${BASE_URL}/api/rpc`,
    httpVersion: "1.1",
    useBinaryFormat: true,
    interceptors: token
      ? [
          (next) => (req) => {
            req.header.set("Authorization", `Bearer ${token}`);
            return next(req);
          },
        ]
      : [],
  });
  return createClient(AuctionService, transport);
}

function check(label: string, condition: boolean): void {
  console.log(`${condition ? "PASS" : "FAIL"} ${label}`);
  if (!condition) process.exitCode = 1;
}

async function codeOf(promise: Promise<unknown>): Promise<Code | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    return ConnectError.from(error).code;
  }
}

async function main(): Promise<void> {
  const anonymous = clientFor();
  const pin = process.env.AUCTIONEER_PIN ?? "1234";

  const host = await anonymous.login({ role: Role.AUCTIONEER, displayName: "Host", pin });
  const ana = await anonymous.login({ role: Role.BIDDER, displayName: "Ana" });
  const bob = await anonymous.login({ role: Role.BIDDER, displayName: "Bob" });
  const auctioneer = clientFor(host.token);
  const anaClient = clientFor(ana.token);
  const bobClient = clientFor(bob.token);

  check(
    "wrong PIN -> UNAUTHENTICATED",
    (await codeOf(anonymous.login({ role: Role.AUCTIONEER, displayName: "Eve", pin: "x" }))) ===
      Code.Unauthenticated,
  );
  check(
    "no token -> UNAUTHENTICATED",
    (await codeOf(anonymous.createAuction({ name: "Nope" }))) === Code.Unauthenticated,
  );
  check(
    "bidder creating auction -> PERMISSION_DENIED",
    (await codeOf(anaClient.createAuction({ name: "Nope" }))) === Code.PermissionDenied,
  );

  const { auctionId } = await auctioneer.createAuction({ name: "Smoke test" });
  check(
    "invalid lot -> INVALID_ARGUMENT",
    (await codeOf(auctioneer.openLot({ auctionId, animalType: "", breed: "x" }))) ===
      Code.InvalidArgument,
  );

  const received: string[] = [];
  const controller = new AbortController();
  const watcher = (async () => {
    try {
      for await (const event of anonymous.watchAuction(
        { auctionId, lastSeenSequence: 0n },
        { signal: controller.signal },
      )) {
        received.push(`${event.sequence}:${event.event.case}`);
      }
    } catch {
      // aborted by the test
    }
  })();

  const { lot } = await auctioneer.openLot({
    auctionId,
    animalType: "Cattle",
    breed: "Brahman",
    weightKg: 450,
    ageMonths: 30,
    basePrice: 1000,
    minIncrement: 100,
    durationSeconds: 40,
  });
  if (!lot) throw new Error("lot missing");
  check(
    "second active lot -> FAILED_PRECONDITION",
    (await codeOf(
      auctioneer.openLot({
        auctionId,
        animalType: "Cattle",
        breed: "Gir",
        weightKg: 300,
        ageMonths: 20,
        basePrice: 500,
        minIncrement: 50,
        durationSeconds: 15,
      }),
    )) === Code.FailedPrecondition,
  );

  const bid = (amount: number, who: typeof anaClient, key: string) =>
    who.placeBid({ auctionId, lotId: lot.id, amount, idempotencyKey: key });

  await bid(1000, anaClient, "ana-first-bid");
  check(
    "below increment -> FAILED_PRECONDITION",
    (await codeOf(bid(1050, bobClient, "bob-low-bid"))) === Code.FailedPrecondition,
  );

  const racing = await Promise.all([
    codeOf(bid(1100, anaClient, "ana-race-bid")),
    codeOf(bid(1100, bobClient, "bob-race-bid")),
  ]);
  check("equal concurrent bids: exactly one wins", racing.filter((c) => c === null).length === 1);

  const replay = await bid(1000, anaClient, "ana-first-bid");
  check("idempotent replay returns OK", replay.lot?.highestBid === 1100);

  const state = await anonymous.getAuctionState({ auctionId });
  const waitMs = Number(state.activeLot?.closesAtMs ?? 0n) - Number(state.serverTimeMs) - 5000;
  await new Promise((resolve) => setTimeout(resolve, Math.max(waitMs, 0)));
  const before = (await anonymous.getAuctionState({ auctionId })).activeLot;
  await bid(1200, bobClient, "bob-snipe-bid");
  const after = (await anonymous.getAuctionState({ auctionId })).activeLot;
  check(
    "anti-sniping extends close time by 10s",
    !!before && !!after && after.closesAtMs - before.closesAtMs === 10_000n,
  );

  await new Promise((resolve) => setTimeout(resolve, 1500));
  controller.abort();
  await watcher;

  check(
    "stream delivered sequenced events",
    ["lotOpened", "bidAccepted", "timeExtended", "timerTick"].every((name) =>
      received.some((entry) => entry.endsWith(name)),
    ),
  );

  const closed = await auctioneer.closeLot({ auctionId, lotId: lot.id });
  check(
    "close stores the winner",
    closed.lot?.winner === "Bob" && closed.lot.finalPrice === 1200,
  );
  console.log("events:", received.join(" "));
}

void main();
