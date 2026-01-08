import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";

import { db } from "../../db/index.js";
import { admins, adminRoles } from "../../db/schema.js";
import { isPgUniqueViolation, toStringOrUndefined } from "../../utils/common.js";

const DEFAULT_ROLES = ["ADMIN"];

function normalizeRoles(value) {
    if (value === undefined || value === null) return undefined;
    if (!Array.isArray(value)) return null;
    const roles = value.map((r) => String(r).trim()).filter(Boolean);
    return roles;
}

function groupAdminsWithRoles(rows) {
    const byId = new Map();
    for (const row of rows) {
        const id = row.id;
        if (!byId.has(id)) {
            byId.set(id, {
                id,
                name: row.name,
                email: row.email,
                createdAt: row.createdAt,
                roles: [],
            });
        }
        if (row.role) byId.get(id).roles.push(row.role);
    }
    return Array.from(byId.values());
}

async function hashPassword(password) {
    const rounds = Number(env.BCRYPT_ROUNDS || 10);
    return bcrypt.hash(password, rounds);
}

export async function createAdmin(req, res, next) {
    try {
        const name = toStringOrUndefined(req.body?.name);
        const email = toStringOrUndefined(req.body?.email);
        const password = toStringOrUndefined(req.body?.password);
        const rolesInput = normalizeRoles(req.body?.roles);

        if (!name || !email || !password) {
            return res.status(400).json({ error: "NAME_EMAIL_PASSWORD_REQUIRED" });
        }
        if (rolesInput === null) {
            return res.status(400).json({ error: "ROLES_MUST_BE_ARRAY" });
        }

        const roles = rolesInput && rolesInput.length ? rolesInput : DEFAULT_ROLES;

        const passwordHash = await hashPassword(password);

        const created = await db.transaction(async (tx) => {
            const inserted = await tx
                .insert(admins)
                .values({
                    name,
                    email,
                    passwordHash,
                })
                .returning({
                    id: admins.id,
                    name: admins.name,
                    email: admins.email,
                    createdAt: admins.createdAt,
                });

            const admin = inserted[0];
            if (!admin) throw new Error("FAILED_TO_CREATE_ADMIN");

            if (roles.length) {
                await tx.insert(adminRoles).values(
                    roles.map((role) => ({
                        adminId: admin.id,
                        role,
                    }))
                );
            }

            return { ...admin, roles };
        });

        return res.status(201).json({ admin: created });
    } catch (err) {
        if (isPgUniqueViolation(err)) {
            return res.status(409).json({ error: "ADMIN_ALREADY_EXISTS" });
        }
        next(err);
    }
}

export async function listAdmins(req, res, next) {
    try {
        const rows = await db
            .select({
                id: admins.id,
                name: admins.name,
                email: admins.email,
                createdAt: admins.createdAt,
                role: adminRoles.role,
            })
            .from(admins)
            .leftJoin(adminRoles, eq(adminRoles.adminId, admins.id));

        return res.json({ admins: groupAdminsWithRoles(rows) });
    } catch (err) {
        next(err);
    }
}

export async function getAdminById(req, res, next) {
    try {
        const adminId = toStringOrUndefined(req.params?.adminId);
        if (!adminId) return res.status(400).json({ error: "ADMIN_ID_REQUIRED" });

        const rows = await db
            .select({
                id: admins.id,
                name: admins.name,
                email: admins.email,
                createdAt: admins.createdAt,
                role: adminRoles.role,
            })
            .from(admins)
            .leftJoin(adminRoles, eq(adminRoles.adminId, admins.id))
            .where(eq(admins.id, adminId));

        const admin = groupAdminsWithRoles(rows)[0];
        if (!admin) return res.status(404).json({ error: "ADMIN_NOT_FOUND" });

        return res.json({ admin });
    } catch (err) {
        next(err);
    }
}

export async function updateAdmin(req, res, next) {
    try {
        const adminId = toStringOrUndefined(req.params?.adminId);
        if (!adminId) return res.status(400).json({ error: "ADMIN_ID_REQUIRED" });

        const name = toStringOrUndefined(req.body?.name);
        const email = toStringOrUndefined(req.body?.email);
        const password = toStringOrUndefined(req.body?.password);
        const rolesInput = normalizeRoles(req.body?.roles);

        if (rolesInput === null) {
            return res.status(400).json({ error: "ROLES_MUST_BE_ARRAY" });
        }

        if (!name && !email && !password && rolesInput === undefined) {
            return res.status(400).json({ error: "NOTHING_TO_UPDATE" });
        }

        const updated = await db.transaction(async (tx) => {
            const updateValues = {};
            if (name) updateValues.name = name;
            if (email) updateValues.email = email;
            if (password) updateValues.passwordHash = await hashPassword(password);

            if (Object.keys(updateValues).length) {
                const updatedRows = await tx
                    .update(admins)
                    .set(updateValues)
                    .where(eq(admins.id, adminId))
                    .returning({
                        id: admins.id,
                        name: admins.name,
                        email: admins.email,
                        createdAt: admins.createdAt,
                    });
                if (!updatedRows[0]) return null;
            } else {
                const exists = await tx
                    .select({ id: admins.id })
                    .from(admins)
                    .where(eq(admins.id, adminId))
                    .limit(1);
                if (!exists[0]) return null;
            }

            if (rolesInput !== undefined) {
                await tx.delete(adminRoles).where(eq(adminRoles.adminId, adminId));
                const roles = rolesInput;
                if (roles.length) {
                    await tx.insert(adminRoles).values(
                        roles.map((role) => ({
                            adminId,
                            role,
                        }))
                    );
                }
            }

            const rows = await tx
                .select({
                    id: admins.id,
                    name: admins.name,
                    email: admins.email,
                    createdAt: admins.createdAt,
                    role: adminRoles.role,
                })
                .from(admins)
                .leftJoin(adminRoles, eq(adminRoles.adminId, admins.id))
                .where(eq(admins.id, adminId));

            return groupAdminsWithRoles(rows)[0] || null;
        });

        if (!updated) return res.status(404).json({ error: "ADMIN_NOT_FOUND" });
        return res.json({ admin: updated });
    } catch (err) {
        if (isPgUniqueViolation(err)) {
            return res.status(409).json({ error: "ADMIN_ALREADY_EXISTS" });
        }
        next(err);
    }
}

export async function deleteAdmin(req, res, next) {
    try {
        const adminId = toStringOrUndefined(req.params?.adminId);
        if (!adminId) return res.status(400).json({ error: "ADMIN_ID_REQUIRED" });

        const deleted = await db
            .delete(admins)
            .where(eq(admins.id, adminId))
            .returning({ id: admins.id });

        if (!deleted[0]) return res.status(404).json({ error: "ADMIN_NOT_FOUND" });

        return res.status(204).send();
    } catch (err) {
        next(err);
    }
}
