import { Code, ConnectError } from "@connectrpc/connect";
import { jwtVerify, SignJWT } from "jose";
import { z } from "zod";
import { Role } from "@/gen/remateya/v1/auction_pb";

const claimsSchema = z.object({
  sub: z.string().min(1),
  role: z.enum(["AUCTIONEER", "BIDDER"]),
});

export type Claims = z.infer<typeof claimsSchema>;

function secretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 16) {
    throw new ConnectError("Server misconfigured", Code.Internal);
  }
  return new TextEncoder().encode(secret);
}

export async function signToken(claims: Claims): Promise<string> {
  return new SignJWT({ role: claims.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setExpirationTime("12h")
    .sign(secretKey());
}

export async function requireRole(
  headers: Headers,
  allowed: Role[],
): Promise<Claims> {
  const header = headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    throw new ConnectError("Missing token", Code.Unauthenticated);
  }
  let claims: Claims;
  try {
    const { payload } = await jwtVerify(header.slice(7), secretKey());
    claims = claimsSchema.parse(payload);
  } catch (error) {
    if (error instanceof ConnectError) throw error;
    throw new ConnectError("Invalid token", Code.Unauthenticated);
  }
  const role = claims.role === "AUCTIONEER" ? Role.AUCTIONEER : Role.BIDDER;
  if (!allowed.includes(role)) {
    throw new ConnectError("Insufficient role", Code.PermissionDenied);
  }
  return claims;
}
