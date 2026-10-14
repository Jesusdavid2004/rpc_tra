import { createClient, type Interceptor } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { z } from "zod";
import { AuctionService } from "@/gen/remateya/v1/auction_pb";

const SESSION_KEY = "remateya.session";

const sessionSchema = z.object({
  token: z.string(),
  role: z.enum(["AUCTIONEER", "BIDDER"]),
  displayName: z.string(),
});

export type Session = z.infer<typeof sessionSchema>;

export function loadSession(): Session | null {
  const raw = window.localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return sessionSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveSession(session: Session | null): void {
  if (session) {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } else {
    window.localStorage.removeItem(SESSION_KEY);
  }
}

const authInterceptor: Interceptor = (next) => async (req) => {
  const session = loadSession();
  if (session) req.header.set("Authorization", `Bearer ${session.token}`);
  return next(req);
};

const transport = createConnectTransport({
  baseUrl: "/api/rpc",
  useBinaryFormat: true, // Protobuf on the wire instead of JSON
  interceptors: [authInterceptor],
});

export const auctionClient = createClient(AuctionService, transport);
