export const PRODUCT_CATEGORIES = [
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

export function normalizeProductCategory(value) {
    if (value === undefined || value === null) return undefined;
    const raw = String(value).trim();
    if (!raw) return undefined;
    return PRODUCT_CATEGORIES.find((c) => c.toLowerCase() === raw.toLowerCase());
}

export function normalizeProductCategories(value) {
    if (value === undefined || value === null) return undefined;
    const raw = String(value).trim();
    if (!raw) return undefined;

    const parts = raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

    const normalized = parts
        .map(normalizeProductCategory)
        .filter(Boolean);

    return normalized.length ? Array.from(new Set(normalized)) : undefined;
}
