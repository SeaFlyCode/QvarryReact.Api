import express from "express";
import {
  listPlans,
  createPlan,
  getPlanFile,
  updatePlan,
  deletePlan,
} from "../controllers/plansController";
import { authMiddleware } from "../middlewares/authMiddleware";
import { appCheckMiddleware } from "../middlewares/appCheckMiddleware";
import { validateObjectId } from "../middlewares/validateObjectIdMiddleware";
import { uploadRateLimit } from "../middlewares/imageUploadMiddleware";
import { planUpload } from "../middlewares/planUploadMiddleware";

const router = express.Router();

/**
 * @swagger
 * /plans:
 *   get:
 *     summary: Liste les plans privés de l'utilisateur
 *     tags: [Plans]
 *   post:
 *     summary: Importe un plan (image PNG/JPEG/WebP, 10 Mo max, multipart)
 *     tags: [Plans]
 * /plans/{id}/file:
 *   get:
 *     summary: Fichier du plan (déchiffré à la volée)
 *     tags: [Plans]
 * /plans/{id}:
 *   patch:
 *     summary: Renomme / recale un plan
 *     tags: [Plans]
 *   delete:
 *     summary: Supprime un plan (libère le quota)
 *     tags: [Plans]
 */
router.get("/", authMiddleware, listPlans);
router.post(
  "/",
  appCheckMiddleware,
  authMiddleware,
  uploadRateLimit,
  planUpload,
  createPlan,
);
router.get("/:id/file", authMiddleware, validateObjectId("id"), getPlanFile);
router.patch("/:id", authMiddleware, validateObjectId("id"), updatePlan);
router.delete("/:id", authMiddleware, validateObjectId("id"), deletePlan);

export default router;
