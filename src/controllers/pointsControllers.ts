import { getErrorMessage } from '../utils/errorUtils';
import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { memoryStorage } from '../services/memoryStorageService';
import { syncService } from '../services/syncService';
import FicheModel from '../models/fiches';

// typescript
export async function handleCreatePoint(req: Request, res: Response) {
    try {
        // Validation défensive - req.user devrait toujours exister grâce au middleware
        if (!req.user || !req.user.id) {
            return res.status(401).json({
                message: "Authentification requise",
                code: 'UNAUTHORIZED'
            });
        }

        const { name, description, longitude, latitude, ficheId, listIds, accessType } = req.body;
        const userId = req.user.id;

        console.log('[handleCreatePoint] Début création point:', { name, ficheId, listIds, userId });

        if (!name || longitude === undefined || latitude === undefined) {
            return res.status(400).json({ message: "Champs requis manquants" });
        }

        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ message: "ID utilisateur invalide" });
        }

        if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
            return res.status(400).json({ message: "Coordonnées invalides" });
        }

        const parseFicheIds = (input: any): mongoose.Types.ObjectId | mongoose.Types.ObjectId[] | null => {
            if (input === undefined || input === null || (typeof input === "string" && input.trim() === "")) return null;

            if (Array.isArray(input)) {
                // Limite de sécurité : maximum 100 IDs
                const limitedInput = input.slice(0, 100);
                const ids = limitedInput
                    .map((i) => String(i).trim())
                    .filter(Boolean)
                    .filter((id) => mongoose.Types.ObjectId.isValid(id))
                    .map((id) => new mongoose.Types.ObjectId(id));
                if (ids.length === 0) return null;
                return ids.length === 1 ? ids[0] : ids;
            }

            if (typeof input === "string") {
                // Limite de taille pour prévenir les DoS via JSON bombs
                const MAX_JSON_SIZE = 10000; // 10KB max
                if (input.length > MAX_JSON_SIZE) {
                    console.warn('[SECURITY] JSON input trop volumineux, rejeté');
                    return null;
                }

                try {
                    const parsed = JSON.parse(input);

                    // Validation de structure : doit être un tableau ou une chaîne simple
                    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
                        // Objet simple, vérifier s'il a un _id
                        if (parsed._id && mongoose.Types.ObjectId.isValid(String(parsed._id))) {
                            return new mongoose.Types.ObjectId(String(parsed._id));
                        }
                        return null;
                    }

                    return parseFicheIds(parsed);
                } catch {
                    const parts = input.split(",").map((p) => p.trim()).filter(Boolean);
                    if (parts.length === 0) return null;
                    // Limite de sécurité : maximum 100 IDs
                    const limitedParts = parts.slice(0, 100);
                    const valid = limitedParts.filter((id) => mongoose.Types.ObjectId.isValid(id)).map((id) => new mongoose.Types.ObjectId(id));
                    if (valid.length === 0) return null;
                    return valid.length === 1 ? valid[0] : valid;
                }
            }

            if (typeof input === "object") {
                if (input._id && mongoose.Types.ObjectId.isValid(String(input._id))) {
                    return new mongoose.Types.ObjectId(String(input._id));
                }
            }

            return null;
        };

        const parsedFiche = parseFicheIds(ficheId);

        // Parser les listIds de la même manière
        const parsedListIds = parseFicheIds(listIds);

        const newPointId = new mongoose.Types.ObjectId();

        // Validation stricte des coordonnées
        let location = undefined;
        if (longitude !== undefined && latitude !== undefined) {
            const lng = parseFloat(longitude);
            const lat = parseFloat(latitude);
            if (!isNaN(lng) && !isNaN(lat)) {
                location = {
                    type: "Point",
                    coordinates: [lng, lat]
                };
            } else {
                return res.status(400).json({ message: "Coordonnées invalides : longitude ou latitude non numérique." });
            }
        } else {
            return res.status(400).json({ message: "Coordonnées manquantes : longitude et latitude sont requises." });
        }

        // Ajout du champ accessType au point
        const pointMemory: any = {
            _id: newPointId,
            userId,
            name,
            description: description || "",
            location,
            createdAt: new Date(),
            updatedAt: new Date(),
            ficheId: parsedFiche,
            accessType: accessType || "" // Ajout du type d'accès, valeur par défaut vide
        };

        // Ajouter listIds au point si présent
        if (parsedListIds) {
            pointMemory.listIds = Array.isArray(parsedListIds)
                ? parsedListIds.map(id => id.toString())
                : [parsedListIds.toString()];
        }

        memoryStorage.storePoint(userId, pointMemory as any);

        // Si une ou plusieurs fiches sont fournies, ajouter le point dans chaque fiche en mémoire
        let assocSuccess = true;
        if (parsedFiche) {
            try {
                const ficheIds = Array.isArray(parsedFiche) ? parsedFiche : [parsedFiche];

                for (const fidObj of ficheIds) {
                    const fidStr = fidObj.toString();

                    // Vérifier si la fiche existe en mémoire
                    let ficheInMemory = memoryStorage.getFicheById(userId, fidStr);

                    // Si la fiche n'est pas en mémoire, essayer de la recharger depuis la base
                    if (!ficheInMemory) {
                        console.log(`[handleCreatePoint] Fiche ${fidStr} non trouvée en mémoire, tentative de rechargement depuis la base...`);

                        const ficheFromDB = await FicheModel.findOne({ _id: fidStr, userId: userId });

                        if (ficheFromDB) {
                            // Stocker la fiche en mémoire (elle sera déchiffrée plus tard lors du sync)
                            const ficheData = {
                                _id: ficheFromDB._id,
                                name: ficheFromDB.name,
                                ville: ficheFromDB.ville,
                                type: ficheFromDB.type,
                                etat: ficheFromDB.etat,
                                userId: ficheFromDB.userId,
                                difficulte_acces: ficheFromDB.difficulte_acces,
                                risque_oxygene: ficheFromDB.risque_oxygene,
                                acces_souterrain: ficheFromDB.acces_souterrain,
                                praticite_souterrain: ficheFromDB.praticite_souterrain,
                                etat_general: ficheFromDB.etat_general,
                                points_ids: ficheFromDB.points_ids || [],
                                date_creation: ficheFromDB.date_creation,
                                date_modification: ficheFromDB.date_modification
                            };

                            memoryStorage.storeFiche(userId, ficheData as any);
                            console.log(`[handleCreatePoint] Fiche ${fidStr} rechargée depuis la base et stockée en mémoire`);
                        } else {
                            console.warn(`[handleCreatePoint] Fiche ${fidStr} non trouvée dans la base de données`);
                        }
                    }

                    // Maintenant, essayer d'ajouter le point à la fiche
                    const added = memoryStorage.addPointToFiche(userId, fidStr, newPointId.toString());
                    if (!added) {
                        assocSuccess = false;
                        console.warn(`[handleCreatePoint] Impossible d'ajouter le point ${newPointId} à la fiche ${fidStr}`);
                    } else {
                        console.log(`[handleCreatePoint] Point ${newPointId} ajouté à la fiche ${fidStr}`);
                    }
                }
            } catch (err) {
                assocSuccess = false;
                console.error("[handleCreatePoint] Erreur lors de l'association point -> fiche :", err);
            }
        }

        // Si une ou plusieurs listes sont fournies, ajouter le point dans chaque liste en mémoire
        if (parsedListIds) {
            try {
                const listIdsArray = Array.isArray(parsedListIds) ? parsedListIds : [parsedListIds];
                for (const listIdObj of listIdsArray) {
                    const listIdStr = listIdObj.toString();
                    const added = memoryStorage.addPointToList(userId, listIdStr, newPointId.toString());
                    if (!added) {
                        assocSuccess = false;
                        console.warn(`Impossible d'ajouter le point ${newPointId} à la liste ${listIdStr}`);
                    } else {
                        console.log(`[handleCreatePoint] Point ${newPointId} ajouté à la liste ${listIdStr}`);
                    }
                }
            } catch (err) {
                assocSuccess = false;
                console.error("Erreur lors de l'association point -> liste :", err);
            }
        }

        const syncResult = await syncService.syncNow(userId);

        if (!syncResult.success) {
            return res.status(500).json({
                success: false,
                message: "Le point a été créé en mémoire mais la synchronisation a échoué",
                error: syncResult.error,
                pointId: newPointId,
                syncFailed: true,
                assocSuccess
            });
        }

        res.status(201).json({
            success: true,
            message: "Point créé avec succès",
            pointId: newPointId,
            syncSuccess: true,
            assocSuccess
        });
    } catch (error: unknown) {
        console.error("Erreur création point:", error);
        res.status(500).json({
            success: false,
            message: getErrorMessage(error)
        });
    }
}


