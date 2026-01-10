import { Router } from "express";

import {
    listCategories,
    listItemsByCategories,
    listItemsByCategory,
} from "../../controllers/customer/categories.controller.js";

const router = Router();

// List all categories (with product counts)
router.get("/", listCategories);

// Get items for a single category
router.get("/:category/items", listItemsByCategory);

// Get items for multiple categories (comma separated)
router.get("/items", listItemsByCategories);

export default router;
