import { getErrorMessage } from '../utils/errorUtils';
// server/src/middlewares/adminMiddleware.ts
import { Request, Response, NextFunction } from "express";
import { auditService } from "../services/auditService";

/**
 * Middleware pour vérifier les permissions administrateur
 * Doit être utilisé APRÈS authMiddleware
 */
export const adminMiddleware = async (req: Request, res: Response, next: NextFunction) => {
    try {
        // Vérifier que l'utilisateur est authentifié
        if (!req.user?.id) {
            console.warn(`⚠️ [ADMIN] Tentative d'accès admin sans authentification - ${req.method} ${req.path}`);
            return res.status(401).json({
                message: "Authentification requise",
                code: 'NOT_AUTHENTICATED'
            });
        }

        // Vérifier que l'utilisateur est admin
        if (!req.user.isAdmin) {
            console.warn(`🚫 [ADMIN] Accès admin refusé - userId: ${req.user.id} - ${req.method} ${req.path}`);

            // Logger la tentative d'accès non autorisé
            await auditService.log({
                userId: req.user.id,
                action: 'ADMIN_ACCESS_DENIED',
                level: 'warning',
                ipAddress: req.ip,
                userAgent: req.get('user-agent'),
                details: {
                    path: req.path,
                    method: req.method
                }
            });

            return res.status(403).json({
                message: "Accès réservé aux administrateurs",
                code: 'NOT_ADMIN'
            });
        }

        // Log de l'accès admin (optionnel en debug)
        if (process.env.LOG_ADMIN_ACCESS === 'true') {
            console.log(`👑 [ADMIN] Accès autorisé - userId: ${req.user.id} - ${req.method} ${req.path}`);
        }

        next();
    } catch (error: unknown) {
        console.error(`❌ [ADMIN] Erreur middleware admin:`, getErrorMessage(error));
        return res.status(500).json({
            message: "Erreur lors de la vérification des permissions",
            code: 'ADMIN_CHECK_ERROR'
        });
    }
};

export default adminMiddleware;
