import "dotenv/config";
import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";

import { db } from "../db/index.js";
import { admins, adminRoles } from "../db/schema.js";

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
    const email =
        readArg("email") ||
        env.SUPERADMIN_EMAIL ||
        env.ADMIN_EMAIL;
    const password =
        readArg("password") ||
        env.SUPERADMIN_PASSWORD ||
        env.ADMIN_PASSWORD;
    const name =
        readArg("name") ||
        env.SUPERADMIN_NAME ||
        env.ADMIN_NAME ||
        "Super Admin";

    required(env.DATABASE_URL, "DATABASE_URL");
    required(email, "email");
    required(password, "password");

    const passwordHash = await hashPassword(password);

    const result = await db.transaction(async (tx) => {
        const existing = await tx
            .select({ id: admins.id, email: admins.email })
            .from(admins)
            .where(eq(admins.email, email))
            .limit(1);

        if (!existing[0]) {
            const inserted = await tx
                .insert(admins)
                .values({
                    name,
                    email,
                    passwordHash,
                })
                .returning({ id: admins.id, email: admins.email, name: admins.name });

            const admin = inserted[0];
            if (!admin) throw new Error("FAILED_TO_CREATE_ADMIN");

            await tx.insert(adminRoles).values({
                adminId: admin.id,
                role: "SUPERADMIN",
            });

            return { created: true, adminId: admin.id };
        }

        const adminId = existing[0].id;

        await tx
            .update(admins)
            .set({
                name,
                passwordHash,
            })
            .where(eq(admins.id, adminId));

        const already = await tx
            .select({ role: adminRoles.role })
            .from(adminRoles)
            .where(and(eq(adminRoles.adminId, adminId), eq(adminRoles.role, "SUPERADMIN")))
            .limit(1);

        if (!already[0]) {
            await tx.insert(adminRoles).values({ adminId, role: "SUPERADMIN" });
        }

        return { created: false, adminId };
    });

    console.log(
        result.created
            ? `Created SUPERADMIN (${email}) id=${result.adminId}`
            : `Updated SUPERADMIN (${email}) id=${result.adminId}`
    );
}

main().catch((err) => {
    console.error(err?.message || err);
    process.exitCode = 1;
});

