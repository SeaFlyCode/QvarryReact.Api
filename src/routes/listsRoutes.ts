import express from 'express';
import {
    handleCreateList,
    handleGetAllLists,
    handleGetListById,
    handleDeleteList,
    handleUpdateList,
    handleGetListByUserId,
    handleAddPointToList,
    handleRemovePointFromList,
    handleGetPointsByListId,
    handleGetListsByPointId,
    handleBulkAddPointsToList,
    handleBulkRemovePointsFromList,
    handleSyncListData
} from '../controllers/listsControllers';
import { authMiddleware } from '../middlewares/authMiddleware';

const router = express.Router();

// Routes protégées par authentification
router.use(authMiddleware);

// CRUD de base pour les listes
router.post('/', handleCreateList);
router.get('/', handleGetAllLists);
router.get('/:id', handleGetListById);
router.delete('/:id', handleDeleteList);
router.put('/:id', handleUpdateList);

// Récupérer les listes d'un utilisateur
router.get('/user/:userId', handleGetListByUserId);

// ⚡ OPTIMISÉ: Opérations sur les points (sans sync immédiate)
router.post('/:listId/points/:pointId', handleAddPointToList);
router.delete('/:listId/points/:pointId', handleRemovePointFromList);

// ⚡ NOUVEAU: Opérations batch
router.post('/:listId/points/bulk/add', handleBulkAddPointsToList);
router.post('/:listId/points/bulk/remove', handleBulkRemovePointsFromList);

// Récupération de points et listes
router.get('/:listId/points', handleGetPointsByListId);
router.get('/points/:pointId/lists', handleGetListsByPointId);

// ⚡ NOUVEAU: Synchronisation manuelle
router.post('/sync', handleSyncListData);

export default router;

