
import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "../../db/index.js";
import {
    addresses,
    inventory,
    orderAddresses,
    orderItems,
    orders,
    products,
} from "../../db/schema.js";
import {
    ensureCustomer,
    replyCustomerAuthError,
} from "../../middleware/customer.middleware.js";
import { reserveInventory } from "../../utils/orderInventory.js";
import {
    toIntOrUndefined,
    toNumericStringOrUndefined,
    toStringOrUndefined,
} from "../../utils/common.js";

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
    const COMPLETED = ["DELIVERED"]; // refunded orders are handled by status=REFUNDED

    if (["current", "active", "ongoing", "open"].includes(f)) return CURRENT;
    if (["cancelled", "canceled"].includes(f)) return CANCELLED;
    if (["completed", "done", "closed"].includes(f)) return COMPLETED;
    return undefined;
}

function roundMoneyToString(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "0.00";
    return n.toFixed(2);
}

export async function createOrder(req, res, next) {
    try {
        const auth = await ensureCustomer(req);
        if (auth.error) return replyCustomerAuthError(res, auth.error);

        const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
        if (!rawItems.length) return res.status(400).json({ error: "ITEMS_REQUIRED" });

        const deliveryFee = toNumericStringOrUndefined(req.body?.deliveryFee) ?? "0";

        const addressId = toStringOrUndefined(req.body?.addressId);
        const directLabel = toStringOrUndefined(req.body?.address?.label ?? req.body?.label);
        const directLine1 = toStringOrUndefined(req.body?.address?.line1 ?? req.body?.line1);
        const directLine2 =
            req.body?.address?.line2 !== undefined || req.body?.line2 !== undefined
                ? toStringOrUndefined(req.body?.address?.line2 ?? req.body?.line2)
                : undefined;

        if (!addressId && !directLine1) {
            return res.status(400).json({ error: "ADDRESS_REQUIRED" });
        }

        const items = rawItems
            .map((it) => ({
                productId: toStringOrUndefined(it?.productId),
                quantity: toIntOrUndefined(it?.quantity),
            }))
            .filter((it) => it.productId && it.quantity !== undefined);

        if (!items.length) return res.status(400).json({ error: "ITEMS_REQUIRED" });
        if (items.some((it) => !it.quantity || it.quantity <= 0)) {
            return res.status(400).json({ error: "INVALID_ITEM_QUANTITY" });
        }

        const productIds = [...new Set(items.map((it) => it.productId))];

        const created = await db.transaction(async (tx) => {
            let orderAddress;
            if (addressId) {
                const addrRows = await tx
                    .select({
                        id: addresses.id,
                        label: addresses.label,
                        line1: addresses.line1,
                        line2: addresses.line2,
                    })
                    .from(addresses)
                    .where(and(eq(addresses.id, addressId), eq(addresses.customerId, auth.customer.id)))
                    .limit(1);

                const addr = addrRows[0];
                if (!addr) return { type: "address_not_found" };
                orderAddress = { label: addr.label, line1: addr.line1, line2: addr.line2 };
            } else {
                orderAddress = { label: directLabel, line1: directLine1, line2: directLine2 };
            }

            const invRows = await tx
                .select({
                    productId: inventory.productId,
                    sellingPrice: inventory.sellingPrice,
                    discountPercent: inventory.discountPercent,
                    quantity: inventory.quantity,
                    productIsActive: products.isActive,
                    productName: products.name,
                    productImgUrl: products.imgUrl,
                })
                .from(inventory)
                .innerJoin(products, eq(products.id, inventory.productId))
                .where(inArray(inventory.productId, productIds));

            const invByProductId = new Map(invRows.map((r) => [r.productId, r]));

            for (const it of items) {
                const inv = invByProductId.get(it.productId);
                if (!inv) return { type: "product_not_found", productId: it.productId };
                if (!inv.productIsActive) return { type: "product_inactive", productId: it.productId };
                if (inv.quantity < it.quantity)
                    return { type: "out_of_stock", productId: it.productId };
            }

            // Safe stock reservation (guards against race conditions).
            // Throws on insufficient stock and will roll back the whole transaction.
            await reserveInventory(tx, items);

            const lineItems = items.map((it) => {
                const inv = invByProductId.get(it.productId);
                const unitPrice = Number(inv.sellingPrice);
                const discountPercent = Number(inv.discountPercent ?? "0");
                const discountFactor = 1 - discountPercent / 100;
                const finalPrice = unitPrice * it.quantity * discountFactor;

                return {
                    productId: it.productId,
                    productName: inv.productName,
                    productImgUrl: inv.productImgUrl,
                    quantity: it.quantity,
                    unitPrice: roundMoneyToString(unitPrice),
                    discountPercent: String(inv.discountPercent ?? "0"),
                    finalPrice: roundMoneyToString(finalPrice),
                };
            });

            const subtotal = lineItems.reduce((sum, li) => sum + Number(li.finalPrice), 0);
            const total = subtotal + Number(deliveryFee);

            const insertedOrders = await tx
                .insert(orders)
                .values({
                    customerId: auth.customer.id,
                    status: "CREATED",
                    deliveryFee,
                    subtotalAmount: roundMoneyToString(subtotal),
                    totalAmount: roundMoneyToString(total),
                })
                .returning({
                    id: orders.id,
                    status: orders.status,
                    deliveryFee: orders.deliveryFee,
                    subtotalAmount: orders.subtotalAmount,
                    totalAmount: orders.totalAmount,
                    createdAt: orders.createdAt,
                });

            const order = insertedOrders[0];
            if (!order) return { type: "failed" };

            await tx.insert(orderAddresses).values({
                orderId: order.id,
                label: orderAddress.label,
                line1: orderAddress.line1,
                line2: orderAddress.line2,
            });

            await tx.insert(orderItems).values(
                lineItems.map((li) => ({
                    orderId: order.id,
                    productId: li.productId,
                    quantity: li.quantity,
                    unitPrice: li.unitPrice,
                    discountPercent: li.discountPercent,
                    finalPrice: li.finalPrice,
                }))
            );

            return {
                type: "ok",
                order,
                items: lineItems,
                address: orderAddress,
            };
        });

        if (created.type === "address_not_found")
            return res.status(404).json({ error: "ADDRESS_NOT_FOUND" });
        if (created.type === "product_not_found")
            return res.status(404).json({ error: "PRODUCT_NOT_FOUND", productId: created.productId });
        if (created.type === "product_inactive")
            return res.status(400).json({ error: "PRODUCT_INACTIVE", productId: created.productId });
        if (created.type === "out_of_stock")
            return res.status(400).json({ error: "OUT_OF_STOCK", productId: created.productId });
        if (created.type !== "ok") return res.status(500).json({ error: "ORDER_CREATE_FAILED" });

        return res.status(201).json({
            order: created.order,
            items: created.items,
            address: created.address,
        });
    } catch (err) {
        if (err instanceof Error && err.message.startsWith("INSUFFICIENT_STOCK:")) {
            const productId = err.message.split(":")[1];
            return res.status(400).json({ error: "OUT_OF_STOCK", productId });
        }
        next(err);
    }
}

export async function listMyOrders(req, res, next) {
    try {
        const auth = await ensureCustomer(req);
        if (auth.error) return replyCustomerAuthError(res, auth.error);

        const filter = toStringOrUndefined(req.query?.filter);
        const statusQuery = normalizeOrderStatusesFromQuery(req.query?.status);
        const statusesFromFilter = statusFilterToStatuses(filter);

        let whereClause = eq(orders.customerId, auth.customer.id);

        if (statusQuery?.length) {
            whereClause = and(whereClause, inArray(orders.status, statusQuery));
        } else if (statusesFromFilter?.length) {
            whereClause = and(whereClause, inArray(orders.status, statusesFromFilter));
        }

        const rows = await db
            .select({
                id: orders.id,
                status: orders.status,
                deliveryFee: orders.deliveryFee,
                subtotalAmount: orders.subtotalAmount,
                totalAmount: orders.totalAmount,
                createdAt: orders.createdAt,
            })
            .from(orders)
            .where(whereClause)
            .orderBy(desc(orders.createdAt));

        return res.json({ orders: rows });
    } catch (err) {
        next(err);
    }
}

