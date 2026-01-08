
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { and, eq, gt } from "drizzle-orm";

import { db } from "../db/index.js";
import { customerSessions, customers } from "../db/schema.js";
import { env } from "../config/env.js";

function requireJwtSecret() {
    const secret = env.CUSTOMER_JWT_SECRET || "dev-customer-jwt-secret";
    const isProd = env.NODE_ENV === "production";
    if (isProd && secret === "dev-customer-jwt-secret") {
        throw new Error("CUSTOMER_JWT_SECRET is required in production");
    }
    return secret;
}

export function extractBearerToken(req) {
    const header = String(req.headers?.authorization || "");
    const [scheme, token] = header.split(" ");
    if (scheme !== "Bearer" || !token) return null;
    return token;
}

export function replyCustomerAuthError(res, error) {
    const status = error === "CUSTOMER_NOT_FOUND" ? 404 : 401;
    return res.status(status).json({ error });
}

function tokenToHash(token) {
    return crypto.createHash("sha256").update(String(token)).digest("hex");
}

/**
 * Ensures `req.customer` is set.
 * Returns `{ customer }` on success, or `{ error }` on failure.
 */
export async function ensureCustomer(req) {
    if (req.customer?.id) return { customer: req.customer };

    const token = extractBearerToken(req);
    if (!token) return { error: "TOKEN_REQUIRED" };

    const secret = requireJwtSecret();
    let payload;
    try {
        payload = jwt.verify(token, secret);
    } catch {
        return { error: "TOKEN_INVALID" };
    }

    if (payload?.typ !== "customer") return { error: "TOKEN_INVALID" };

    const customerId = payload?.sub;
    const phone = payload?.phone;
    if (!customerId || !phone) return { error: "TOKEN_INVALID" };

    const tokenHash = tokenToHash(token);
    const now = new Date();

    const sessionRows = await db
        .select({
            sessionCustomerId: customerSessions.customerId,
            sessionExpiresAt: customerSessions.expiresAt,

            id: customers.id,
            name: customers.name,
            phone: customers.phone,
            email: customers.email,
            createdAt: customers.createdAt,
        })
        .from(customerSessions)
        .innerJoin(customers, eq(customers.id, customerSessions.customerId))
        .where(
            and(
                eq(customerSessions.tokenHash, tokenHash),
                gt(customerSessions.expiresAt, now)
            )
        )
        .limit(1);

    const row = sessionRows[0];
    if (!row) return { error: "TOKEN_REVOKED" };

    if (row.sessionCustomerId !== String(customerId)) return { error: "TOKEN_INVALID" };
    if (row.phone !== String(phone)) return { error: "TOKEN_INVALID" };

    const customer = {
        id: row.id,
        name: row.name,
        phone: row.phone,
        email: row.email,
        createdAt: row.createdAt,
    };

    req.customer = customer;
    req.customerTokenPayload = payload;

    return { customer };
}

/**
 * Optional loader: attaches `req.customer` if a valid token is present.
 * Does not block unauthenticated requests.
 */
export async function loadCustomer(req, res, next) {
    try {
        const token = extractBearerToken(req);
        if (!token) return next();

        const result = await ensureCustomer(req);
        if (result.error) {
            req.customerAuthError = result.error;
        }

        return next();
    } catch (err) {
        next(err);
    }
}

/**
 * Required auth: blocks unless a valid customer token is present.
 */
export async function requireCustomerAuth(req, res, next) {
    try {
        const result = await ensureCustomer(req);
        if (result.error) return replyCustomerAuthError(res, result.error);
        return next();
    } catch (err) {
        next(err);
    }
}

