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
