import "dotenv/config";

function required(value, name) {
    if (value === undefined || value === null || String(value).trim() === "") {
        throw new Error(`${name} is not defined`);
    }
    return String(value);
}

function optional(value, fallback = undefined) {
    if (value === undefined || value === null || String(value).trim() === "") return fallback;
    return String(value);
}

function bool(value, fallback = false) {
    const v = optional(value, undefined);
    if (v === undefined) return fallback;
    const s = v.trim().toLowerCase();
    if (["true", "1", "yes"].includes(s)) return true;
    if (["false", "0", "no"].includes(s)) return false;
    return fallback;
}

function number(value, fallback) {
    const v = optional(value, undefined);
    if (v === undefined) return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

export const env = {
    DATABASE_URL: required(process.env.DATABASE_URL, "DATABASE_URL"),

    PORT: number(process.env.PORT, 4000),
    NODE_ENV: optional(process.env.NODE_ENV, "development"),
    FRONTEND_ORIGIN: optional(process.env.FRONTEND_ORIGIN, undefined),

    SESSION_SECRET: optional(process.env.SESSION_SECRET, "dev-session-secret"),
    SESSION_COOKIE_NAME: optional(process.env.SESSION_COOKIE_NAME, "justoo.sid"),
    SESSION_TABLE_NAME: optional(process.env.SESSION_TABLE_NAME, "user_sessions"),
    SESSION_SAMESITE: optional(process.env.SESSION_SAMESITE, "lax"),
    SESSION_COOKIE_SECURE: bool(process.env.SESSION_COOKIE_SECURE, false),

    CUSTOMER_OTP_TTL_MS: number(process.env.CUSTOMER_OTP_TTL_MS, 1000 * 60 * 5),
    CUSTOMER_JWT_TTL: optional(process.env.CUSTOMER_JWT_TTL, "7d"),
    CUSTOMER_JWT_SECRET: optional(process.env.CUSTOMER_JWT_SECRET, "dev-customer-jwt-secret"),

    RIDER_JWT_TTL: optional(process.env.RIDER_JWT_TTL, "1d"),
    RIDER_JWT_SECRET: optional(process.env.RIDER_JWT_SECRET, "dev-rider-jwt-secret"),

    BCRYPT_ROUNDS: number(process.env.BCRYPT_ROUNDS, 10),

    SUPERADMIN_EMAIL: optional(process.env.SUPERADMIN_EMAIL, optional(process.env.ADMIN_EMAIL, undefined)),
    SUPERADMIN_PASSWORD: optional(
        process.env.SUPERADMIN_PASSWORD,
        optional(process.env.ADMIN_PASSWORD, undefined)
    ),
    SUPERADMIN_NAME: optional(process.env.SUPERADMIN_NAME, optional(process.env.ADMIN_NAME, undefined)),

    CLOUDINARY_CLOUD_NAME: optional(process.env.CLOUDINARY_CLOUD_NAME, undefined),
    CLOUDINARY_API_KEY: optional(process.env.CLOUDINARY_API_KEY, undefined),
    CLOUDINARY_API_SECRET: optional(process.env.CLOUDINARY_API_SECRET, undefined),
};

export const isProd = env.NODE_ENV === "production";
