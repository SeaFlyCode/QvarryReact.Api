import express from "express";
import {
    handleCreatePoint,
    handleGetAllPointsByUserId,
    handleSearchPoints,
    handleGetPointById,
    handleDeletePoint,
    handleUpdatePoint,
} from "../controllers/pointsControllers"
import { authMiddleware } from "../middlewares/authMiddleware";

const router = express.Router();

router.post("/", authMiddleware, handleCreatePoint);
router.get("/search", authMiddleware, handleSearchPoints);
router.get("/", authMiddleware , handleGetAllPointsByUserId);
router.get("/user", authMiddleware, handleGetAllPointsByUserId);
router.get("/:id", authMiddleware, handleGetPointById);
router.delete("/:id", authMiddleware, handleDeletePoint);
router.put("/:id", authMiddleware, handleUpdatePoint);

export default router;