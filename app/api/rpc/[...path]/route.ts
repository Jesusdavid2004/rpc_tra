import {
  createConnectRouter,
  type ConnectRouter,
} from "@connectrpc/connect";
import {
  universalServerRequestFromFetch,
  universalServerResponseToFetch,
} from "@connectrpc/connect/protocol";
import { AuctionService } from "@/gen/remateya/v1/auction_pb";
import { auctionHandlers } from "@/lib/server/handlers";

export const maxDuration = 60;

const BASE_PATH = "/api/rpc";

// AuctionChannel (bidirectional) is intentionally not implemented here.
function registerRoutes(router: ConnectRouter): void {
  router.service(AuctionService, {
    login: auctionHandlers.login,
    createAuction: auctionHandlers.createAuction,
    openLot: auctionHandlers.openLot,
    placeBid: auctionHandlers.placeBid,
    closeLot: auctionHandlers.closeLot,
    getAuctionState: auctionHandlers.getAuctionState,
    watchAuction: auctionHandlers.watchAuction,
  });
}

const router = createConnectRouter();
registerRoutes(router);
const handlersByPath = new Map(
  router.handlers.map((handler) => [handler.requestPath, handler]),
);

async function handle(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname.slice(BASE_PATH.length);
  const handler = handlersByPath.get(path);
  if (!handler) return new Response("Not found", { status: 404 });
  const response = await handler(
    universalServerRequestFromFetch(request, {}),
  );
  return universalServerResponseToFetch(response);
}

export { handle as POST };
