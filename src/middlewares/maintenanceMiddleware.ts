// server/src/middlewares/maintenanceMiddleware.ts
import { Request, Response, NextFunction } from "express";
import MaintenanceModel from "../models/maintenance";
import jwt from "jsonwebtoken";
import { jwtKeyManager } from "../utils/jwtKeyManager";

/**
 * Middleware qui vérifie si le mode maintenance est activé
 * - Bloque l'accès à toutes les routes (sauf certaines exceptions)
 * - Les administrateurs connectés peuvent toujours accéder au site
 */
export const maintenanceMiddleware = async (req: Request, res: Response, next: NextFunction) => {
    try {
        // Routes toujours accessibles (login, maintenance status, etc.)
        // Note: Le middleware est monté sur /api, donc req.path n'inclut pas /api
        const exemptRoutes = [
            '/maintenance',      // Toutes les routes de maintenance (status, activate, deactivate)
            '/auth/login',       // Login pour permettre aux admins de se connecter
            '/auth/verify-2fa',  // 2FA
            '/auth/check',       // Vérification d'auth
            '/auth/complete-2fa-login', // Compléter le login 2FA
            '/admin'             // Les routes admin restent accessibles pour les admins
        ];

        // Vérifier si la route est exemptée
        const isExempt = exemptRoutes.some(route => req.path.startsWith(route));
        if (isExempt) {
            return next();
        }

        // Récupérer l'état de maintenance
        const maintenance = await MaintenanceModel.findOne().lean();

        // Si pas de maintenance ou maintenance inactive, continuer
        if (!maintenance || !maintenance.isActive) {
            return next();
        }

        // Vérifier si l'utilisateur est un admin connecté
        const token = req.cookies?.token || req.headers.authorization?.split(" ")[1];

        if (token) {
            try {
                // Décoder le token pour vérifier si c'est un admin
                const unverifiedPayload = jwt.decode(token) as { kv?: string, isAdmin?: boolean } | null;

                if (unverifiedPayload?.isAdmin) {
                    // Vérifier que le token est valide
                    const keyVersion = unverifiedPayload?.kv;
                    let jwtSecret: string;

                    if (keyVersion && jwtKeyManager.hasVersion(keyVersion)) {
                        const versionedSecret = jwtKeyManager.getKeyByVersion(keyVersion);
                        if (versionedSecret) {
                            jwtSecret = versionedSecret;
                        } else {
                            jwtSecret = process.env.JWT_SECRET || '';
                        }
                    } else {
                        jwtSecret = process.env.JWT_SECRET || '';
                    }

                    const decoded = jwt.verify(token, jwtSecret) as { isAdmin?: boolean };

                    // Si c'est un admin valide, autoriser l'accès
                    if (decoded.isAdmin) {
                        return next();
                    }
                }
            } catch (e) {
                // Token invalide, ignorer et bloquer
            }
        }

        // Bloquer l'accès - site en maintenance
        return res.status(503).json({
            maintenance: true,
            message: maintenance.message || "Le site est actuellement en maintenance.",
            estimatedEndTime: maintenance.estimatedEndTime
        });
    } catch (error) {
        console.error('[MAINTENANCE] Erreur middleware:', error);
        // En cas d'erreur, on laisse passer pour ne pas bloquer le site
        return next();
    }
};

/**
 * Route publique pour vérifier l'état de maintenance
 * Accessible sans authentification
 */
export const getMaintenanceStatus = async (req: Request, res: Response) => {
    try {
        const maintenance = await MaintenanceModel.findOne().lean();

        res.json({
            isActive: maintenance?.isActive || false,
            message: maintenance?.message || null,
            estimatedEndTime: maintenance?.estimatedEndTime || null
        });
    } catch (error) {
        console.error('[MAINTENANCE] Erreur status:', error);
        res.json({
            isActive: false,
            message: null,
            estimatedEndTime: null
        });
    }
};