export async function handleGetAllPointsByUserId(req: Request, res: Response) {
    try {
        console.log('[handleGetAllPointsByUserId] Début de la requête');

        // Validation défensive - req.user devrait toujours exister grâce au middleware
        if (!req.user || !req.user.id) {
            console.warn('[handleGetAllPointsByUserId] req.user manquant');
            return res.status(401).json({
                message: "Authentification requise",
                code: 'UNAUTHORIZED'
            });
        }

        // Pour GET, utiliser uniquement req.user.id (pas req.body)
        const userId = req.user.id;
        console.log('[handleGetAllPointsByUserId] userId:', userId);

        // Check if userId exists
        if (!userId) {
            return res.status(400).json({ message: "ID utilisateur manquant" });
        }

        // Validation de l'ID
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ 
                message: "Format de l'ID utilisateur invalide",
                receivedId: userId
            });
        }

        // SÉCURITÉ: Pagination avec limite max pour protection DoS
        const page = Math.max(1, parseInt(req.query.page as string) || 1);
        const limit = Math.min(Math.max(1, parseInt(req.query.limit as string) || 500), 1000); // Max 1000
        const offset = (page - 1) * limit;

        console.log('[handleGetAllPointsByUserId] Récupération des points depuis la mémoire...');
        // Récupérer les points depuis la mémoire
        const allPoints = memoryStorage.getAllPoints(userId);
        const total = allPoints ? allPoints.length : 0;
        console.log('[handleGetAllPointsByUserId] Points récupérés:', total);

        // Retourner un tableau vide si aucun point trouvé (pas une erreur 404)
        if (!allPoints || allPoints.length === 0) {
            console.log('[handleGetAllPointsByUserId] Aucun point trouvé, retour tableau vide');
            return res.status(200).json({
                data: [],
                pagination: { page, limit, total: 0, totalPages: 0 }
            });
        }

        // Appliquer la pagination
        const points = allPoints.slice(offset, offset + limit);

        console.log('[handleGetAllPointsByUserId] Envoi des points au client');
        res.status(200).json({
            data: points,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (error: unknown) {
        console.error("[handleGetAllPointsByUserId] ❌ Erreur:", error);
        if (error instanceof Error && error.stack) {
            console.error("[handleGetAllPointsByUserId] Stack:", error.stack);
        }
        res.status(500).json({
            message: "Erreur lors de la récupération des points",
            error: getErrorMessage(error)
        });
    }
}

export async function handleSearchPoints(req: Request, res: Response) {
    try {
        const userId = req.user?.id;

        if (!userId) {
            return res.status(401).json({ message: "Utilisateur non identifié" });
        }

        // Validation de l'ID
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({
                message: "Format de l'ID utilisateur invalide",
                receivedId: userId
            });
        }

        // Récupérer les paramètres de recherche depuis query params
        const { q, query, ficheId, listId } = req.query;

        // Utiliser 'q' ou 'query' pour la recherche textuelle
        const searchQuery = (q || query) as string | undefined;

        // Construire les filtres
        const filters: any = {};
        if (searchQuery) filters.query = searchQuery;
        if (ficheId) filters.ficheId = ficheId as string;
        if (listId) filters.listId = listId as string;

        console.log(`[handleSearchPoints] Recherche avec filtres:`, filters);

        // Effectuer la recherche
        const points = memoryStorage.searchPoints(userId, filters);

        res.status(200).json({
            success: true,
            count: points.length,
            points
        });
    } catch (error: unknown) {
        console.error("Erreur recherche points:", error);
        res.status(500).json({
            success: false,
            message: "Erreur lors de la recherche de points",
            error: getErrorMessage(error)
        });
    }
}

