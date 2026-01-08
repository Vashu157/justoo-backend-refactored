
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { and, eq, gt } from "drizzle-orm";

import { db } from "../db/index.js";
import { riders, riderSessions } from "../db/schema.js";
import { env } from "../config/env.js";

function requireJwtSecret() {
    const secret = env.RIDER_JWT_SECRET || "dev-rider-jwt-secret";
    const isProd = env.NODE_ENV === "production";
    if (isProd && secret === "dev-rider-jwt-secret") {
        throw new Error("RIDER_JWT_SECRET is required in production");
    }
    return secret;
}

export function extractBearerToken(req) {
    const header = String(req.headers?.authorization || "");
    const [scheme, token] = header.split(" ");
    if (scheme !== "Bearer" || !token) return null;
    return token;
}

export function replyRiderAuthError(res, error) {
    const status = error === "RIDER_NOT_FOUND" ? 404 : 401;
    return res.status(status).json({ error });
}

function tokenToHash(token) {
    return crypto.createHash("sha256").update(String(token)).digest("hex");
}

/**
 * Ensures `req.rider` is set.
 * Returns `{ rider }` on success, or `{ error }` on failure.
 */
export async function ensureRider(req) {
    if (req.rider?.id) return { rider: req.rider };

    const token = extractBearerToken(req);
    if (!token) return { error: "TOKEN_REQUIRED" };

    const secret = requireJwtSecret();
    let payload;
    try {
        payload = jwt.verify(token, secret);
    } catch {
        return { error: "TOKEN_INVALID" };
    }

    if (payload?.typ !== "rider") return { error: "TOKEN_INVALID" };

    const riderId = payload?.sub;
    if (!riderId) return { error: "TOKEN_INVALID" };

    const tokenHash = tokenToHash(token);
    const now = new Date();

    const sessionRows = await db
        .select({
            sessionRiderId: riderSessions.riderId,
            sessionExpiresAt: riderSessions.expiresAt,

            id: riders.id,
            name: riders.name,
            phone: riders.phone,
            username: riders.username,
            isActive: riders.isActive,
            createdAt: riders.createdAt,
        })
        .from(riderSessions)
        .innerJoin(riders, eq(riders.id, riderSessions.riderId))
        .where(and(eq(riderSessions.tokenHash, tokenHash), gt(riderSessions.expiresAt, now)))
        .limit(1);

    const row = sessionRows[0];
    if (!row) return { error: "TOKEN_REVOKED" };
    if (row.sessionRiderId !== String(riderId)) return { error: "TOKEN_INVALID" };

    const rider = {
        id: row.id,
        name: row.name,
        phone: row.phone,
        username: row.username,
        isActive: row.isActive,
        createdAt: row.createdAt,
    };

    req.rider = rider;
    req.riderTokenPayload = payload;

    return { rider };
}

/**
 * Optional loader: attaches `req.rider` if a valid token is present.
 * Does not block unauthenticated requests.
 */
export async function loadRider(req, res, next) {
    try {
        const token = extractBearerToken(req);
        if (!token) return next();

        const result = await ensureRider(req);
        if (result.error) {
            req.riderAuthError = result.error;
        }

        return next();
    } catch (err) {
        next(err);
    }
}

/**
 * Required auth: blocks unless a valid rider token is present.
 */
export async function requireRiderAuth(req, res, next) {
    try {
        const result = await ensureRider(req);
        if (result.error) return replyRiderAuthError(res, result.error);
        return next();
    } catch (err) {
        next(err);
    }
}

