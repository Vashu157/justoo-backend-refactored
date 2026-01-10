import {
    and,
    asc,
    desc,
    eq,
    gt,
    gte,
    inArray,
    ilike,
    lte,
    or,
} from "drizzle-orm";

import { db } from "../../db/index.js";
import { inventory, products } from "../../db/schema.js";
import {
    toBooleanOrUndefined,
    toNumericStringOrUndefined,
    toStringOrUndefined,
} from "../../utils/common.js";
import { normalizeProductCategories } from "../../utils/productCategories.js";

function getSortFromQuery(query) {
    const sort = toStringOrUndefined(query?.sort)?.toLowerCase();

    // Default: newest first
    if (!sort || sort === "newest") return [desc(products.createdAt)];

    if (sort === "price_asc") return [asc(inventory.sellingPrice), asc(products.name)];
    if (sort === "price_desc") return [desc(inventory.sellingPrice), asc(products.name)];
    if (sort === "discount_desc") return [desc(inventory.discountPercent), asc(products.name)];
    if (sort === "name_asc") return [asc(products.name)];
    if (sort === "name_desc") return [desc(products.name)];

    // Fallback
    return [desc(products.createdAt)];
}

function buildItemFilters({ query, includeSearch }) {
    const filters = [];

    // For customer-facing listing, default to active products only.
    const isActive = toBooleanOrUndefined(query?.isActive);
    filters.push(eq(products.isActive, isActive ?? true));

    const inStock = toBooleanOrUndefined(query?.inStock);
    if (inStock === true) filters.push(gt(inventory.quantity, 0));
    if (inStock === false) filters.push(lte(inventory.quantity, 0));

    const minPrice = toNumericStringOrUndefined(query?.minPrice);
    const maxPrice = toNumericStringOrUndefined(query?.maxPrice);
    if (minPrice !== undefined) filters.push(gte(inventory.sellingPrice, minPrice));
    if (maxPrice !== undefined) filters.push(lte(inventory.sellingPrice, maxPrice));

    const minDiscount = toNumericStringOrUndefined(query?.minDiscount);
    const maxDiscount = toNumericStringOrUndefined(query?.maxDiscount);
    if (minDiscount !== undefined)
        filters.push(gte(inventory.discountPercent, minDiscount));
    if (maxDiscount !== undefined)
        filters.push(lte(inventory.discountPercent, maxDiscount));

    const categories = normalizeProductCategories(
        query?.category ?? query?.productCategory ?? query?.product_category
    );
    if (categories?.length) {
        filters.push(inArray(products.productCategory, categories));
    }

    if (includeSearch) {
        const q = toStringOrUndefined(query?.q);
        if (q) {
            const pattern = `%${q}%`;
            filters.push(or(ilike(products.name, pattern), ilike(products.description, pattern)));
        }
    }

    return filters;
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
    };
}

export async function listItems(req, res, next) {
    try {
        const orderBy = getSortFromQuery(req.query);

        const whereConditions = buildItemFilters({ query: req.query, includeSearch: false });
        const whereClause = whereConditions.length ? and(...whereConditions) : undefined;

        const rows = await db
            .select(selectItemShape())
            .from(products)
            .innerJoin(inventory, eq(inventory.productId, products.id))
            .where(whereClause)
            .orderBy(...orderBy)
            ;

        return res.json({
            items: rows,
        });
    } catch (err) {
        next(err);
    }
}

export async function searchItems(req, res, next) {
    try {
        const q = toStringOrUndefined(req.query?.q);
        if (!q) return res.status(400).json({ error: "QUERY_REQUIRED" });
        if (q.length < 2) return res.status(400).json({ error: "QUERY_TOO_SHORT" });
        const orderBy = getSortFromQuery(req.query);

        const whereConditions = buildItemFilters({ query: req.query, includeSearch: true });
        const whereClause = whereConditions.length ? and(...whereConditions) : undefined;

        const rows = await db
            .select(selectItemShape())
            .from(products)
            .innerJoin(inventory, eq(inventory.productId, products.id))
            .where(whereClause)
            .orderBy(...orderBy)
            ;

        return res.json({
            items: rows,
            q,
        });
    } catch (err) {
        next(err);
    }
}
