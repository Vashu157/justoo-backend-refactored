
import { and, desc, eq, inArray, isNull } from "drizzle-orm";

import { db } from "../../db/index.js";
import {
    orderAddresses,
    orders,
    orderEvents,
    payments,
    riderAssignments,
    riders,
} from "../../db/schema.js";
import { ensureRider, replyRiderAuthError } from "../../middleware/rider.middleware.js";
import { isPgUniqueViolation, toStringOrUndefined } from "../../utils/common.js";

export async function listAvailableOrders(req, res, next) {
    try {
        const auth = await ensureRider(req);
        if (auth.error) return replyRiderAuthError(res, auth.error);

        const rows = await db
            .select({
                id: orders.id,
                status: orders.status,
                deliveryFee: orders.deliveryFee,
                subtotalAmount: orders.subtotalAmount,
                totalAmount: orders.totalAmount,
                createdAt: orders.createdAt,
                addressLabel: orderAddresses.label,
                addressLine1: orderAddresses.line1,
                addressLine2: orderAddresses.line2,
            })
            .from(orders)
            .leftJoin(riderAssignments, eq(riderAssignments.orderId, orders.id))
            .leftJoin(orderAddresses, eq(orderAddresses.orderId, orders.id))
            .where(and(eq(orders.status, "CREATED"), isNull(riderAssignments.orderId)))
            .orderBy(desc(orders.createdAt));

        return res.json({ orders: rows });
    } catch (err) {
        next(err);
    }
}

export async function listMyActiveOrders(req, res, next) {
    try {
        const auth = await ensureRider(req);
        if (auth.error) return replyRiderAuthError(res, auth.error);

        const riderId = auth.rider.id;

        const rows = await db
            .select({
                id: orders.id,
                status: orders.status,
                deliveryFee: orders.deliveryFee,
                subtotalAmount: orders.subtotalAmount,
                totalAmount: orders.totalAmount,
                createdAt: orders.createdAt,
                addressLabel: orderAddresses.label,
                addressLine1: orderAddresses.line1,
                addressLine2: orderAddresses.line2,
            })
            .from(orders)
            .innerJoin(riderAssignments, eq(riderAssignments.orderId, orders.id))
            .leftJoin(orderAddresses, eq(orderAddresses.orderId, orders.id))
            .where(
                and(
                    eq(riderAssignments.riderId, riderId),
                    inArray(orders.status, ["ASSIGNED_RIDER", "OUT_FOR_DELIVERY"])
                )
            )
            .orderBy(desc(orders.createdAt));

        return res.json({ orders: rows });
    } catch (err) {
        next(err);
    }
}

export async function acceptOrder(req, res, next) {
    try {
        const auth = await ensureRider(req);
        if (auth.error) return replyRiderAuthError(res, auth.error);

        const orderId = toStringOrUndefined(req.params?.orderId);
        if (!orderId) return res.status(400).json({ error: "ORDER_ID_REQUIRED" });

        const riderId = auth.rider.id;

        const result = await db.transaction(async (tx) => {
            const riderRows = await tx
                .select({ id: riders.id, isActive: riders.isActive })
                .from(riders)
                .where(eq(riders.id, riderId))
                .limit(1);

            const riderRow = riderRows[0];
            if (!riderRow) return { type: "rider_not_found" };
            if (!riderRow.isActive) return { type: "rider_inactive" };

            const updated = await tx
                .update(orders)
                .set({ status: "ASSIGNED_RIDER" })
                .where(and(eq(orders.id, orderId), eq(orders.status, "CREATED")))
                .returning({ id: orders.id });

            if (!updated[0]) return { type: "lost_race" };

            try {
                await tx.insert(riderAssignments).values({ orderId, riderId });
            } catch (err) {
                if (isPgUniqueViolation(err)) return { type: "lost_race" };
                throw err;
            }

            await tx.insert(orderEvents).values({
                orderId,
                fromStatus: "CREATED",
                toStatus: "ASSIGNED_RIDER",
                actorType: "RIDER",
                actorId: riderId,
                reason: null,
            });

            return { type: "ok" };
        });

        if (result.type === "rider_not_found") return res.status(404).json({ error: "RIDER_NOT_FOUND" });
        if (result.type === "rider_inactive") return res.status(403).json({ error: "RIDER_INACTIVE" });
        if (result.type === "lost_race") return res.status(409).json({ error: "ORDER_ALREADY_ASSIGNED" });

        return res.status(200).json({ ok: true });
    } catch (err) {
        next(err);
    }
}

