import { Router } from "express";
import {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  deleteAllRead,
  createTestNotification,
} from "../controllers/notificationsControllers";
import { authMiddleware } from "../middlewares/authMiddleware";
import { validateObjectId } from "../middlewares/validateObjectIdMiddleware";

const router = Router();

// Toutes les routes nécessitent une authentification
router.use(authMiddleware);

// POST /api/notifications/test - Créer une notification de test (DEV ONLY)
// SEC-038: Route non enregistrée en production (le controller retourne aussi 404 en prod - LOW-1)
if (process.env.NODE_ENV !== "production") {
  router.post("/test", createTestNotification);
}

/**
 * @swagger
 * /notifications:
 *   get:
 *     summary: Récupère toutes les notifications de l'utilisateur
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50 }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *     responses:
 *       200: { description: Liste paginée }
 *       401: { description: Non authentifié }
 *
 * /notifications/unread-count:
 *   get:
 *     summary: Nombre de notifications non lues
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Compteur
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 count: { type: integer }
 *
 * /notifications/read-all:
 *   patch:
 *     summary: Marque toutes les notifications comme lues
 *     description: §V3 broadcast WS notification_read avec notificationId="all" pour multi-device sync.
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Toutes marquées comme lues }
 *
 * /notifications/{notificationId}/read:
 *   patch:
 *     summary: Marque une notification comme lue
 *     description: §V3 broadcast WS notification_read multi-device.
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: notificationId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Marquée comme lue }
 *       404: { description: Notification non trouvée }
 *
 * /notifications/read:
 *   delete:
 *     summary: Supprime toutes les notifications lues
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Supprimées }
 *
 * /notifications/{notificationId}:
 *   delete:
 *     summary: Supprime une notification précise
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: notificationId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Supprimée }
 *       404: { description: Notification non trouvée }
 */
// GET /api/notifications - Récupérer toutes les notifications
router.get("/", getNotifications);

// GET /api/notifications/unread-count - Récupérer le nombre de notifications non lues
router.get("/unread-count", getUnreadCount);

// PATCH /api/notifications/read-all - Marquer toutes les notifications comme lues
router.patch("/read-all", markAllAsRead);

// PATCH /api/notifications/:notificationId/read - Marquer une notification comme lue
router.patch(
  "/:notificationId/read",
  validateObjectId("notificationId"),
  markAsRead,
);

// DELETE /api/notifications/read - Supprimer toutes les notifications lues
router.delete("/read", deleteAllRead);

// DELETE /api/notifications/:notificationId - Supprimer une notification
router.delete(
  "/:notificationId",
  validateObjectId("notificationId"),
  deleteNotification,
);

export default router;