export async function handleGetPointById(req: Request, res: Response) {
    try {
        const { id } = req.params;
        const userId = req.user?.id;

        if (!userId) {
            return res.status(401).json({ message: "ID utilisateur manquant" });
        }
        
        const point = memoryStorage.getPointById(userId, id);
        
        if (!point) {
            return res.status(404).json({ message: "Point non trouvé" });
        }
        
        res.status(200).json(point);
    } catch (error: unknown) {
        res.status(400).json({ message: getErrorMessage(error) });
    }
}

export async function handleDeletePoint(req: Request, res: Response) {
    try {
        const pointId = req.params.id;
        const userId = req.user?.id;
        
        if (!userId) {
            return res.status(401).json({ message: "Utilisateur non identifié" });
        }

        if (!pointId) {
            return res.status(400).json({ message: "ID du point manquant" });
        }

        if (!mongoose.Types.ObjectId.isValid(pointId)) {
            return res.status(400).json({ message: "Format de l'ID invalide" });
        }
        
        // Récupérer le point pour vérifier s'il est lié à une fiche
        const point = memoryStorage.getPointById(userId, pointId);
        
        if (!point) {
            return res.status(404).json({ message: "Point non trouvé" });
        }
        
        // Si le point est associé à une fiche, le retirer de cette fiche
        if ((point as any).ficheId) {
            const ficheId = (point as any).ficheId.toString();
            console.log(`Point ${pointId} est associé à la fiche ${ficheId}, suppression du lien`);
            
            // Supprimer la référence dans la fiche
            memoryStorage.removePointFromFiche(userId, ficheId, pointId);
        }

        // Supprimer le point de la mémoire
        const deleted = memoryStorage.deletePoint(userId, pointId);
        
        if (!deleted) {
            return res.status(404).json({ message: "Point non trouvé en mémoire" });
        }

        // Synchroniser la modification avec la base de données
        const syncResult = await syncService.syncNow(userId);
        
        if (!syncResult.success) {
            return res.status(500).json({
                success: false,
                message: "Le point a été supprimé en mémoire mais n'a pas pu être synchronisé avec la base de données",
                error: syncResult.error,
                pointId,
                syncFailed: true
            });
        }

        res.status(200).json({ 
            success: true,
            message: "Point supprimé avec succès",
            pointId,
            syncSuccess: true
        });
    } catch (error: unknown) {
        console.error("Erreur suppression point:", error);
        res.status(500).json({
            success: false,
            message: "Erreur lors de la suppression du point",
            error: getErrorMessage(error)
        });
    }
}

