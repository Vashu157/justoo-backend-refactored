import { desc, eq, inArray } from "drizzle-orm";

import { db } from "../../db/index.js";
import {
    customers,
    orderAddresses,
    orderItems,
    orders,
    products,
    riderAssignments,
    riders,
    orderEvents,
} from "../../db/schema.js";
import { restoreInventory } from "../../utils/orderInventory.js";
import { toStringOrUndefined } from "../../utils/common.js";

function normalizeOrderStatusesFromQuery(value) {
    const raw = toStringOrUndefined(value);
    if (!raw) return undefined;
    return raw
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
}

function statusFilterToStatuses(filter) {
    const f = toStringOrUndefined(filter)?.toLowerCase();
    if (!f) return undefined;

    const CURRENT = [
        "CREATED",
        "ASSIGNED_RIDER",
        "OUT_FOR_DELIVERY",
    ];
    const CANCELLED = ["CANCELLED"];
    const COMPLETED = ["DELIVERED"];

    if (["current", "active", "ongoing", "open"].includes(f)) return CURRENT;
    if (["cancelled", "canceled"].includes(f)) return CANCELLED;
    if (["completed", "done", "closed"].includes(f)) return COMPLETED;
    return undefined;
}

async function fetchOrderSummaryRow(orderId) {
    const rows = await db
        .select({
            id: orders.id,
            status: orders.status,
            deliveryFee: orders.deliveryFee,
            subtotalAmount: orders.subtotalAmount,
            totalAmount: orders.totalAmount,
            createdAt: orders.createdAt,

            customerId: customers.id,
            customerName: customers.name,
            customerPhone: customers.phone,
            customerEmail: customers.email,

            riderId: riders.id,
            riderName: riders.name,
            riderPhone: riders.phone,
            assignedAt: riderAssignments.assignedAt,
        })
        .from(orders)
        .innerJoin(customers, eq(customers.id, orders.customerId))
        .leftJoin(riderAssignments, eq(riderAssignments.orderId, orders.id))
        .leftJoin(riders, eq(riders.id, riderAssignments.riderId))
        .where(eq(orders.id, orderId))
        .limit(1);

    return rows[0] || null;
}

export async function listOrders(req, res, next) {
    try {
        const filter = toStringOrUndefined(req.query?.filter);
        const statusQuery = normalizeOrderStatusesFromQuery(req.query?.status);

        const statusesFromFilter = statusFilterToStatuses(filter);

        let whereClause;
        if (statusQuery?.length) {
            whereClause = inArray(orders.status, statusQuery);
        } else if (statusesFromFilter?.length) {
            whereClause = inArray(orders.status, statusesFromFilter);
        }

        const rows = await db
            .select({
                id: orders.id,
                status: orders.status,
                deliveryFee: orders.deliveryFee,
                subtotalAmount: orders.subtotalAmount,
                totalAmount: orders.totalAmount,
                createdAt: orders.createdAt,

                customerId: customers.id,
                customerName: customers.name,
                customerPhone: customers.phone,
                customerEmail: customers.email,

                riderId: riders.id,
                riderName: riders.name,
                riderPhone: riders.phone,
                assignedAt: riderAssignments.assignedAt,
            })
            .from(orders)
            .innerJoin(customers, eq(customers.id, orders.customerId))
            .leftJoin(riderAssignments, eq(riderAssignments.orderId, orders.id))
            .leftJoin(riders, eq(riders.id, riderAssignments.riderId))
            .where(whereClause)
            .orderBy(desc(orders.createdAt));

        return res.json({ orders: rows });
    } catch (err) {
        next(err);
    }
}

export async function getOrderById(req, res, next) {
    try {
        const orderId = toStringOrUndefined(req.params?.orderId);
        if (!orderId) return res.status(400).json({ error: "ORDER_ID_REQUIRED" });

        const order = await fetchOrderSummaryRow(orderId);
        if (!order) return res.status(404).json({ error: "ORDER_NOT_FOUND" });

        const items = await db
            .select({
                id: orderItems.id,
                productId: orderItems.productId,
                productName: products.name,
                productImgUrl: products.imgUrl,
                quantity: orderItems.quantity,
                unitPrice: orderItems.unitPrice,
                discountPercent: orderItems.discountPercent,
                finalPrice: orderItems.finalPrice,
            })
            .from(orderItems)
            .innerJoin(products, eq(products.id, orderItems.productId))
            .where(eq(orderItems.orderId, orderId));

        const addressRows = await db
            .select({
                label: orderAddresses.label,
                line1: orderAddresses.line1,
                line2: orderAddresses.line2,
            })
            .from(orderAddresses)
            .where(eq(orderAddresses.orderId, orderId))
            .limit(1);

        return res.json({
            order,
            items,
            address: addressRows[0] || null,
        });
    } catch (err) {
        next(err);
    }
}

export async function cancelOrder(req, res, next) {
    try {
        const orderId = toStringOrUndefined(req.params?.orderId);
        if (!orderId) return res.status(400).json({ error: "ORDER_ID_REQUIRED" });

        const reason = toStringOrUndefined(req.body?.reason);
        if (!reason) return res.status(400).json({ error: "CANCEL_REASON_REQUIRED" });

        const adminId = req.admin?.id || req.session?.adminId;
        if (!adminId) return res.status(401).json({ error: "ADMIN_UNAUTHENTICATED" });

        const updated = await db.transaction(async (tx) => {
            const existingRows = await tx
                .select({ id: orders.id, status: orders.status })
                .from(orders)
                .where(eq(orders.id, orderId))
                .limit(1);

            const existing = existingRows[0];
            if (!existing) return { type: "not_found" };

            if (existing.status === "CANCELLED") return { type: "already_cancelled" };
            if (["DELIVERED", "REFUNDED"].includes(existing.status)) {
                return { type: "not_cancellable" };
            }

            await tx
                .update(orders)
                .set({ status: "CANCELLED" })
                .where(eq(orders.id, orderId));

            const itemRows = await tx
                .select({ productId: orderItems.productId, quantity: orderItems.quantity })
                .from(orderItems)
                .where(eq(orderItems.orderId, orderId));

            await restoreInventory(tx, itemRows, {
                reason: "ORDER_CANCELLED",
                referenceType: "ORDER",
                referenceId: orderId,
                actorType: "ADMIN",
                actorId: adminId,
            });

            await tx.insert(orderEvents).values({
                orderId,
                fromStatus: existing.status,
                toStatus: "CANCELLED",
                actorType: "ADMIN",
                actorId: adminId,
                reason,
            });

            const order = await fetchOrderSummaryRow(orderId);
            return { type: "ok", order };
        });

        if (updated.type === "not_found") return res.status(404).json({ error: "ORDER_NOT_FOUND" });
        if (updated.type === "already_cancelled")
            return res.status(409).json({ error: "ORDER_ALREADY_CANCELLED" });
        if (updated.type === "not_cancellable")
            return res.status(400).json({ error: "ORDER_NOT_CANCELLABLE" });

        return res.json({ order: updated.order });
    } catch (err) {
        next(err);
    }
}

