import "dotenv/config";
import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";

import { db } from "../db/index.js";
import { admins, adminRoles } from "../db/schema.js";
import { env } from "../config/env.js";

const ADMIN_ROLES = ["ADMIN", "INVENTORY_VIEWER", "SUPERADMIN"];

function readArg(flag) {
    const prefix = `--${flag}=`;
    const hit = process.argv.find((a) => a.startsWith(prefix));
    if (!hit) return undefined;
    const value = hit.slice(prefix.length).trim();
    return value.length ? value : undefined;
}

function required(value, name) {
    if (!value) throw new Error(`${name} is required`);
    return value;
}

async function hashPassword(password) {
    const rounds = Number(env.BCRYPT_ROUNDS || 10);
    return bcrypt.hash(password, rounds);
}

async function main() {
    const email = readArg("email") || env.ADMIN_EMAIL || env.SUPERADMIN_EMAIL;
    const password = readArg("password") || env.ADMIN_PASSWORD || env.SUPERADMIN_PASSWORD;
    const name = readArg("name") || env.ADMIN_NAME || env.SUPERADMIN_NAME || "Admin";

    const roleRaw = readArg("role") || "ADMIN";
    const role = ADMIN_ROLES.find((r) => r.toLowerCase() === String(roleRaw).toLowerCase());

    required(env.DATABASE_URL, "DATABASE_URL");
    required(email, "email");
    required(password, "password");
    if (!role) throw new Error(`role must be one of: ${ADMIN_ROLES.join(", ")}`);

    const passwordHash = await hashPassword(password);

    const result = await db.transaction(async (tx) => {
        const existing = await tx
            .select({ id: admins.id, email: admins.email })
            .from(admins)
            .where(eq(admins.email, email))
            .limit(1);

        let adminId;
        let created;

        if (!existing[0]) {
            const inserted = await tx
                .insert(admins)
                .values({
                    name,
                    email,
                    passwordHash,
                })
                .returning({ id: admins.id });

            const admin = inserted[0];
            if (!admin) throw new Error("FAILED_TO_CREATE_ADMIN");

            adminId = admin.id;
            created = true;
        } else {
            adminId = existing[0].id;
            created = false;

            await tx
                .update(admins)
                .set({
                    name,
                    passwordHash,
                })
                .where(eq(admins.id, adminId));
        }

        const already = await tx
            .select({ role: adminRoles.role })
            .from(adminRoles)
            .where(and(eq(adminRoles.adminId, adminId), eq(adminRoles.role, role)))
            .limit(1);

        if (!already[0]) {
            await tx.insert(adminRoles).values({ adminId, role });
        }

        return { created, adminId, role };
    });

    console.log(
        result.created
            ? `Created ADMIN (${email}) id=${result.adminId} role=${result.role}`
            : `Updated ADMIN (${email}) id=${result.adminId} role=${result.role}`
    );
}

main().catch((err) => {
    console.error(err?.message || err);
    process.exitCode = 1;
});
