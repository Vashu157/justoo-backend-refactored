import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";

import { db } from "../../db/index.js";
import { riders } from "../../db/schema.js";
import {
    isPgUniqueViolation,
    toBooleanOrUndefined,
    toStringOrUndefined,
} from "../../utils/common.js";

export async function createRider(req, res, next) {
    try {
        const name = toStringOrUndefined(req.body?.name);
        const phone = toStringOrUndefined(req.body?.phone);
        const username = toStringOrUndefined(req.body?.username);
        const password = toStringOrUndefined(req.body?.password);
        const isActive = toBooleanOrUndefined(req.body?.isActive);

        if (!name || !phone || !username || !password) {
            return res
                .status(400)
                .json({ error: "NAME_PHONE_USERNAME_PASSWORD_REQUIRED" });
        }

        const rounds = Number(env.BCRYPT_ROUNDS || 10);
        const passwordHash = await bcrypt.hash(password, rounds);

        const created = await db
            .insert(riders)
            .values({
                name,
                phone,
                username,
                passwordHash,
                isActive: isActive ?? true,
            })
            .returning({
                id: riders.id,
                name: riders.name,
                phone: riders.phone,
                username: riders.username,
                isActive: riders.isActive,
                createdAt: riders.createdAt,
            });

        return res.status(201).json({ rider: created[0] });
    } catch (err) {
        if (isPgUniqueViolation(err)) {
            return res.status(409).json({ error: "RIDER_ALREADY_EXISTS" });
        }
        next(err);
    }
}

export async function listRiders(req, res, next) {
    try {
        const rows = await db
            .select({
                id: riders.id,
                name: riders.name,
                phone: riders.phone,
                username: riders.username,
                isActive: riders.isActive,
                createdAt: riders.createdAt,
            })
            .from(riders);

        return res.json({ riders: rows });
    } catch (err) {
        next(err);
    }
}

export async function getRiderById(req, res, next) {
    try {
        const riderId = toStringOrUndefined(req.params?.riderId);
        if (!riderId) return res.status(400).json({ error: "RIDER_ID_REQUIRED" });

        const rows = await db
            .select({
                id: riders.id,
                name: riders.name,
                phone: riders.phone,
                username: riders.username,
                isActive: riders.isActive,
                createdAt: riders.createdAt,
            })
            .from(riders)
            .where(eq(riders.id, riderId))
            .limit(1);

        const rider = rows[0];
        if (!rider) return res.status(404).json({ error: "RIDER_NOT_FOUND" });

        return res.json({ rider });
    } catch (err) {
        next(err);
    }
}

export async function updateRider(req, res, next) {
    try {
        const riderId = toStringOrUndefined(req.params?.riderId);
        if (!riderId) return res.status(400).json({ error: "RIDER_ID_REQUIRED" });

        const name = toStringOrUndefined(req.body?.name);
        const phone = toStringOrUndefined(req.body?.phone);
        const username = toStringOrUndefined(req.body?.username);
        const password = toStringOrUndefined(req.body?.password);
        const isActive = toBooleanOrUndefined(req.body?.isActive);

        if (!name && !phone && !username && !password && isActive === undefined) {
            return res.status(400).json({ error: "NOTHING_TO_UPDATE" });
        }

        const updateValues = {};
        if (name) updateValues.name = name;
        if (phone) updateValues.phone = phone;
        if (username) updateValues.username = username;
        if (isActive !== undefined) updateValues.isActive = isActive;

        if (password) {
            const rounds = Number(env.BCRYPT_ROUNDS || 10);
            updateValues.passwordHash = await bcrypt.hash(password, rounds);
        }

        const updated = await db
            .update(riders)
            .set(updateValues)
            .where(eq(riders.id, riderId))
            .returning({
                id: riders.id,
                name: riders.name,
                phone: riders.phone,
                username: riders.username,
                isActive: riders.isActive,
                createdAt: riders.createdAt,
            });

        if (!updated[0]) return res.status(404).json({ error: "RIDER_NOT_FOUND" });
        return res.json({ rider: updated[0] });
    } catch (err) {
        if (isPgUniqueViolation(err)) {
            return res.status(409).json({ error: "RIDER_ALREADY_EXISTS" });
        }
        next(err);
    }
}

export async function deleteRider(req, res, next) {
    try {
        const riderId = toStringOrUndefined(req.params?.riderId);
        if (!riderId) return res.status(400).json({ error: "RIDER_ID_REQUIRED" });

        const deleted = await db
            .delete(riders)
            .where(eq(riders.id, riderId))
            .returning({ id: riders.id });

        if (!deleted[0]) return res.status(404).json({ error: "RIDER_NOT_FOUND" });
        return res.status(204).send();
    } catch (err) {
        next(err);
    }
}

