import { eq } from "drizzle-orm";

import { db } from "../../db/index.js";
import { products } from "../../db/schema.js";
import { uploadImageBuffer } from "../../utils/cloudinary.js";
import { toBooleanOrUndefined, toStringOrUndefined } from "../../utils/common.js";

const PRODUCT_CATEGORIES = [
    "Beauty",
    "Electronics",
    "Kids",
    "Kitchen",
    "Snacks",
    "Drinks",
    "Household",
    "Pharma",
    "others",
];

function normalizeProductCategory(value) {
    const raw = toStringOrUndefined(value);
    if (!raw) return undefined;
    const hit = PRODUCT_CATEGORIES.find((c) => c.toLowerCase() === raw.trim().toLowerCase());
    return hit;
}

async function maybeUploadProductImage(req, productId) {
    const file = req.file;
    if (!file?.buffer) return undefined;

    const { url } = await uploadImageBuffer(file.buffer, {
        folder: "justoo/products",
        publicId: productId ? `product_${productId}` : undefined,
    });
    return url;
}

export async function createProduct(req, res, next) {
    try {
        const name = toStringOrUndefined(req.body?.name);
        const description = toStringOrUndefined(req.body?.description);
        const isActive = toBooleanOrUndefined(req.body?.isActive);
        const productCategory =
            normalizeProductCategory(req.body?.productCategory ?? req.body?.product_category ?? req.body?.category) ??
            "others";

        if (!PRODUCT_CATEGORIES.includes(productCategory)) {
            return res.status(400).json({ error: "INVALID_PRODUCT_CATEGORY" });
        }

        if (!name) {
            return res.status(400).json({ error: "NAME_REQUIRED" });
        }

        const created = await db.transaction(async (tx) => {
            const insertedRows = await tx
                .insert(products)
                .values({
                    name,
                    description,
                    productCategory,
                    isActive: isActive ?? true,
                })
                .returning({
                    id: products.id,
                    name: products.name,
                    description: products.description,
                    imgUrl: products.imgUrl,
                    productCategory: products.productCategory,
                    isActive: products.isActive,
                    createdAt: products.createdAt,
                });

            const product = insertedRows[0];
            if (!product) throw new Error("FAILED_TO_CREATE_PRODUCT");

            const imgUrl = await maybeUploadProductImage(req, product.id);
            if (imgUrl) {
                const updated = await tx
                    .update(products)
                    .set({ imgUrl })
                    .where(eq(products.id, product.id))
                    .returning({
                        id: products.id,
                        name: products.name,
                        description: products.description,
                        imgUrl: products.imgUrl,
                        productCategory: products.productCategory,
                        isActive: products.isActive,
                        createdAt: products.createdAt,
                    });
                return updated[0];
            }

            return product;
        });

        return res.status(201).json({ product: created });
    } catch (err) {
        next(err);
    }
}

export async function listProducts(req, res, next) {
    try {
        const rows = await db
            .select({
                id: products.id,
                name: products.name,
                description: products.description,
                imgUrl: products.imgUrl,
                productCategory: products.productCategory,
                isActive: products.isActive,
                createdAt: products.createdAt,
            })
            .from(products);

        return res.json({ products: rows });
    } catch (err) {
        next(err);
    }
}

export async function getProductById(req, res, next) {
    try {
        const productId = toStringOrUndefined(req.params?.productId);
        if (!productId) return res.status(400).json({ error: "PRODUCT_ID_REQUIRED" });

        const rows = await db
            .select({
                id: products.id,
                name: products.name,
                description: products.description,
                imgUrl: products.imgUrl,
                productCategory: products.productCategory,
                isActive: products.isActive,
                createdAt: products.createdAt,
            })
            .from(products)
            .where(eq(products.id, productId))
            .limit(1);

        const product = rows[0];
        if (!product) return res.status(404).json({ error: "PRODUCT_NOT_FOUND" });

        return res.json({ product });
    } catch (err) {
        next(err);
    }
}

export async function updateProduct(req, res, next) {
    try {
        const productId = toStringOrUndefined(req.params?.productId);
        if (!productId) return res.status(400).json({ error: "PRODUCT_ID_REQUIRED" });

        const name = toStringOrUndefined(req.body?.name);
        const description = toStringOrUndefined(req.body?.description);
        const isActive = toBooleanOrUndefined(req.body?.isActive);
        const productCategory = normalizeProductCategory(
            req.body?.productCategory ?? req.body?.product_category ?? req.body?.category
        );

        const imgUrl = await maybeUploadProductImage(req, productId);

        if (
            !name &&
            description === undefined &&
            isActive === undefined &&
            imgUrl === undefined &&
            productCategory === undefined
        ) {
            return res.status(400).json({ error: "NOTHING_TO_UPDATE" });
        }

        if (productCategory !== undefined && !PRODUCT_CATEGORIES.includes(productCategory)) {
            return res.status(400).json({ error: "INVALID_PRODUCT_CATEGORY" });
        }

        const updateValues = {};
        if (name) updateValues.name = name;
        if (description !== undefined) updateValues.description = description;
        if (isActive !== undefined) updateValues.isActive = isActive;
        if (imgUrl !== undefined) updateValues.imgUrl = imgUrl;
        if (productCategory !== undefined) updateValues.productCategory = productCategory;

        const updated = await db
            .update(products)
            .set(updateValues)
            .where(eq(products.id, productId))
            .returning({
                id: products.id,
                name: products.name,
                description: products.description,
                imgUrl: products.imgUrl,
                productCategory: products.productCategory,
                isActive: products.isActive,
                createdAt: products.createdAt,
            });

        if (!updated[0]) return res.status(404).json({ error: "PRODUCT_NOT_FOUND" });
        return res.json({ product: updated[0] });
    } catch (err) {
        next(err);
    }
}

export async function deleteProduct(req, res, next) {
    try {
        const productId = toStringOrUndefined(req.params?.productId);
        if (!productId) return res.status(400).json({ error: "PRODUCT_ID_REQUIRED" });

        const deleted = await db
            .delete(products)
            .where(eq(products.id, productId))
            .returning({ id: products.id });

        if (!deleted[0]) return res.status(404).json({ error: "PRODUCT_NOT_FOUND" });
        return res.status(204).send();
    } catch (err) {
        next(err);
    }
}
