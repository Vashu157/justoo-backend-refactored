import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";

import { db } from "../../db/index.js";
import { admins, adminRoles } from "../../db/schema.js";

import { toTrimmedString } from "../../utils/common.js";

export async function loginAdmin(req, res, next) {
    try {
        const email = toTrimmedString(req.body?.email);
        const password = String(req.body?.password || "");

        if (!email || !password) {
            return res.status(400).json({ error: "EMAIL_AND_PASSWORD_REQUIRED" });
        }

        const adminRows = await db
            .select({
                id: admins.id,
                name: admins.name,
                email: admins.email,
                passwordHash: admins.passwordHash,
            })
            .from(admins)
            .where(eq(admins.email, email))
            .limit(1);

        const admin = adminRows[0];
        if (!admin) {
            return res.status(401).json({ error: "INVALID_CREDENTIALS" });
        }

        const ok = await bcrypt.compare(password, admin.passwordHash);
        if (!ok) {
            return res.status(401).json({ error: "INVALID_CREDENTIALS" });
        }

        const roleRows = await db
            .select({ role: adminRoles.role })
            .from(adminRoles)
            .where(eq(adminRoles.adminId, admin.id));

        req.session.adminId = admin.id;

        return res.json({
            admin: {
                id: admin.id,
                name: admin.name,
                email: admin.email,
                roles: roleRows.map((r) => r.role),
            },
        });
    } catch (err) {
        next(err);
    }
}

export async function logoutAdmin(req, res, next) {
    try {
        const cookieName = env.SESSION_COOKIE_NAME || "justoo.sid";

        if (!req.session) {
            res.clearCookie(cookieName);
            return res.status(204).send();
        }

        await new Promise((resolve, reject) => {
            req.session.destroy((err) => {
                if (err) return reject(err);
                resolve();
            });
        });

        res.clearCookie(cookieName);
        return res.status(204).send();
    } catch (err) {
        next(err);
    }
}

export async function getAdminMe(req, res, next) {
    try {
        if (!req.session?.adminId) {
            return res.status(401).json({ error: "ADMIN_UNAUTHENTICATED" });
        }

        const adminId = req.admin?.id || req.session.adminId;

        const adminRows = await db
            .select({
                id: admins.id,
                name: admins.name,
                email: admins.email,
                createdAt: admins.createdAt,
            })
            .from(admins)
            .where(eq(admins.id, adminId))
            .limit(1);

        const admin = adminRows[0];
        if (!admin) {
            req.session.adminId = undefined;
            return res.status(401).json({ error: "ADMIN_UNAUTHENTICATED" });
        }

        const roleRows = await db
            .select({ role: adminRoles.role })
            .from(adminRoles)
            .where(eq(adminRoles.adminId, admin.id));

        return res.json({
            admin: {
                ...admin,
                roles: roleRows.map((r) => r.role),
            },
        });
    } catch (err) {
        next(err);
    }
}
