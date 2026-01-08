
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";

import { db } from "../../db/index.js";
import { riders, riderSessions } from "../../db/schema.js";
import { toStringOrUndefined } from "../../utils/common.js";
import { env } from "../../config/env.js";

const JWT_TTL = env.RIDER_JWT_TTL || "1d";

function tokenToHash(token) {
    return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function normalizeUsername(username) {
    return toStringOrUndefined(username);
}

function requireJwtSecret() {
    const secret = env.RIDER_JWT_SECRET || "dev-rider-jwt-secret";
    const isProd = env.NODE_ENV === "production";
    if (isProd && secret === "dev-rider-jwt-secret") {
        throw new Error("RIDER_JWT_SECRET is required in production");
    }
    return secret;
}

export async function login(req, res, next) {
    try {
        const username = normalizeUsername(req.body?.username);
        const password = toStringOrUndefined(req.body?.password);

        if (!username || !password) {
            return res.status(400).json({ error: "USERNAME_PASSWORD_REQUIRED" });
        }

        const rows = await db
            .select({
                id: riders.id,
                name: riders.name,
                phone: riders.phone,
                username: riders.username,
                passwordHash: riders.passwordHash,
                isActive: riders.isActive,
                createdAt: riders.createdAt,
            })
            .from(riders)
            .where(eq(riders.username, username))
            .limit(1);

        const rider = rows[0];
        if (!rider) return res.status(401).json({ error: "INVALID_CREDENTIALS" });
        if (!rider.isActive) return res.status(403).json({ error: "RIDER_INACTIVE" });

        const ok = await bcrypt.compare(password, rider.passwordHash);
        if (!ok) return res.status(401).json({ error: "INVALID_CREDENTIALS" });

        const jti = crypto.randomUUID();
        const secret = requireJwtSecret();

        const token = jwt.sign(
            {
                sub: rider.id,
                username: rider.username,
                jti,
                typ: "rider",
            },
            secret,
            { expiresIn: JWT_TTL }
        );

        const decoded = jwt.decode(token);
        const exp = decoded?.exp;
        if (!exp) {
            return res.status(500).json({ error: "TOKEN_CREATE_FAILED" });
        }

        const tokenHash = tokenToHash(token);
        const expiresAt = new Date(Number(exp) * 1000);

        await db
            .insert(riderSessions)
            .values({
                riderId: rider.id,
                tokenHash,
                expiresAt,
            })
            .onConflictDoNothing({ target: riderSessions.tokenHash });

        return res.json({
            token,
            rider: {
                id: rider.id,
                name: rider.name,
                phone: rider.phone,
                username: rider.username,
                isActive: rider.isActive,
                createdAt: rider.createdAt,
            },
        });
    } catch (err) {
        next(err);
    }
}

export async function getMe(req, res, next) {
    try {
        return res.json({ rider: req.rider });
    } catch (err) {
        next(err);
    }
}

