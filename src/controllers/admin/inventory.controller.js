import { desc, eq, lt, sql } from "drizzle-orm";

import { db } from "../../db/index.js";
import { inventory, inventoryMovements, products } from "../../db/schema.js";
import {
    isPgUniqueViolation,
    toIntOrUndefined,
    toNumericStringOrUndefined,
    toStringOrUndefined,
} from "../../utils/common.js";

async function fetchInventoryRow(productId) {
    const rows = await db
        .select({
            productId: inventory.productId,
            costPrice: inventory.costPrice,
            sellingPrice: inventory.sellingPrice,
            discountPercent: inventory.discountPercent,
            quantity: inventory.quantity,
            minQuantity: inventory.minQuantity,
            updatedAt: inventory.updatedAt,

            productName: products.name,
            productDescription: products.description,
            productImgUrl: products.imgUrl,
            productIsActive: products.isActive,
            productCreatedAt: products.createdAt,
        })
        .from(inventory)
        .innerJoin(products, eq(products.id, inventory.productId))
        .where(eq(inventory.productId, productId))
        .limit(1);

    return rows[0] || null;
}

export async function createInventoryItem(req, res, next) {
    try {
        const productId = toStringOrUndefined(req.body?.productId);
        const costPrice = toNumericStringOrUndefined(req.body?.costPrice);
        const sellingPrice = toNumericStringOrUndefined(req.body?.sellingPrice);
        const discountPercent =
            toNumericStringOrUndefined(req.body?.discountPercent) ?? "0";
        const quantity = toIntOrUndefined(req.body?.quantity);
        const minQuantity = toIntOrUndefined(req.body?.minQuantity) ?? 0;

        if (!productId || !costPrice || !sellingPrice || quantity === undefined) {
            return res
                .status(400)
                .json({ error: "PRODUCT_ID_COST_SELLING_QUANTITY_REQUIRED" });
        }

        const productExists = await db
            .select({ id: products.id })
            .from(products)
            .where(eq(products.id, productId))
            .limit(1);

        if (!productExists[0]) {
            return res.status(404).json({ error: "PRODUCT_NOT_FOUND" });
        }

        const adminId = req.admin?.id || req.session?.adminId;
        if (!adminId) return res.status(401).json({ error: "ADMIN_UNAUTHENTICATED" });

        await db.transaction(async (tx) => {
            await tx.insert(inventory).values({
                productId,
                costPrice,
                sellingPrice,
                discountPercent,
                quantity,
                minQuantity,
            });

            await tx.insert(inventoryMovements).values({
                productId,
                deltaQuantity: quantity,
                reason: "INITIAL_STOCK",
                referenceType: "PURCHASE",
                referenceId: null,
                actorType: "ADMIN",
                actorId: adminId,
            });
        });

        const row = await fetchInventoryRow(productId);
        return res.status(201).json({ inventory: row });
    } catch (err) {
        if (isPgUniqueViolation(err)) {
            return res.status(409).json({ error: "INVENTORY_ALREADY_EXISTS" });
        }
        next(err);
    }
}

export async function listInventory(req, res, next) {
    try {
        const rows = await db
            .select({
                productId: inventory.productId,
                costPrice: inventory.costPrice,
                sellingPrice: inventory.sellingPrice,
                discountPercent: inventory.discountPercent,
                quantity: inventory.quantity,
                minQuantity: inventory.minQuantity,
                updatedAt: inventory.updatedAt,

                productName: products.name,
                productDescription: products.description,
                productImgUrl: products.imgUrl,
                productIsActive: products.isActive,
                productCreatedAt: products.createdAt,
            })
            .from(inventory)
            .innerJoin(products, eq(products.id, inventory.productId));

        return res.json({ inventory: rows });
    } catch (err) {
        next(err);
    }
}

export async function listLowStockInventory(req, res, next) {
    try {
        const rows = await db
            .select({
                productId: inventory.productId,
                costPrice: inventory.costPrice,
                sellingPrice: inventory.sellingPrice,
                discountPercent: inventory.discountPercent,
                quantity: inventory.quantity,
                minQuantity: inventory.minQuantity,
                updatedAt: inventory.updatedAt,

                productName: products.name,
                productDescription: products.description,
                productImgUrl: products.imgUrl,
                productIsActive: products.isActive,
                productCreatedAt: products.createdAt,
            })
            .from(inventory)
            .innerJoin(products, eq(products.id, inventory.productId))
            .where(lt(inventory.quantity, inventory.minQuantity));

        return res.json({ inventory: rows });
    } catch (err) {
        next(err);
    }
}

export async function listOutOfStockInventory(req, res, next) {
    try {
        const rows = await db
            .select({
                productId: inventory.productId,
                costPrice: inventory.costPrice,
                sellingPrice: inventory.sellingPrice,
                discountPercent: inventory.discountPercent,
                quantity: inventory.quantity,
                minQuantity: inventory.minQuantity,
                updatedAt: inventory.updatedAt,

                productName: products.name,
                productDescription: products.description,
                productImgUrl: products.imgUrl,
                productIsActive: products.isActive,
                productCreatedAt: products.createdAt,
            })
            .from(inventory)
            .innerJoin(products, eq(products.id, inventory.productId))
            .where(eq(inventory.quantity, 0));

        return res.json({ inventory: rows });
    } catch (err) {
        next(err);
    }
}

export async function getInventoryItem(req, res, next) {
    try {
        const productId = toStringOrUndefined(req.params?.productId);
        if (!productId) return res.status(400).json({ error: "PRODUCT_ID_REQUIRED" });

        const row = await fetchInventoryRow(productId);
        if (!row) return res.status(404).json({ error: "INVENTORY_NOT_FOUND" });

        return res.json({ inventory: row });
    } catch (err) {
        next(err);
    }
}