export async function handleUpdatePoint(req: Request, res: Response) {
    try {
        const { id } = req.params;
        const userId = req.user?.id;
        const { name, description, longitude, latitude, listIds, ficheId, accessType } = req.body;

        if (!userId) {
            return res.status(401).json({ message: "Utilisateur non identifié" });
        }

        // Récupérer le point depuis la mémoire
        const point = memoryStorage.getPointById(userId, id);
        
        if (!point) {
            return res.status(404).json({ message: "Point non trouvé" });
        }
        
        // Mettre à jour les champs
        if (name !== undefined) point.name = name;
        if (description !== undefined) point.description = description;
        
        if (longitude !== undefined && latitude !== undefined) {
            // Assertion de type pour éviter l'erreur TypeScript
            (point as any).location = {
                type: "Point",
                coordinates: [parseFloat(longitude), parseFloat(latitude)]
            };
        }

        // Mettre à jour listIds si fourni
        if (listIds !== undefined) {
            const oldListIds = (point as any).listIds;

            // Si listIds est null ou array vide, supprimer l'association
            if (listIds === null || (Array.isArray(listIds) && listIds.length === 0)) {
                // Retirer le point de l'ancienne liste si elle existait
                if (oldListIds && Array.isArray(oldListIds) && oldListIds.length > 0) {
                    const oldListId = oldListIds[0];
                    const removeResult = memoryStorage.removePointFromList(userId, oldListId, id);
                    if (!removeResult) {
                        console.warn(`Impossible de retirer le point ${id} de l'ancienne liste ${oldListId}`);
                    } else {
                        console.log(`[handleUpdatePoint] Point ${id} retiré de la liste ${oldListId}`);
                    }
                }
                (point as any).listIds = undefined;
                console.log(`[handleUpdatePoint] Association liste supprimée pour le point ${id}`);
            } else if (Array.isArray(listIds) && listIds.length > 0) {
                const newListId = listIds[0]; // On ne prend que la première liste (sélection unique)

                // Retirer le point de l'ancienne liste si elle est différente de la nouvelle
                if (oldListIds && Array.isArray(oldListIds) && oldListIds.length > 0) {
                    const oldListId = oldListIds[0];
                    if (oldListId !== newListId) {
                        const removeResult = memoryStorage.removePointFromList(userId, oldListId, id);
                        if (!removeResult) {
                            console.warn(`Impossible de retirer le point ${id} de l'ancienne liste ${oldListId}`);
                        } else {
                            console.log(`[handleUpdatePoint] Point ${id} retiré de l'ancienne liste ${oldListId}`);
                        }
                    }
                }

                // Ajouter le point à la nouvelle liste
                (point as any).listIds = [newListId];
                const addResult = memoryStorage.addPointToList(userId, newListId, id);
                if (!addResult) {
                    console.warn(`Impossible d'ajouter le point ${id} à la nouvelle liste ${newListId}`);
                } else {
                    console.log(`[handleUpdatePoint] Point ${id} ajouté à la liste ${newListId}`);
                }
            }
        }

        // Mettre à jour ficheId si fourni
        if (ficheId !== undefined) {
            // Si ficheId est null ou array vide, supprimer l'association
            if (ficheId === null || (Array.isArray(ficheId) && ficheId.length === 0)) {
                (point as any).ficheId = undefined;
            } else {
                // Stocker ficheId (peut être string ou array)
                (point as any).ficheId = ficheId;

                // Ajouter le point dans les fiches en mémoire
                const ficheIds = Array.isArray(ficheId) ? ficheId : [ficheId];
                for (const fid of ficheIds) {
                    const addResult = memoryStorage.addPointToFiche(userId, fid, id);
                    if (!addResult) {
                        console.warn(`Impossible d'ajouter le point ${id} à la fiche ${fid}`);
                    }
                }
            }
        }

        // Mettre à jour le champ accessType si fourni
        if (accessType !== undefined) {
            point.accessType = accessType || ""; // Assurez-vous que la valeur par défaut est une chaîne vide
        }

        // Mettre à jour le timestamp de modification
        point.updatedAt = new Date();
        
        // Stocker les modifications en mémoire
        memoryStorage.storePoint(userId, point);
        
        // Synchroniser avec la base de données et attendre le résultat
        const syncResult = await syncService.syncNow(userId);
        
        if (!syncResult.success) {
            return res.status(500).json({
                success: false,
                message: "Le point a été mis à jour en mémoire mais n'a pas pu être synchronisé avec la base de données",
                error: syncResult.error,
                pointId: id,
                syncFailed: true
            });
        }
        
        res.status(200).json({
            success: true,
            message: "Point mis à jour avec succès",
            point,
            syncSuccess: true
        });
    } catch (error: unknown) {
        console.error("Erreur mise à jour point:", error);
        res.status(400).json({ 
            success: false,
            message: getErrorMessage(error) 
        });
    }
}

