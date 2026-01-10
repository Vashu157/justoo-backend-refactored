import { and, asc, desc, eq, gt, gte, inArray, lte, sql } from "drizzle-orm";

import { db } from "../../db/index.js";
import { inventory, products } from "../../db/schema.js";
import {
    toBooleanOrUndefined,
    toNumericStringOrUndefined,
    toStringOrUndefined,
} from "../../utils/common.js";
import {
    PRODUCT_CATEGORIES,
    normalizeProductCategory,
} from "../../utils/productCategories.js";

function getSortFromQuery(query) {
    const sort = toStringOrUndefined(query?.sort)?.toLowerCase();

    if (!sort || sort === "newest") return [desc(products.createdAt)];

    if (sort === "price_asc") return [asc(inventory.sellingPrice), asc(products.name)];
    if (sort === "price_desc") return [desc(inventory.sellingPrice), asc(products.name)];
    if (sort === "discount_desc") return [desc(inventory.discountPercent), asc(products.name)];
    if (sort === "name_asc") return [asc(products.name)];
    if (sort === "name_desc") return [desc(products.name)];

    return [desc(products.createdAt)];
}

function selectItemShape() {
    return {
        id: products.id,
        name: products.name,
        description: products.description,
        imgUrl: products.imgUrl,
        productCategory: products.productCategory,
        sellingPrice: inventory.sellingPrice,
        discountPercent: inventory.discountPercent,
        quantity: inventory.quantity,
        createdAt: products.createdAt,
    };
}

function buildCategoryItemFilters({ query, category }) {
    const filters = [];

    const isActive = toBooleanOrUndefined(query?.isActive);
    filters.push(eq(products.isActive, isActive ?? true));

    filters.push(eq(products.productCategory, category));

    const inStock = toBooleanOrUndefined(query?.inStock);
    if (inStock === true) filters.push(gt(inventory.quantity, 0));
    if (inStock === false) filters.push(lte(inventory.quantity, 0));

    const minPrice = toNumericStringOrUndefined(query?.minPrice);
    const maxPrice = toNumericStringOrUndefined(query?.maxPrice);
    if (minPrice !== undefined) filters.push(gte(inventory.sellingPrice, minPrice));
    if (maxPrice !== undefined) filters.push(lte(inventory.sellingPrice, maxPrice));

    const minDiscount = toNumericStringOrUndefined(query?.minDiscount);
    const maxDiscount = toNumericStringOrUndefined(query?.maxDiscount);
    if (minDiscount !== undefined) filters.push(gte(inventory.discountPercent, minDiscount));
    if (maxDiscount !== undefined) filters.push(lte(inventory.discountPercent, maxDiscount));

    return filters;
}

export async function listCategories(req, res, next) {
    try {
        const isActive = toBooleanOrUndefined(req.query?.isActive);

        const whereClause = and(eq(products.isActive, isActive ?? true));

        const rows = await db
            .select({
                category: products.productCategory,
                productCount: sql`count(${products.id})`,
                inStockCount: sql`sum(case when ${inventory.quantity} > 0 then 1 else 0 end)`,
            })
            .from(products)
            .innerJoin(inventory, eq(inventory.productId, products.id))
            .where(whereClause)
            .groupBy(products.productCategory);

        const counts = new Map(
            rows.map((r) => [
                r.category,
                {
                    productCount: Number(r.productCount) || 0,
                    inStockCount: Number(r.inStockCount) || 0,
                },
            ])
        );

        const categories = PRODUCT_CATEGORIES.map((c) => ({
            category: c,
            productCount: counts.get(c)?.productCount ?? 0,
            inStockCount: counts.get(c)?.inStockCount ?? 0,
        }));

        return res.json({ categories });
    } catch (err) {
        next(err);
    }
}

export async function listItemsByCategory(req, res, next) {
    try {
        const categoryParam = toStringOrUndefined(req.params?.category);
        const category = normalizeProductCategory(categoryParam);
        if (!category) return res.status(400).json({ error: "INVALID_PRODUCT_CATEGORY" });

        const orderBy = getSortFromQuery(req.query);
        const whereConditions = buildCategoryItemFilters({ query: req.query, category });
        const whereClause = whereConditions.length ? and(...whereConditions) : undefined;

        const rows = await db
            .select(selectItemShape())
            .from(products)
            .innerJoin(inventory, eq(inventory.productId, products.id))
            .where(whereClause)
            .orderBy(...orderBy);

        return res.json({ category, items: rows });
    } catch (err) {
        next(err);
    }
}

export async function listItemsByCategories(req, res, next) {
    try {
        const raw = toStringOrUndefined(req.query?.categories ?? req.query?.category);
        if (!raw) return res.status(400).json({ error: "CATEGORIES_REQUIRED" });

        const categories = raw
            .split(",")
            .map((s) => normalizeProductCategory(s))
            .filter(Boolean);

        const unique = Array.from(new Set(categories));
        if (!unique.length) return res.status(400).json({ error: "INVALID_PRODUCT_CATEGORY" });

        const orderBy = getSortFromQuery(req.query);

        const isActive = toBooleanOrUndefined(req.query?.isActive);
        const filters = [eq(products.isActive, isActive ?? true), inArray(products.productCategory, unique)];

        const inStock = toBooleanOrUndefined(req.query?.inStock);
        if (inStock === true) filters.push(gt(inventory.quantity, 0));
        if (inStock === false) filters.push(lte(inventory.quantity, 0));

        const minPrice = toNumericStringOrUndefined(req.query?.minPrice);
        const maxPrice = toNumericStringOrUndefined(req.query?.maxPrice);
        if (minPrice !== undefined) filters.push(gte(inventory.sellingPrice, minPrice));
        if (maxPrice !== undefined) filters.push(lte(inventory.sellingPrice, maxPrice));

        const minDiscount = toNumericStringOrUndefined(req.query?.minDiscount);
        const maxDiscount = toNumericStringOrUndefined(req.query?.maxDiscount);
        if (minDiscount !== undefined) filters.push(gte(inventory.discountPercent, minDiscount));
        if (maxDiscount !== undefined) filters.push(lte(inventory.discountPercent, maxDiscount));

        const whereClause = filters.length ? and(...filters) : undefined;

        const rows = await db
            .select(selectItemShape())
            .from(products)
            .innerJoin(inventory, eq(inventory.productId, products.id))
            .where(whereClause)
            .orderBy(...orderBy);

        return res.json({ categories: unique, items: rows });
    } catch (err) {
        next(err);
    }
}
