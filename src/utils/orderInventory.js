import { eq, sql, and, gte } from "drizzle-orm";
import { inventory, inventoryMovements } from "../db/schema.js";

function affectedRows(result) {
  if (!result || typeof result !== "object") return undefined;
  // sqlite/mysql style
  if (typeof result.rowsAffected === "number") return result.rowsAffected;
  // node-postgres style
  if (typeof result.rowCount === "number") return result.rowCount;
  return undefined;
}

function normalizeItems(items) {
  const map = new Map();

  for (const item of Array.isArray(items) ? items : []) {
    const productId = String(item?.productId || "").trim();
    const qty = Number.parseInt(String(item?.quantity ?? ""), 10);

    if (!productId) continue;
    if (!Number.isFinite(qty) || qty <= 0) continue;

    map.set(productId, (map.get(productId) || 0) + qty);
  }

  return [...map.entries()].map(([productId, quantity]) => ({
    productId,
    quantity,
  }));
}

/**
 * Reserve inventory for an order (DECREMENT).
 * Fails if stock is insufficient.
 */
export async function reserveInventory(tx, items) {
  const normalized = normalizeItems(items);
  if (!normalized.length) return;

  const now = new Date();

  for (const { productId, quantity } of normalized) {
    const result = await tx
      .update(inventory)
      .set({
        quantity: sql`${inventory.quantity} - ${quantity}`,
        updatedAt: now,
      })
      .where(
        and(
          eq(inventory.productId, productId),
          gte(inventory.quantity, quantity)
        )
      );

    if (affectedRows(result) !== 1) {
      throw new Error(`INSUFFICIENT_STOCK:${productId}`);
    }
  }
}

/**
 * Restore inventory on cancellation (INCREMENT).
 */
export async function restoreInventory(tx, items, movement) {
  const normalized = normalizeItems(items);
  if (!normalized.length) return;

  const now = new Date();

  for (const { productId, quantity } of normalized) {
    const result = await tx
      .update(inventory)
      .set({
        quantity: sql`${inventory.quantity} + ${quantity}`,
        updatedAt: now,
      })
      .where(eq(inventory.productId, productId));

    if (affectedRows(result) !== 1) {
      throw new Error(`INVENTORY_ROW_MISSING:${productId}`);
    }

    if (movement) {
      await tx.insert(inventoryMovements).values({
        productId,
        deltaQuantity: quantity,
        reason: movement.reason,
        referenceType: movement.referenceType,
        referenceId: movement.referenceId ?? null,
        actorType: movement.actorType,
        actorId: movement.actorId ?? null,
      });
    }
  }
}
