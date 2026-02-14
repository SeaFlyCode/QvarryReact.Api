// ═══════════════════════════════════════════════════════════════════════════
// CONTRÔLEURS DE SYNCHRONISATION MOBILE
// ═══════════════════════════════════════════════════════════════════════════
// Endpoints pour la synchronisation offline-first des données
// ═══════════════════════════════════════════════════════════════════════════

import { Request, Response } from "express";
import { mobileSyncService, LocalChange } from "../services/mobileSyncService";
import { getErrorMessage } from "../utils/errorUtils";

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/mobile/sync - Synchronisation incrémentale
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Récupère les changements depuis une date donnée
 *
 * Query params:
 *   - since: ISO date string (optionnel, si absent = sync complète)
 *
 * Response:
 *   - points: { created: [], updated: [], deleted: [] }
 *   - fiches: { created: [], updated: [], deleted: [] }
 *   - lists: { created: [], updated: [], deleted: [] }
 *   - lastSyncDate: ISO date string
 *   - totalChanges: number
 */
export async function handleMobileSync(req: Request, res: Response) {
    const startTime = Date.now();

    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({
                error: "Utilisateur non authentifié",
                code: 'UNAUTHORIZED'
            });
        }

        const sinceParam = req.query.since as string | undefined;

        let result;
        if (sinceParam) {
            // Sync incrémentale
            const sinceDate = new Date(sinceParam);
            if (isNaN(sinceDate.getTime())) {
                return res.status(400).json({
                    error: "Format de date invalide. Utilisez ISO 8601 (ex: 2026-02-11T10:00:00Z)",
                    code: 'INVALID_DATE_FORMAT'
                });
            }
            result = await mobileSyncService.getIncrementalChanges(userId, sinceDate);
        } else {
            // Sync complète (premier lancement ou reset)
            result = await mobileSyncService.getFullData(userId);
        }

        const duration = Date.now() - startTime;
        console.log(`📱 [MOBILE-SYNC] GET sync pour ${userId} - ${result.totalChanges} éléments en ${duration}ms`);

        res.status(200).json({
            success: true,
            ...result,
            syncDuration: duration
        });

    } catch (error) {
        console.error(`❌ [MOBILE-SYNC] Erreur GET sync:`, getErrorMessage(error));
        res.status(500).json({
            error: "Erreur lors de la synchronisation",
            code: 'SYNC_ERROR',
            details: process.env.NODE_ENV === 'development' ? getErrorMessage(error) : undefined
        });
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/mobile/sync - Push des changements locaux
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Applique les changements effectués en mode offline
 *
 * Body:
 *   - changes: LocalChange[] - Liste des modifications locales
 *
 * LocalChange format:
 *   {
 *     type: 'point' | 'fiche' | 'list',
 *     action: 'create' | 'update' | 'delete',
 *     id?: string,           // ID serveur (pour update/delete)
 *     localId?: string,      // ID local temporaire (pour create)
 *     data?: object,         // Données déchiffrées
 *     timestamp: string      // Date de modification locale
 *   }
 *
 * Response:
 *   - synced: LocalChange[] - Changements appliqués avec succès
 *   - conflicts: SyncConflict[] - Conflits détectés
 *   - errors: any[] - Erreurs rencontrées
 *   - idMapping: { [localId]: serverId } - Mapping des IDs locaux vers serveur
 */
export async function handleMobileSyncPush(req: Request, res: Response) {
    const startTime = Date.now();

    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({
                error: "Utilisateur non authentifié",
                code: 'UNAUTHORIZED'
            });
        }

        const { changes } = req.body as { changes: LocalChange[] };

        if (!changes || !Array.isArray(changes)) {
            return res.status(400).json({
                error: "Le champ 'changes' doit être un tableau",
                code: 'INVALID_CHANGES_FORMAT'
            });
        }

        if (changes.length === 0) {
            return res.status(200).json({
                success: true,
                synced: [],
                conflicts: [],
                errors: [],
                idMapping: {},
                message: "Aucun changement à appliquer"
            });
        }

        // Valider les changements
        for (const change of changes) {
            if (!['point', 'fiche', 'list'].includes(change.type)) {
                return res.status(400).json({
                    error: `Type invalide: ${change.type}. Valeurs acceptées: point, fiche, list`,
                    code: 'INVALID_CHANGE_TYPE'
                });
            }
            if (!['create', 'update', 'delete'].includes(change.action)) {
                return res.status(400).json({
                    error: `Action invalide: ${change.action}. Valeurs acceptées: create, update, delete`,
                    code: 'INVALID_CHANGE_ACTION'
                });
            }
            if ((change.action === 'update' || change.action === 'delete') && !change.id) {
                return res.status(400).json({
                    error: "L'ID est requis pour les actions update et delete",
                    code: 'MISSING_ID'
                });
            }
            if ((change.action === 'create' || change.action === 'update') && !change.data) {
                return res.status(400).json({
                    error: "Les données sont requises pour les actions create et update",
                    code: 'MISSING_DATA'
                });
            }
        }

        // Appliquer les changements
        const result = await mobileSyncService.applyLocalChanges(userId, changes);

        // Créer le mapping des IDs locaux vers serveur
        const idMapping: Record<string, string> = {};
        for (const synced of result.synced) {
            if (synced.localId && synced.id) {
                idMapping[synced.localId] = synced.id;
            }
        }

        const duration = Date.now() - startTime;
        console.log(`📱 [MOBILE-SYNC] POST sync pour ${userId} - ${result.synced.length}/${changes.length} appliqués en ${duration}ms`);

        res.status(200).json({
            success: true,
            synced: result.synced,
            conflicts: result.conflicts,
            errors: result.errors,
            idMapping,
            syncDuration: duration
        });

    } catch (error) {
        console.error(`❌ [MOBILE-SYNC] Erreur POST sync:`, getErrorMessage(error));
        res.status(500).json({
            error: "Erreur lors de l'application des changements",
            code: 'SYNC_PUSH_ERROR',
            details: process.env.NODE_ENV === 'development' ? getErrorMessage(error) : undefined
        });
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/mobile/data/full - Téléchargement initial complet
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Récupère TOUTES les données de l'utilisateur
 * À utiliser uniquement lors de la première connexion ou d'un reset complet
 *
 * Response: Même format que GET /api/mobile/sync
 */
export async function handleMobileFullData(req: Request, res: Response) {
    const startTime = Date.now();

    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({
                error: "Utilisateur non authentifié",
                code: 'UNAUTHORIZED'
            });
        }

        const result = await mobileSyncService.getFullData(userId);

        const duration = Date.now() - startTime;
        console.log(`📱 [MOBILE-SYNC] Full data pour ${userId} - ${result.totalChanges} éléments en ${duration}ms`);

        res.status(200).json({
            success: true,
            ...result,
            syncDuration: duration
        });

    } catch (error) {
        console.error(`❌ [MOBILE-SYNC] Erreur full data:`, getErrorMessage(error));
        res.status(500).json({
            error: "Erreur lors de la récupération des données",
            code: 'FULL_DATA_ERROR',
            details: process.env.NODE_ENV === 'development' ? getErrorMessage(error) : undefined
        });
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/mobile/sync/status - État de synchronisation
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Vérifie s'il y a des changements depuis la dernière sync
 * Utile pour afficher un indicateur "mise à jour disponible"
 *
 * Query params:
 *   - since: ISO date string (obligatoire)
 *
 * Response:
 *   - hasChanges: boolean
 *   - changeCount: number
 *   - lastModified: ISO date string
 */
export async function handleMobileSyncStatus(req: Request, res: Response) {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({
                error: "Utilisateur non authentifié",
                code: 'UNAUTHORIZED'
            });
        }

        const sinceParam = req.query.since as string | undefined;
        if (!sinceParam) {
            return res.status(400).json({
                error: "Le paramètre 'since' est obligatoire",
                code: 'MISSING_SINCE_PARAM'
            });
        }

        const sinceDate = new Date(sinceParam);
        if (isNaN(sinceDate.getTime())) {
            return res.status(400).json({
                error: "Format de date invalide",
                code: 'INVALID_DATE_FORMAT'
            });
        }

        // Compter rapidement les changements sans charger toutes les données
        const result = await mobileSyncService.getIncrementalChanges(userId, sinceDate);

        res.status(200).json({
            success: true,
            hasChanges: result.totalChanges > 0,
            changeCount: result.totalChanges,
            lastSyncDate: result.lastSyncDate,
            breakdown: {
                points: result.points.created.length + result.points.updated.length + result.points.deleted.length,
                fiches: result.fiches.created.length + result.fiches.updated.length + result.fiches.deleted.length,
                lists: result.lists.created.length + result.lists.updated.length + result.lists.deleted.length
            }
        });

    } catch (error) {
        console.error(`❌ [MOBILE-SYNC] Erreur sync status:`, getErrorMessage(error));
        res.status(500).json({
            error: "Erreur lors de la vérification",
            code: 'SYNC_STATUS_ERROR'
        });
    }
}

