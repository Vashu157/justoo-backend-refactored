import { pgEnum } from "drizzle-orm/pg-core";

export const adminRoleEnum = pgEnum("admin_role", [
  "SUPERADMIN",
  "ADMIN",
  "INVENTORY_VIEWER",
]);

export const productCategoryEnum = pgEnum("product_category", [
  "Beauty",
  "Electronics",
  "Kids",
  "Kitchen",
  "Snacks",
  "Drinks",
  "Household",
  "Pharma",
  "others",
]);

export const orderStatusEnum = pgEnum("order_status", [
  "CREATED",
  "ASSIGNED_RIDER",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "CANCELLED",
  "REFUNDED",
]);

export const paymentStatusEnum = pgEnum("payment_status", [
  "INITIATED",
  "SUCCESS",
  "FAILED",
  "REFUNDED",
]);

export const inventoryMovementReasonEnum = pgEnum("inventory_movement_reason", [
  "INITIAL_STOCK",
  "PURCHASE",
  "ADJUSTMENT",
  "ORDER_CANCELLED",
]);

export const inventoryMovementReferenceTypeEnum = pgEnum(
  "inventory_movement_reference_type",
  ["ORDER", "PURCHASE", "ADJUSTMENT"]
);

export const inventoryMovementActorTypeEnum = pgEnum(
  "inventory_movement_actor_type",
  ["ADMIN", "SYSTEM"]
);

import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  text,
  boolean,
} from "drizzle-orm/pg-core";