export async function handleLinkPointToFiche(req: Request, res: Response) {
    try {
        const { pointId, ficheId } = req.body;
        const userId = req.user?.id;
        
        if (!userId) {
            return res.status(401).json({ message: "Utilisateur non authentifié" });
        }
        
        if (!pointId || !ficheId) {
            return res.status(400).json({ message: "IDs de point et de fiche requis" });
        }
        
        const result = memoryStorage.addPointToFiche(userId, ficheId, pointId);
        
        if (!result) {
            return res.status(404).json({ message: "Point ou fiche non trouvé" });
        }
        
        // Synchroniser avec la base de données
        const syncResult = await syncService.syncNow(userId);
        
        if (!syncResult.success) {
            return res.status(500).json({
                success: false,
                message: "Le point a été lié à la fiche en mémoire mais n'a pas pu être synchronisé avec la base de données",
                error: syncResult.error,
                pointId,
                ficheId,
                syncFailed: true
            });
        }
        
        res.status(200).json({
            success: true,
            message: "Point associé à la fiche avec succès",
            pointId,
            ficheId,
            syncSuccess: true
        });
    } catch (error: unknown) {
        console.error("Erreur association point-fiche:", error);
        res.status(500).json({
            success: false,
            message: getErrorMessage(error)
        });
    }
}

export async function handleUnlinkPointFromFiche(req: Request, res: Response) {
    try {
        const { pointId, ficheId } = req.body;
        const userId = req.user?.id;
        
        if (!userId) {
            return res.status(401).json({ message: "Utilisateur non authentifié" });
        }
        
        if (!pointId || !ficheId) {
            return res.status(400).json({ message: "IDs de point et de fiche requis" });
        }
        
        const result = memoryStorage.removePointFromFiche(userId, ficheId, pointId);
        
        if (!result) {
            return res.status(404).json({ message: "Point ou fiche non trouvé" });
        }
        
        // Synchroniser avec la base de données
        const syncResult = await syncService.syncNow(userId);
        
        if (!syncResult.success) {
            return res.status(500).json({
                success: false,
                message: "Le point a été délié de la fiche en mémoire mais n'a pas pu être synchronisé avec la base de données",
                error: syncResult.error,
                pointId,
                ficheId,
                syncFailed: true
            });
        }
        
        res.status(200).json({
            success: true,
            message: "Point dissocié de la fiche avec succès",
            pointId,
            ficheId,
            syncSuccess: true
        });
    } catch (error: unknown) {
        console.error("Erreur dissociation point-fiche:", error);
        res.status(500).json({
            success: false,
            message: getErrorMessage(error)
        });
    }
}