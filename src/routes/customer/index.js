import { Router } from "express";

import authRoutes from "./auth.routes.js";
import profileRoutes from "./profile.routes.js";
import addressRoutes from "./address.routes.js";
import orderRoutes from "./order.routes.js";
import itemsRoutes from "./items.routes.js";
import categoriesRoutes from "./categories.routes.js";

const router = Router();

router.use("/auth", authRoutes);
router.use("/items", itemsRoutes);
router.use("/categories", categoriesRoutes);
router.use(profileRoutes);
router.use("/addresses", addressRoutes);
router.use("/orders", orderRoutes);

export default router;