export const admins = pgTable("admins", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const adminRoles = pgTable("admin_roles", {
  adminId: uuid("admin_id")
    .references(() => admins.id, { onDelete: "cascade" })
    .notNull(),
  role: adminRoleEnum("role").notNull(),
});


export const customers = pgTable("customers", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  phone: varchar("phone", { length: 20 }).notNull().unique(),
  email: varchar("email", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const customerSessions = pgTable("customer_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  customerId: uuid("customer_id")
    .references(() => customers.id, { onDelete: "cascade" })
    .notNull(),
  tokenHash: varchar("token_hash", { length: 255 }).notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const customerOtps = pgTable("customer_otps", {
  id: uuid("id").defaultRandom().primaryKey(),
  phone: varchar("phone", { length: 20 }).notNull().unique(),
  otpHash: varchar("otp_hash", { length: 255 }).notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  used: boolean("used").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});


export const addresses = pgTable("addresses", {
  id: uuid("id").defaultRandom().primaryKey(),
  customerId: uuid("customer_id")
    .references(() => customers.id, { onDelete: "cascade" })
    .notNull(),
  label: varchar("label", { length: 50 }), // hostel, library, lab
  line1: varchar("line1", { length: 255 }).notNull(),
  line2: varchar("line2", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});


import { numeric, integer } from "drizzle-orm/pg-core";

export const products = pgTable("products", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 150 }).notNull(),
  description: varchar("description", { length: 500 }),
  imgUrl: varchar("img_url", { length: 255 }),
  productCategory: productCategoryEnum("product_category")
    .default("others")
    .notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});


export const inventory = pgTable("inventory", {
  productId: uuid("product_id")
    .references(() => products.id, { onDelete: "cascade" })
    .primaryKey(),

  costPrice: numeric("cost_price", { precision: 10, scale: 2 }).notNull(),
  sellingPrice: numeric("selling_price", { precision: 10, scale: 2 }).notNull(),
  discountPercent: numeric("discount_percent", { precision: 5, scale: 2 })
    .default("0"),

  quantity: integer("quantity").notNull(),
  minQuantity: integer("min_quantity").default(0).notNull(),

  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});


export const inventoryMovements = pgTable("inventory_movements", {
  id: uuid("id").defaultRandom().primaryKey(),

  productId: uuid("product_id")
    .references(() => products.id, { onDelete: "cascade" })
    .notNull(),

  deltaQuantity: integer("delta_quantity").notNull(),

  reason: inventoryMovementReasonEnum("reason").notNull(),

  referenceType: inventoryMovementReferenceTypeEnum("reference_type"),
  referenceId: uuid("reference_id"),

  actorType: inventoryMovementActorTypeEnum("actor_type").notNull(),
  actorId: uuid("actor_id"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
});


export const orders = pgTable("orders", {
  id: uuid("id").defaultRandom().primaryKey(),

  customerId: uuid("customer_id")
    .references(() => customers.id)
    .notNull(),

  status: orderStatusEnum("status").default("CREATED").notNull(),

  deliveryFee: numeric("delivery_fee", { precision: 10, scale: 2 })
    .default("0")
    .notNull(),

  subtotalAmount: numeric("subtotal_amount", { precision: 10, scale: 2 })
    .notNull(),

  totalAmount: numeric("total_amount", { precision: 10, scale: 2 }).notNull(),

  createdAt: timestamp("created_at").defaultNow().notNull(),
});


export const orderItems = pgTable("order_items", {
  id: uuid("id").defaultRandom().primaryKey(),

  orderId: uuid("order_id")
    .references(() => orders.id, { onDelete: "cascade" })
    .notNull(),

  productId: uuid("product_id")
    .references(() => products.id)
    .notNull(),

  quantity: integer("quantity").notNull(),

  unitPrice: numeric("unit_price", { precision: 10, scale: 2 }).notNull(),
  discountPercent: numeric("discount_percent", {
    precision: 5,
    scale: 2,
  }).default("0"),

  finalPrice: numeric("final_price", { precision: 10, scale: 2 }).notNull(),
});


export const orderAddresses = pgTable("order_addresses", {
  orderId: uuid("order_id")
    .references(() => orders.id, { onDelete: "cascade" })
    .primaryKey(),

  label: varchar("label", { length: 50 }),
  line1: varchar("line1", { length: 255 }).notNull(),
  line2: varchar("line2", { length: 255 }),
});


export const riders = pgTable("riders", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  phone: varchar("phone", { length: 20 }).notNull().unique(),
  username: varchar("username", { length: 50 }).notNull().unique(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});


export const riderSessions = pgTable("rider_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  riderId: uuid("rider_id")
    .references(() => riders.id, { onDelete: "cascade" })
    .notNull(),
  tokenHash: varchar("token_hash", { length: 255 }).notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});


export const riderAssignments = pgTable("rider_assignments", {
  orderId: uuid("order_id")
    .references(() => orders.id, { onDelete: "cascade" })
    .primaryKey(),

  riderId: uuid("rider_id")
    .references(() => riders.id)
    .notNull(),

  assignedAt: timestamp("assigned_at").defaultNow().notNull(),
});


export const payments = pgTable("payments", {
  id: uuid("id").defaultRandom().primaryKey(),

  orderId: uuid("order_id")
    .references(() => orders.id)
    .notNull(),

  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  status: paymentStatusEnum("status").notNull(),

  provider: varchar("provider", { length: 50 }), // UPI, COD, etc
  providerRef: varchar("provider_ref", { length: 255 }),

  createdAt: timestamp("created_at").defaultNow().notNull(),
});


export const phoneWhitelist = pgTable("phone_whitelist", {
  phone: varchar("phone", { length: 20 }).primaryKey(),
  addedByAdminId: uuid("added_by_admin_id")
    .references(() => admins.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const orderActorTypeEnum = pgEnum("order_actor_type", [
  "ADMIN",
  "RIDER",
  "CUSTOMER",
  "SYSTEM",
]);

export const orderEvents = pgTable("order_events", {
  id: uuid("id").defaultRandom().primaryKey(),

  orderId: uuid("order_id")
    .references(() => orders.id, { onDelete: "cascade" })
    .notNull(),

  fromStatus: orderStatusEnum("from_status").notNull(),
  toStatus: orderStatusEnum("to_status").notNull(),

  actorType: orderActorTypeEnum("actor_type").notNull(),
  actorId: uuid("actor_id"),

  reason: text("reason"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
});