export async function markOutForDelivery(req, res, next) {
    try {
        const auth = await ensureRider(req);
        if (auth.error) return replyRiderAuthError(res, auth.error);

        const orderId = toStringOrUndefined(req.params?.orderId);
        if (!orderId) return res.status(400).json({ error: "ORDER_ID_REQUIRED" });

        const riderId = auth.rider.id;

        const result = await db.transaction(async (tx) => {
            const rows = await tx
                .select({
                    id: orders.id,
                    status: orders.status,
                    assignedRiderId: riderAssignments.riderId,
                })
                .from(orders)
                .leftJoin(riderAssignments, eq(riderAssignments.orderId, orders.id))
                .where(eq(orders.id, orderId))
                .limit(1);

            const row = rows[0];
            if (!row) return { type: "not_found" };
            if (!row.assignedRiderId) return { type: "not_assigned" };
            if (row.assignedRiderId !== riderId) return { type: "not_yours" };
            if (row.status !== "ASSIGNED_RIDER") return { type: "bad_status" };

            await tx
                .update(orders)
                .set({ status: "OUT_FOR_DELIVERY" })
                .where(and(eq(orders.id, orderId), eq(orders.status, "ASSIGNED_RIDER")));

            await tx.insert(orderEvents).values({
                orderId,
                fromStatus: "ASSIGNED_RIDER",
                toStatus: "OUT_FOR_DELIVERY",
                actorType: "RIDER",
                actorId: riderId,
                reason: null,
            });

            return { type: "ok" };
        });

        if (result.type === "not_found") return res.status(404).json({ error: "ORDER_NOT_FOUND" });
        if (result.type === "not_assigned") return res.status(409).json({ error: "ORDER_NOT_ASSIGNED" });
        if (result.type === "not_yours") return res.status(403).json({ error: "ORDER_NOT_ASSIGNED_TO_RIDER" });
        if (result.type === "bad_status") return res.status(409).json({ error: "ORDER_STATUS_INVALID" });

        return res.status(200).json({ ok: true });
    } catch (err) {
        next(err);
    }
}

export async function markDelivered(req, res, next) {
    try {
        const auth = await ensureRider(req);
        if (auth.error) return replyRiderAuthError(res, auth.error);

        const orderId = toStringOrUndefined(req.params?.orderId);
        if (!orderId) return res.status(400).json({ error: "ORDER_ID_REQUIRED" });

        const riderId = auth.rider.id;

        const result = await db.transaction(async (tx) => {
            const rows = await tx
                .select({
                    id: orders.id,
                    status: orders.status,
                    totalAmount: orders.totalAmount,
                    assignedRiderId: riderAssignments.riderId,
                })
                .from(orders)
                .leftJoin(riderAssignments, eq(riderAssignments.orderId, orders.id))
                .where(eq(orders.id, orderId))
                .limit(1);

            const row = rows[0];
            if (!row) return { type: "not_found" };
            if (!row.assignedRiderId) return { type: "not_assigned" };
            if (row.assignedRiderId !== riderId) return { type: "not_yours" };
            if (row.status !== "OUT_FOR_DELIVERY") return { type: "bad_status" };

            const updated = await tx
                .update(orders)
                .set({ status: "DELIVERED" })
                .where(and(eq(orders.id, orderId), eq(orders.status, "OUT_FOR_DELIVERY")))
                .returning({ totalAmount: orders.totalAmount });

            const updatedOrder = updated[0];
            if (!updatedOrder) return { type: "bad_status" };

            await tx.insert(orderEvents).values({
                orderId,
                fromStatus: "OUT_FOR_DELIVERY",
                toStatus: "DELIVERED",
                actorType: "RIDER",
                actorId: riderId,
                reason: null,
            });

            await tx.insert(payments).values({
                orderId,
                amount: updatedOrder.totalAmount,
                status: "SUCCESS",
                provider: "COD",
                providerRef: null,
            });

            return { type: "ok" };
        });

        if (result.type === "not_found") return res.status(404).json({ error: "ORDER_NOT_FOUND" });
        if (result.type === "not_assigned") return res.status(409).json({ error: "ORDER_NOT_ASSIGNED" });
        if (result.type === "not_yours") return res.status(403).json({ error: "ORDER_NOT_ASSIGNED_TO_RIDER" });
        if (result.type === "bad_status") return res.status(409).json({ error: "ORDER_STATUS_INVALID" });

        return res.status(200).json({ ok: true });
    } catch (err) {
        next(err);
    }
}

