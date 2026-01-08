
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { and, eq } from "drizzle-orm";

import { db } from "../../db/index.js";
import {
    customerOtps,
    customerSessions,
    customers,
    phoneWhitelist,
} from "../../db/schema.js";
import { customerOtp } from "../../utils/customerOtp.js";

const OTP_TTL_MS = Number(process.env.CUSTOMER_OTP_TTL_MS || 1000 * 60 * 5);
const JWT_TTL = process.env.CUSTOMER_JWT_TTL || "7d";

function tokenToHash(token) {
    return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function otpToHash(phone, otp) {
    return crypto
        .createHash("sha256")
        .update(`${String(phone)}:${String(otp)}`)
        .digest("hex");
}

function normalizePhone(phone) {
    return String(phone || "").trim();
}

function requireJwtSecret() {
    const secret = process.env.CUSTOMER_JWT_SECRET || "dev-customer-jwt-secret";
    const isProd = process.env.NODE_ENV === "production";
    if (isProd && secret === "dev-customer-jwt-secret") {
        throw new Error("CUSTOMER_JWT_SECRET is required in production");
    }
    return secret;
}

function extractBearerToken(req) {
    const header = String(req.headers?.authorization || "");
    const [scheme, token] = header.split(" ");
    if (scheme !== "Bearer" || !token) return null;
    return token;
}

function isPhoneWhitelistedRow(row) {
    return Boolean(row?.phone);
}

export async function sendOtp(req, res, next) {
    try {
        const phone = normalizePhone(req.body?.phone);
        if (!phone) return res.status(400).json({ error: "PHONE_REQUIRED" });

        const wlRows = await db
            .select({ phone: phoneWhitelist.phone })
            .from(phoneWhitelist)
            .where(eq(phoneWhitelist.phone, phone))
            .limit(1);

        if (!isPhoneWhitelistedRow(wlRows[0])) {
            return res.status(403).json({ error: "PHONE_NOT_WHITELISTED" });
        }

        const otp = String(Math.floor(100000 + Math.random() * 900000));
        const expiresAt = new Date(Date.now() + OTP_TTL_MS);

        const otpHash = otpToHash(phone, otp);

        await db
            .insert(customerOtps)
            .values({
                phone,
                otpHash,
                expiresAt,
                used: false,
            })
            .onConflictDoUpdate({
                target: customerOtps.phone,
                set: {
                    otpHash,
                    expiresAt,
                    used: false,
                },
            });

        customerOtp(phone, otp);

        return res.json({ ok: true });
    } catch (err) {
        next(err);
    }
}

export async function verifyOtp(req, res, next) {
    try {
        const phone = normalizePhone(req.body?.phone);
        const otp = String(req.body?.otp || "").trim();

        if (!phone || !otp) {
            return res.status(400).json({ error: "PHONE_AND_OTP_REQUIRED" });
        }

        const now = new Date();
        const expectedHash = otpToHash(phone, otp);

        const result = await db.transaction(async (tx) => {
            const otpRows = await tx
                .select({
                    phone: customerOtps.phone,
                    otpHash: customerOtps.otpHash,
                    expiresAt: customerOtps.expiresAt,
                    used: customerOtps.used,
                })
                .from(customerOtps)
                .where(eq(customerOtps.phone, phone))
                .limit(1);

            const otpRow = otpRows[0];
            if (!otpRow) return { type: "otp_invalid" };
            if (otpRow.used) return { type: "otp_invalid" };
            if (otpRow.expiresAt && now > otpRow.expiresAt) {
                await tx.delete(customerOtps).where(eq(customerOtps.phone, phone));
                return { type: "otp_expired" };
            }
            if (otpRow.otpHash !== expectedHash) return { type: "otp_invalid" };

            const usedRows = await tx
                .update(customerOtps)
                .set({ used: true })
                .where(and(eq(customerOtps.phone, phone), eq(customerOtps.used, false)))
                .returning({ phone: customerOtps.phone });

            if (!usedRows[0]) return { type: "otp_invalid" };

            // Find customer by phone; create if missing.
            const customerRows = await tx
                .select({
                    id: customers.id,
                    name: customers.name,
                    phone: customers.phone,
                    email: customers.email,
                    createdAt: customers.createdAt,
                })
                .from(customers)
                .where(eq(customers.phone, phone))
                .limit(1);

            let customer = customerRows[0];
            if (!customer) {
                const last4 = phone.slice(-4);
                const inserted = await tx
                    .insert(customers)
                    .values({
                        name: last4 ? `Customer ${last4}` : "Customer",
                        phone,
                        email: null,
                    })
                    .returning({
                        id: customers.id,
                        name: customers.name,
                        phone: customers.phone,
                        email: customers.email,
                        createdAt: customers.createdAt,
                    });

                customer = inserted[0];
                if (!customer) return { type: "failed" };
            }

            // ---- Session logic unchanged below (JWT + customer_sessions) ----
            const jti = crypto.randomUUID();
            const secret = requireJwtSecret();
            const token = jwt.sign(
                {
                    sub: customer.id,
                    phone: customer.phone,
                    jti,
                    typ: "customer",
                },
                secret,
                { expiresIn: JWT_TTL }
            );

            const decoded = jwt.decode(token);
            const exp = decoded?.exp;
            if (!exp) return { type: "token_failed" };

            const tokenHash = tokenToHash(token);
            const tokenExpiresAt = new Date(Number(exp) * 1000);

            await tx
                .insert(customerSessions)
                .values({
                    customerId: customer.id,
                    tokenHash,
                    expiresAt: tokenExpiresAt,
                })
                .onConflictDoNothing({ target: customerSessions.tokenHash });

            return { type: "ok", token, customer };
        });

        if (result.type === "otp_expired") return res.status(401).json({ error: "OTP_EXPIRED" });
        if (result.type === "otp_invalid") return res.status(401).json({ error: "OTP_INVALID" });
        if (result.type === "token_failed") return res.status(500).json({ error: "TOKEN_CREATE_FAILED" });
        if (result.type !== "ok") return res.status(500).json({ error: "LOGIN_FAILED" });

        return res.json({ token: result.token, customer: result.customer });
    } catch (err) {
        next(err);
    }
}

export async function logout(req, res, next) {
    try {
        const token = extractBearerToken(req);
        if (!token) return res.status(401).json({ error: "TOKEN_REQUIRED" });

        const secret = requireJwtSecret();
        let payload;
        try {
            payload = jwt.verify(token, secret);
        } catch {
            return res.status(401).json({ error: "TOKEN_INVALID" });
        }

        if (payload?.typ !== "customer") {
            return res.status(401).json({ error: "TOKEN_INVALID" });
        }

        const tokenHash = tokenToHash(token);
        await db.delete(customerSessions).where(eq(customerSessions.tokenHash, tokenHash));
        return res.status(204).send();
    } catch (err) {
        next(err);
    }
}

export async function revokeToken(req, res, next) {
    return logout(req, res, next);
}