export async function updateInventoryItem(req, res, next) {
    try {
        const productId = toStringOrUndefined(req.params?.productId);
        if (!productId) return res.status(400).json({ error: "PRODUCT_ID_REQUIRED" });

        const costPrice = toNumericStringOrUndefined(req.body?.costPrice);
        const sellingPrice = toNumericStringOrUndefined(req.body?.sellingPrice);
        const discountPercent = toNumericStringOrUndefined(req.body?.discountPercent);
        const quantity = toIntOrUndefined(req.body?.quantity);
        const minQuantity = toIntOrUndefined(req.body?.minQuantity);

        if (
            costPrice === undefined &&
            sellingPrice === undefined &&
            discountPercent === undefined &&
            quantity === undefined &&
            minQuantity === undefined
        ) {
            return res.status(400).json({ error: "NOTHING_TO_UPDATE" });
        }

        const updateValues = {};
        if (costPrice !== undefined) updateValues.costPrice = costPrice;
        if (sellingPrice !== undefined) updateValues.sellingPrice = sellingPrice;
        if (discountPercent !== undefined)
            updateValues.discountPercent = discountPercent;
        if (quantity !== undefined) updateValues.quantity = quantity;
        if (minQuantity !== undefined) updateValues.minQuantity = minQuantity;
        updateValues.updatedAt = new Date();

        const updated = await db
            .update(inventory)
            .set(updateValues)
            .where(eq(inventory.productId, productId))
            .returning({ productId: inventory.productId });

        if (!updated[0]) return res.status(404).json({ error: "INVENTORY_NOT_FOUND" });

        const row = await fetchInventoryRow(productId);
        return res.json({ inventory: row });
    } catch (err) {
        next(err);
    }
}

export async function addInventoryQuantity(req, res, next) {
    try {
        const productId = toStringOrUndefined(req.params?.productId);
        if (!productId) return res.status(400).json({ error: "PRODUCT_ID_REQUIRED" });

        const quantityToAdd = toIntOrUndefined(req.body?.quantity);
        if (quantityToAdd === undefined) {
            return res.status(400).json({ error: "QUANTITY_REQUIRED" });
        }
        if (quantityToAdd <= 0) {
            return res.status(400).json({ error: "QUANTITY_MUST_BE_POSITIVE" });
        }

        const adminId = req.admin?.id || req.session?.adminId;
        if (!adminId) return res.status(401).json({ error: "ADMIN_UNAUTHENTICATED" });

        const reason = toStringOrUndefined(req.body?.reason) ?? "ADJUSTMENT";
        const referenceType = toStringOrUndefined(req.body?.referenceType) ?? "ADJUSTMENT";
        const referenceId = toStringOrUndefined(req.body?.referenceId) ?? null;

        const allowedReasons = new Set([
            "INITIAL_STOCK",
            "PURCHASE",
            "ADJUSTMENT",
            "ORDER_CANCELLED",
        ]);
        const allowedReferenceTypes = new Set(["ORDER", "PURCHASE", "ADJUSTMENT"]);

        if (!allowedReasons.has(reason)) {
            return res.status(400).json({ error: "INVALID_REASON" });
        }
        if (!allowedReferenceTypes.has(referenceType)) {
            return res.status(400).json({ error: "INVALID_REFERENCE_TYPE" });
        }

        const now = new Date();
        // console.log(productId);

        const outcome = await db.transaction(async (tx) => {
            const result = await tx
                .update(inventory)
                .set({
                    quantity: sql`${inventory.quantity} + ${quantityToAdd}`,
                    updatedAt: now,
                })
                .where(eq(inventory.productId, productId));
            // console.log(result.rows);
            // if (result.rowsAffected !== 1) return { type: "not_found" };

            await tx.insert(inventoryMovements).values({
                productId,
                deltaQuantity: quantityToAdd,
                reason,
                referenceType,
                referenceId,
                actorType: "ADMIN",
                actorId: adminId,
            });

            return { type: "ok" };
        });

        if (outcome.type === "not_found") {
            return res.status(404).json({ error: "INVENTORY_NOT_FOUND" });
        }

        const row = await fetchInventoryRow(productId);
        return res.json({ inventory: row });
    } catch (err) {
        next(err);
    }
}

export async function listInventoryMovementsForProduct(req, res, next) {
    try {
        const productId = toStringOrUndefined(req.params?.productId);
        if (!productId) return res.status(400).json({ error: "PRODUCT_ID_REQUIRED" });

        const rows = await db
            .select({
                id: inventoryMovements.id,
                productId: inventoryMovements.productId,
                deltaQuantity: inventoryMovements.deltaQuantity,
                reason: inventoryMovements.reason,
                referenceType: inventoryMovements.referenceType,
                referenceId: inventoryMovements.referenceId,
                actorType: inventoryMovements.actorType,
                actorId: inventoryMovements.actorId,
                createdAt: inventoryMovements.createdAt,
            })
            .from(inventoryMovements)
            .where(eq(inventoryMovements.productId, productId))
            .orderBy(desc(inventoryMovements.createdAt))
            .limit(100);

        return res.json({ movements: rows });
    } catch (err) {
        next(err);
    }
}

export async function deleteInventoryItem(req, res, next) {
    try {
        const productId = toStringOrUndefined(req.params?.productId);
        if (!productId) return res.status(400).json({ error: "PRODUCT_ID_REQUIRED" });

        const deleted = await db
            .delete(inventory)
            .where(eq(inventory.productId, productId))
            .returning({ productId: inventory.productId });

        if (!deleted[0]) return res.status(404).json({ error: "INVENTORY_NOT_FOUND" });
        return res.status(204).send();
    } catch (err) {
        next(err);
    }
}

