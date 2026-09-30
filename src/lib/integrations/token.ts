import { createHash, randomBytes } from "node:crypto";

export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
export function newIntegrationToken(): string {
  return `od_${randomBytes(32).toString("base64url")}`;
}
/** Basic is allowed only for the ICS feed, to support HA Remote Calendar. */
export function readIntegrationToken(header: string | null, allowBasic = false): string | null {
  if (!header || header.length > 512) return null;
  const bearer = /^Bearer (od_[A-Za-z0-9_-]{43})$/i.exec(header);
  if (bearer) return bearer[1];
  if (allowBasic && /^Basic /i.test(header)) {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const colon = decoded.indexOf(":");
    if (colon >= 0 && decoded.slice(0, colon) === "our-days") {
      const token = decoded.slice(colon + 1);
      if (/^od_[A-Za-z0-9_-]{43}$/.test(token)) return token;
    }
  }
  return null;
}
