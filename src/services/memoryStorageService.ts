import { getErrorMessage } from '../utils/errorUtils';
import { IPoint } from "../models/points";
import { IFiche } from "../models/fiches";
import { IList } from "../models/lists";
import mongoose from 'mongoose';
import {IConversation} from "../models/conversations";
import {IContact} from "../models/contacts";

interface UserSession {
  points: Map<string, IPoint>; // ID → Point déchiffré
  fiches: Map<string, IFiche>; // ID → Fiche déchiffrée
  lists: Map<string, IList>; // ID → Liste déchiffrée (si nécessaire)
  conversations: Map<string, IConversation>; // ID → Conversation déchiffrée
  contacts: Map<string, IContact>; // ID → Contact
  encryptionKey: string;
  lastAccessed: Date;
  isDirty: boolean; // Indique si les données ont été modifiées depuis le dernier sync
}

export class MemoryStorageService {
  private sessions: Map<string, UserSession> = new Map();
  private readonly SESSION_TIMEOUT = 1000 * 60 * 30; // 30 minutes
  private accessCounter: Record<string, number> = {}; // Pour suivre le nombre d'accès
  
  constructor() {

    // Démarrer un timer pour nettoyer les sessions expirées
    setInterval(() => this.cleanExpiredSessions(), 1000 * 60 * 5); // Toutes les 5 minutes
  }

  private logAccess(method: string, userId: string, details?: any): void {
    // Vérifier que userId est défini
    if (!userId) {
      console.warn(`⚠️ [MemoryStorage] ${method} appelé sans userId`);
      return;
    }

    // Incrémenter le compteur pour ce type d'accès
    if (!this.accessCounter[method]) {
      this.accessCounter[method] = 0;
    }
    this.accessCounter[method]++;
    
    // Log complet pour le débogage
    console.log(`📊 [MemoryStorage] ${method} - user: ${userId.substring(0, 6)}... ${details ? JSON.stringify(details) : ''}`);
    
    // Afficher les statistiques d'accès toutes les 10 opérations
    const totalAccess = Object.values(this.accessCounter).reduce((a, b) => a + b, 0);
    if (totalAccess % 10 === 0) {
      console.log('📈 Statistiques d\'accès mémoire:', this.accessCounter);
    }
  }

  // Initialiser une session utilisateur avec toutes les données déchiffrées
  initSession(userId: string, encryptionKey: string): boolean {
    try {
      this.logAccess('initSession', userId);
      
      if (!userId || !encryptionKey) {
        throw new Error("ID utilisateur ou clé de chiffrement manquant");
      }
      
      this.sessions.set(userId, {
        points: new Map(),
        fiches: new Map(),
        lists: new Map(), // Si nécessaire, sinon peut être omis
        conversations: new Map(),
        contacts: new Map(),
        encryptionKey,
        lastAccessed: new Date(),
        isDirty: false
      });
      
      return true;
    } catch (error) {
      console.error(`❌ Erreur lors de l'initialisation de la session pour l'utilisateur ${userId}:`, error);
      return false;
    }
  }

  // Vérifier si une session existe pour un utilisateur
  hasSession(userId: string): boolean {
    if (!userId) {
      console.warn('⚠️ [MemoryStorage] hasSession appelé sans userId');
      return false;
    }
    this.logAccess('hasSession', userId);
    return this.sessions.has(userId);
  }

  // Mettre à jour le timestamp d'accès
  touchSession(userId: string): void {
    // Pas de log ici pour éviter trop de bruit
    const session = this.getSession(userId);
    session.lastAccessed = new Date();
  }

  // Récupérer la session d'un utilisateur
  getSession(userId: string): UserSession {
    if (!userId) {
      console.error('❌ [MemoryStorage] getSession appelé sans userId');
      throw new Error("Session utilisateur non trouvée. Veuillez vous reconnecter.");
    }

    // Log minimal pour cette méthode interne fréquemment appelée
    const session = this.sessions.get(userId);
    if (!session) {
      this.logAccess('getSession_ERROR', userId, { error: 'Session non trouvée' });
      throw new Error("Session utilisateur non trouvée. Veuillez vous reconnecter.");
    }
    return session;
  }

  // Stocker un point déchiffré
   storePoint(userId: string, point: IPoint): boolean {
    try {
      this.logAccess('storePoint', userId, { pointId: point._id });
      const session = this.getSession(userId);
      
      if (!point._id) {
        throw new Error("Impossible de stocker un point sans ID");
      }
      
      session.points.set(point._id.toString(), point);
      session.isDirty = true;
      this.touchSession(userId);
      return true;
    } catch (error) {
      console.error(`❌ Erreur lors du stockage du point pour l'utilisateur ${userId}:`, error);
      return false;
    }
  }

  // Stocker une fiche déchiffrée
  storeFiche(userId: string, fiche: IFiche): boolean {
    try {
      this.logAccess('storeFiche', userId, { ficheId: fiche._id });
      const session = this.getSession(userId);
      
      if (!fiche._id) {
        throw new Error("Impossible de stocker une fiche sans ID");
      }
      
      session.fiches.set(fiche._id.toString(), fiche);
      session.isDirty = true;
      this.touchSession(userId);
      return true;
    } catch (error) {
      console.error(`❌ Erreur lors du stockage de la fiche pour l'utilisateur ${userId}:`, error);
      return false;
    }
  }

  // Stocker une liste déchiffrée
  storeList(userId: string, list: IList): boolean {
    try {
      this.logAccess('storeList', userId, { listId: list._id });
      const session = this.getSession(userId);
      
      if (!list._id) {
        throw new Error("Impossible de stocker une liste sans ID");
      }
      
      session.lists.set(list._id.toString(), list);
      session.isDirty = true;
      this.touchSession(userId);
      return true;
    } catch (error) {
      console.error(`❌ Erreur lors du stockage de la liste pour l'utilisateur ${userId}:`, error);
      return false;
    }
  }

  // Stocker une conversation déchiffrée
  storeConversation(userId: string, conversation: IConversation): boolean {
    try {
      this.logAccess('storeConversation', userId, { conversationId: conversation._id });
      const session = this.getSession(userId);
      if (!conversation._id) {
        throw new Error("Impossible de stocker une conversation sans ID");
      }
      // On ne stocke que les champs pertinents selon l'interface IConversation
      const conversationToStore: IConversation = {
        _id: conversation._id,
        name: conversation.name ?? null,
        isGroup: conversation.isGroup,
        creatorId: conversation.creatorId ?? null,
        participants: conversation.participants,
        lastMessage: conversation.lastMessage ?? null,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt
      } as IConversation;
      session.conversations.set(conversation._id.toString(), conversationToStore);
      session.isDirty = true;
      this.touchSession(userId);
      return true;
    } catch (error) {
      console.error(`❌ Erreur lors du stockage de la conversation pour l'utilisateur ${userId}:`, error);
      return false;
    }
  }

  // Supprimer une conversation du cache
  removeConversation(userId: string, conversationId: string): boolean {
    try {
      this.logAccess('removeConversation', userId, { conversationId });
      if (!this.hasSession(userId)) {
        return false;
      }
      const session = this.getSession(userId);
      const deleted = session.conversations.delete(conversationId);
      if (deleted) {
        session.isDirty = true;
        this.touchSession(userId);
        console.log(`🗑️ [MEMORY] Conversation ${conversationId} supprimée du cache pour l'utilisateur ${userId}`);
      }
      return deleted;
    } catch (error) {
      console.error(`❌ Erreur lors de la suppression de la conversation pour l'utilisateur ${userId}:`, error);
      return false;
    }
  }

  // Mettre à jour le lastMessage d'une conversation dans le cache pour tous les participants
  updateConversationLastMessage(conversationId: string, lastMessageId: any, participantUserIds: string[]): void {
    try {
      for (const odId of participantUserIds) {
        if (!this.hasSession(odId)) continue;

        const session = this.getSession(odId);
        const conversation = session.conversations.get(conversationId);

        if (conversation) {
          conversation.lastMessage = lastMessageId;
          conversation.updatedAt = new Date();
          session.isDirty = true;
          this.touchSession(odId);
          console.log(`🔄 [MEMORY] lastMessage mis à jour pour conversation ${conversationId} (user: ${odId})`);
        }
      }
    } catch (error) {
      console.error(`❌ Erreur lors de la mise à jour du lastMessage:`, error);
    }
  }

  // Récupérer un point par ID
  getPointById(userId: string, pointId: string): IPoint | undefined {
    this.logAccess('getPointById', userId, { pointId });
    const session = this.getSession(userId);
    this.touchSession(userId);
    return session.points.get(pointId);
  }

  // Récupérer une fiche par ID
  getFicheById(userId: string, ficheId: string): IFiche | undefined {
    this.logAccess('getFicheById', userId, { ficheId });
    const session = this.getSession(userId);
    this.touchSession(userId);
    return session.fiches.get(ficheId);
  }

  // Récupérer une liste par ID
  getListById(userId: string, listId: string): IList | undefined {
    this.logAccess('getListById', userId, { listId });
    const session = this.getSession(userId);
    this.touchSession(userId);
    return session.lists.get(listId);
  }

  // Récupérer une conversation par ID
  getConversationById(userId: string, conversationId: string): IConversation | undefined {
    this.logAccess('getConversationById', userId, { conversationId });
    const session = this.getSession(userId);
    this.touchSession(userId);
    return session.conversations.get(conversationId);
  }

  // Récupérer tous les points d'un utilisateur
  getAllPoints(userId: string): IPoint[] {
    try {
      this.logAccess('getAllPoints', userId);
      const session = this.getSession(userId);
      this.touchSession(userId);
      return Array.from(session.points.values());
    } catch (error) {
      console.error(`❌ Erreur lors de la récupération des points pour l'utilisateur ${userId}:`, error);
      return [];
    }
  }

  // Rechercher des points avec filtres
  searchPoints(
    userId: string,
    filters: {
      query?: string;
      ficheId?: string;
      listId?: string;
    }
  ): IPoint[] {
    try {
      this.logAccess('searchPoints', userId, filters);
      const session = this.getSession(userId);
      this.touchSession(userId);

      let results = Array.from(session.points.values());

      // Filtre par recherche textuelle (nom et description)
      if (filters.query && filters.query.trim()) {
        const searchTerm = filters.query.toLowerCase().trim();
        results = results.filter(point => {
          const nameMatch = point.name?.toLowerCase().includes(searchTerm);
          const descMatch = point.description?.toLowerCase().includes(searchTerm);
          return nameMatch || descMatch;
        });
      }

      // Filtre par ficheId
      if (filters.ficheId) {
        results = results.filter(point => {
          const pointFicheId = (point as any).ficheId;
          if (!pointFicheId) return false;

          // Gérer le cas où ficheId est un array ou un ObjectId unique
          if (Array.isArray(pointFicheId)) {
            return pointFicheId.some(fid => fid.toString() === filters.ficheId);
          }
          return pointFicheId.toString() === filters.ficheId;
        });
      }

      // Filtre par listId
      if (filters.listId) {
        results = results.filter(point => {
          const pointListIds = (point as any).listIds;
          if (!pointListIds || !Array.isArray(pointListIds)) return false;
          return pointListIds.includes(filters.listId);
        });
      }

      return results;
    } catch (error) {
      console.error(`❌ Erreur lors de la recherche de points pour l'utilisateur ${userId}:`, error);
      return [];
    }
  }

  // Récupérer toutes les fiches d'un utilisateur
  getAllFiches(userId: string): IFiche[] {
    this.logAccess('getAllFiches', userId);
    const session = this.getSession(userId);
    this.touchSession(userId);
    return Array.from(session.fiches.values());
  }

  // Récupérer toutes les listes d'un utilisateur
  getAllLists(userId: string): IList[] {
    this.logAccess('getAllLists', userId);
    const session = this.getSession(userId);
    this.touchSession(userId);
    return Array.from(session.lists.values());
  }

  // Récupérer toutes les conversations d'un utilisateur
  getAllConversations(userId: string): IConversation[] {
    this.logAccess('getAllConversations', userId);
    const session = this.getSession(userId);
    this.touchSession(userId);
    return Array.from(session.conversations.values());
  }

  // Supprimer un point
  deletePoint(userId: string, pointId: string): boolean {
    try {
      this.logAccess('deletePoint', userId, { pointId });
      const session = this.getSession(userId);
      
      // Récupérer le point avant suppression
      const point = session.points.get(pointId);
      if (!point) {
        return false;
      }
      
      // Vérifier si le point est associé à une fiche et retirer cette association
      if ((point as any).ficheId) {
        try {
          const ficheId = (point as any).ficheId.toString();
          const fiche = session.fiches.get(ficheId);
          
          if (fiche && fiche.points_ids) {
            // Supprimer le point de la liste des points de la fiche
            fiche.points_ids = fiche.points_ids.filter(id => id.toString() !== pointId);
            console.log(`Point ${pointId} retiré de la fiche ${ficheId}`);
          }
        } catch (refError) {
          console.error(`Erreur lors de la suppression de la référence du point ${pointId} dans sa fiche:`, refError);
        }
      }
      
      // Supprimer le point de toutes les listes où il apparaît
      try {
        for (const [listId, list] of session.lists.entries()) {
          if (list.points && list.points.some(id => id.toString() === pointId)) {
            list.points = list.points.filter(id => id.toString() !== pointId);
            console.log(`Point ${pointId} retiré de la liste ${listId}`);
          }
        }
      } catch (listError) {
        console.error(`Erreur lors de la suppression du point ${pointId} des listes:`, listError);
      }
      
      // Supprimer le point
      const result = session.points.delete(pointId);
      if (result) {
        session.isDirty = true;
        this.touchSession(userId);
      }
      return result;
    } catch (error) {
      console.error(`Erreur lors de la suppression du point ${pointId}:`, error);
      return false;
    }
  }

  // Supprimer une fiche
  deleteFiche(userId: string, ficheId: string): boolean {
    try {
      this.logAccess('deleteFiche', userId, { ficheId });
      const session = this.getSession(userId);
      
      // Récupérer la fiche avant suppression
      const fiche = session.fiches.get(ficheId);
      if (!fiche) {
        return false;
      }
      
      // Supprimer les références à cette fiche dans tous les points associés
      if (fiche.points_ids && fiche.points_ids.length > 0) {
        for (const pointIdObj of fiche.points_ids) {
          try {
            const pointId = pointIdObj.toString();
            const point = session.points.get(pointId);
            
            if (point && (point as any).ficheId && (point as any).ficheId.toString() === ficheId) {
              (point as any).ficheId = undefined;
              console.log(`Référence à la fiche ${ficheId} supprimée du point ${pointId}`);
            }
          } catch (pointRefError) {
            console.error(`Erreur lors de la suppression de la référence à la fiche ${ficheId} dans le point:`, pointRefError);
          }
        }
      }
      
      // Supprimer la fiche
      const result = session.fiches.delete(ficheId);
      if (result) {
        session.isDirty = true;
        this.touchSession(userId);
      }
      return result;
    } catch (error) {
      console.error(`Erreur lors de la suppression de la fiche ${ficheId}:`, error);
      return false;
    }
  }

  // Supprimer une liste
  deleteList(userId: string, listId: string): boolean {
    try {
      this.logAccess('deleteList', userId, { listId });
      const session = this.getSession(userId);
      
      // Récupérer la liste avant suppression (pour référence)
      const list = session.lists.get(listId);
      if (!list) {
        return false;
      }
      
      // Supprimer la liste
      const result = session.lists.delete(listId);
      if (result) {
        session.isDirty = true;
        this.touchSession(userId);
      }
      return result;
    } catch (error) {
      console.error(`❌ Erreur lors de la suppression de la liste ${listId}:`, error);
      return false;
    }
  }

  // Vérifier si les données ont été modifiées
  isDirty(userId: string): boolean {
    this.logAccess('isDirty', userId);
    const session = this.getSession(userId);
    return session.isDirty;
  }

  // Marquer comme synchronisé
  markAsSynced(userId: string): void {
    this.logAccess('markAsSynced', userId);
    const session = this.getSession(userId);
    session.isDirty = false;
    this.touchSession(userId);
  }

  // Terminer une session
  endSession(userId: string): void {
    this.logAccess('endSession', userId);
    this.sessions.delete(userId);
  }

  // Nettoyer les sessions expirées
  private cleanExpiredSessions(): void {
    const now = new Date();
    let expiredSessions = 0;
    
    for (const [userId, session] of this.sessions.entries()) {
      const elapsed = now.getTime() - session.lastAccessed.getTime();
      if (elapsed > this.SESSION_TIMEOUT) {
        this.endSession(userId);
        expiredSessions++;
      }
    }
    
    if (expiredSessions > 0) {
      console.log(`🧹 Nettoyage: ${expiredSessions} sessions expirées supprimées. ${this.sessions.size} sessions actives.`);
    }
  }

  // ============ GESTION DES CONTACTS ============

  // Stocker un contact
  storeContact(userId: string, contact: IContact): boolean {
    try {
      this.logAccess('storeContact', userId, { contactId: contact._id });
      const session = this.getSession(userId);

      if (!contact._id) {
        throw new Error("Impossible de stocker un contact sans ID");
      }

      session.contacts.set(contact._id.toString(), contact);
      session.isDirty = true;
      this.touchSession(userId);
      return true;
    } catch (error) {
      console.error(`❌ Erreur lors du stockage du contact pour l'utilisateur ${userId}:`, error);
      return false;
    }
  }

  // Récupérer un contact par ID
  getContact(userId: string, contactId: string): IContact | undefined {
    this.logAccess('getContact', userId, { contactId });
    const session = this.getSession(userId);
    this.touchSession(userId);
    return session.contacts.get(contactId);
  }

  // Récupérer tous les contacts d'un utilisateur (avec filtre optionnel par statut)
  getContacts(userId: string, status?: string): IContact[] {
    this.logAccess('getContacts', userId, { status });
    const session = this.getSession(userId);
    this.touchSession(userId);

    let contacts = Array.from(session.contacts.values());

    if (status) {
      contacts = contacts.filter(contact => contact.status === status);
    }

    return contacts;
  }

  // Supprimer un contact
  deleteContact(userId: string, contactId: string): boolean {
    try {
      this.logAccess('deleteContact', userId, { contactId });
      const session = this.getSession(userId);

      const result = session.contacts.delete(contactId);
      if (result) {
        session.isDirty = true;
        this.touchSession(userId);
      }
      return result;
    } catch (error) {
      console.error(`❌ Erreur lors de la suppression du contact ${contactId}:`, error);
      return false;
    }
  }

  // Obtenir des points par IDs
  getPointsByIds(userId: string, pointIds: string[]): IPoint[] {
    this.logAccess('getPointsByIds', userId, { pointCount: pointIds.length });
    const session = this.getSession(userId);
    this.touchSession(userId);
    return pointIds
      .map(id => session.points.get(id))
      .filter((point): point is IPoint => point !== undefined);
  }
  
  // Obtenir des points pour une fiche spécifique
  getPointsByFicheId(userId: string, ficheId: string): IPoint[] {
    this.logAccess('getPointsByFicheId', userId, { ficheId });
    const session = this.getSession(userId);
    const fiche = session.fiches.get(ficheId);
    if (!fiche) return [];
    
    return this.getPointsByIds(userId, fiche.points_ids.map(id => id.toString()));
  }

  // Ajouter un point à une fiche
  addPointToFiche(userId: string, ficheId: string, pointId: string): boolean {
    try {
      this.logAccess('addPointToFiche', userId, { ficheId, pointId });
      const session = this.getSession(userId);
      const fiche = session.fiches.get(ficheId);
      const point = session.points.get(pointId);
      
      // Debug: lister les fiches disponibles
      console.log(`[addPointToFiche] Fiches en mémoire pour ${userId}:`, Array.from(session.fiches.keys()));

      if (!point) {
        console.warn(`[addPointToFiche] Point ${pointId} n'existe pas en mémoire pour l'utilisateur ${userId}`);
        return false;
      }

      if (!fiche) {
        console.warn(`[addPointToFiche] Fiche ${ficheId} n'existe pas en mémoire pour l'utilisateur ${userId}`);
        console.warn(`[addPointToFiche] Fiches disponibles:`, Array.from(session.fiches.keys()));
        return false;
      }
      
      // Ajouter le point à la fiche s'il n'existe pas déjà
      if (!fiche.points_ids.some(id => id.toString() === pointId)) {
        fiche.points_ids.push(pointId as any);
        
        // Stockage de ficheId comme ObjectID explicite
        try {
          // Convertir en ObjectID si ce n'est pas déjà fait
          const objectIdFicheId = mongoose.Types.ObjectId.isValid(ficheId) 
            ? new mongoose.Types.ObjectId(ficheId)
            : ficheId;
          
          // Assigner la valeur ObjectID au point
          (point as any).ficheId = objectIdFicheId;
          
          console.log(`Point ${pointId} associé à la fiche ${ficheId} avec ficheId: ${(point as any).ficheId}`);
        } catch (idError) {
          if (idError instanceof Error) {
            console.error(`Erreur lors de la conversion de ficheId en ObjectID: ${idError.message}`);
          } else {
            console.error(`Erreur lors de la conversion de ficheId en ObjectID:`, idError);
          }
          // Fallback à une chaîne simple si la conversion échoue
          (point as any).ficheId = ficheId;
        }
        
        session.isDirty = true;
        this.touchSession(userId);
        return true;
      }
      
      return false;
    } catch (error) {
      console.error(`❌ Erreur lors de l'ajout du point ${pointId} à la fiche ${ficheId} pour l'utilisateur ${userId}:`, error);
      return false;
    }
  }

  // Supprimer un point d'une fiche
  removePointFromFiche(userId: string, ficheId: string, pointId: string): boolean {
    try {
      this.logAccess('removePointFromFiche', userId, { ficheId, pointId });
      const session = this.getSession(userId);
      const fiche = session.fiches.get(ficheId);
      const point = session.points.get(pointId);
      
      if (!fiche) {
        console.warn(`Tentative de supprimer un point (${pointId}) d'une fiche (${ficheId}) qui n'existe pas`);
        return false;
      }
      
      const initialLength = fiche.points_ids.length;
      
      // 1. Supprimer l'ID du point de la liste des points de la fiche
      try {
        fiche.points_ids = fiche.points_ids.filter(id => id.toString() !== pointId);
      } catch (filterError) {
        console.error(`❌ Erreur lors du filtrage des points_ids pour la fiche ${ficheId}:`, filterError);
        return false;
      }
      
      // 2. Si le point existe, supprimer sa référence à cette fiche
      if (point) {
        try {
          // Vérifier si le point est associé à la fiche qu'on modifie
          if ((point as any).ficheId && (point as any).ficheId.toString() === ficheId) {
            console.log(`Suppression de la référence à la fiche ${ficheId} dans le point ${pointId}`);
            (point as any).ficheId = undefined;
          }
        } catch (pointError) {
          console.error(`❌ Erreur lors de la suppression du ficheId du point ${pointId}:`, pointError);
          // On continue malgré l'erreur pour au moins mettre à jour la fiche
        }
      }
      
      // 3. Marquer comme modifié seulement si quelque chose a changé
      if (fiche.points_ids.length !== initialLength) {
        session.isDirty = true;
        this.touchSession(userId);
        return true;
      }
      
      return false;
    } catch (error) {
      console.error(`❌ Erreur lors de la suppression du point ${pointId} de la fiche ${ficheId}:`, error);
      return false;
    }
  }

  // Ajouter des points à une liste
  addPointToList(userId: string, listId: string, pointId: string): boolean {
    try {
      this.logAccess('addPointToList', userId, { listId, pointId });
      const session = this.getSession(userId);
      const list = session.lists.get(listId);
      const point = session.points.get(pointId);
      
      if (!list || !point) {
        console.warn(`Tentative d'ajouter un point (${pointId}) à une liste (${listId}) qui n'existe pas pour l'utilisateur ${userId}`);
        return false;
      }
      
      // Initialiser pointIds s'il n'existe pas
      if (!list.points) {
        list.points = [];
      }
      
      // Ajouter le point à la liste s'il n'existe pas déjà
      if (!list.points.some(id => id.toString() === pointId)) {
        list.points.push(pointId as any);
        session.isDirty = true;
        this.touchSession(userId);
        return true;
      }
      
      return false;
    } catch (error) {
      console.error(`❌ Erreur lors de l'ajout du point ${pointId} à la liste ${listId}:`, error);
      return false;
    }
  }

  // Supprimer un point d'une liste
  removePointFromList(userId: string, listId: string, pointId: string): boolean {
    try {
      this.logAccess('removePointFromList', userId, { listId, pointId });
      const session = this.getSession(userId);
      const list = session.lists.get(listId);
      
      if (!list || !list.points) {
        return false;
      }
      
      const initialLength = list.points.length;
      
      // Filtrer pour enlever le point spécifié
      list.points = list.points.filter(id => id.toString() !== pointId);
      
      // Vérifier si le point a été retiré
      if (list.points.length !== initialLength) {
        session.isDirty = true;
        this.touchSession(userId);
        return true;
      }
      
      return false;
    } catch (error) {
      console.error(`❌ Erreur lors de la suppression du point ${pointId} de la liste ${listId}:`, error);
      return false;
    }
  }

  // Obtenir les points d'une liste spécifique
  getPointsByListId(userId: string, listId: string): IPoint[] {
    try {
      this.logAccess('getPointsByListId', userId, { listId });
      const session = this.getSession(userId);
      const list = session.lists.get(listId);
      
      if (!list || !list.points) return [];
      
      // Récupérer tous les points qui sont dans la liste
      return this.getPointsByIds(userId, list.points.map(id => id.toString()));
    } catch (error) {
      console.error(`❌ Erreur lors de la récupération des points pour la liste ${listId}:`, error);
      return [];
    }
  }

  // Obtenir toutes les listes contenant un point spécifique
  getListsByPointId(userId: string, pointId: string): IList[] {
    try {
      this.logAccess('getListsByPointId', userId, { pointId });
      const session = this.getSession(userId);
      
      return Array.from(session.lists.values()).filter(list => 
        list.points && list.points.some(id => id.toString() === pointId)
      );
    } catch (error) {
      console.error(`❌ Erreur lors de la récupération des listes contenant le point ${pointId}:`, error);
      return [];
    }
  }

  // Mettre à jour l'ordre des points dans une liste
  updateListPointsOrder(userId: string, listId: string, orderedPointIds: string[]): boolean {
    try {
      this.logAccess('updateListPointsOrder', userId, { listId });
      const session = this.getSession(userId);
      const list = session.lists.get(listId);
      
      if (!list) {
        return false;
      }
      
      // Vérifier que tous les IDs fournis correspondent à des points existants dans la liste
      const existingPointIds = new Set(list.points?.map(id => id.toString()) || []);
      const validPointIds = orderedPointIds.filter(id => existingPointIds.has(id));
      
      // Vérifier que nous avons le même nombre de points
      if (validPointIds.length !== existingPointIds.size) {
        console.warn(`Certains points dans la liste ne sont pas dans la nouvelle séquence ou des points invalides ont été fournis`);
        return false;
      }
      
      // Mettre à jour la liste avec le nouvel ordre
      list.points = validPointIds.map(id => id as any);
      session.isDirty = true;
      this.touchSession(userId);
      return true;
    } catch (error) {
      console.error(`❌ Erreur lors de la mise à jour de l'ordre des points dans la liste ${listId}:`, error);
      return false;
    }
  }

  // Vérifier si un point est dans une liste
  isPointInList(userId: string, listId: string, pointId: string): boolean {
    try {
      this.logAccess('isPointInList', userId, { listId, pointId });
      const session = this.getSession(userId);
      const list = session.lists.get(listId);
      
      if (!list || !list.points) {
        return false;
      }
      
      return list.points.some(id => id.toString() === pointId);
    } catch (error) {
      console.error(`❌ Erreur lors de la vérification si le point ${pointId} est dans la liste ${listId}:`, error);
      return false;
    }
  }

  // Mise à jour complète d'une liste existante
  updateList(userId: string, listId: string, updatedData: Partial<IList>): boolean {
    try {
      this.logAccess('updateList', userId, { listId });
      const session = this.getSession(userId);
      const list = session.lists.get(listId);
      
      if (!list) {
        return false;
      }
      
      // Mettre à jour les propriétés modifiables
      if (updatedData.name !== undefined) list.name = updatedData.name;
      if (updatedData.description !== undefined) list.description = updatedData.description;
      if (updatedData.color !== undefined) list.color = updatedData.color;
      if (updatedData.icon !== undefined) list.icon = updatedData.icon;
      
      // Mettre à jour pointIds seulement si explicitement fourni
      if (updatedData.points !== undefined) {
        // Vérifier que tous les points existent
        const validPointIds = updatedData.points.filter(id => 
          session.points.has(id.toString())
        );
        list.points = validPointIds;
      }
      
      // Mettre à jour la date de modification
      list.updatedAt = new Date();
      
      session.isDirty = true;
      this.touchSession(userId);
      return true;
    } catch (error) {
      console.error(`❌ Erreur lors de la mise à jour de la liste ${listId}:`, error);
      return false;
    }
  }

  // Mise à jour de getAllUserData pour inclure les listes
  getAllUserData(userId: string): Record<string, any> {
    try {
      this.logAccess('getAllUserData', userId);
      const userData: Record<string, any> = {};
      const session = this.sessions.get(userId);
      
      if (!session) {
        throw new Error(`Session non trouvée pour l'utilisateur ${userId}`);
      }
      
      try {
        userData.points = Array.from(session.points.values());
      } catch (pointsError) {
        console.error(`Erreur lors de la récupération des points:`, pointsError);
        userData.points = [];
        userData.pointsError = "Erreur lors de la récupération des points";
      }
      
      try {
        userData.fiches = Array.from(session.fiches.values());
      } catch (fichesError) {
        console.error(`Erreur lors de la récupération des fiches:`, fichesError);
        userData.fiches = [];
        userData.fichesError = "Erreur lors de la récupération des fiches";
      }
      
      try {
        userData.lists = Array.from(session.lists.values());
      } catch (listsError) {
        console.error(`Erreur lors de la récupération des listes:`, listsError);
        userData.lists = [];
        userData.listsError = "Erreur lors de la récupération des listes";
      }
      
      userData.encryptionKey = session.encryptionKey;
      userData.lastAccessed = session.lastAccessed;
      userData.isDirty = session.isDirty;
      userData.user = { id: userId };
      
      return userData;
    } catch (error) {
      console.error(`❌ Erreur lors de la récupération des données utilisateur ${userId}:`, error);
      return { error: `Impossible de récupérer les données utilisateur: ${error instanceof Error ? getErrorMessage(error) : String(error)}` };
    }
  }

  // Méthode pour obtenir les statistiques d'utilisation de la mémoire
  getUsageStats(): any {
    return {
      activeSessions: this.sessions.size,
      totalAccesses: this.accessCounter,
      memoryUsage: process.memoryUsage(),
      uptime: process.uptime()
    };
  }

  // Trouver une fiche par pointId
  getFicheByPointId(userId: string, pointId: string): IFiche | undefined {
    try {
      this.logAccess('getFicheByPointId', userId, { pointId });
      const session = this.getSession(userId);
      const point = session.points.get(pointId);
      
      if (!point || !point.ficheId) {
        return undefined;
      }
      
      // Récupérer la fiche associée au point
      return session.fiches.get(point.ficheId.toString());
    } catch (error) {
      console.error(`❌ Erreur lors de la récupération de la fiche pour le point ${pointId}:`, error);
      return undefined;
    }
  }

  // Récupérer la clé de chiffrement d'un utilisateur
  getUserEncryptionKey(userId: string): string {
    this.logAccess('getUserEncryptionKey', userId);
    const session = this.getSession(userId);
    this.touchSession(userId);
    return session.encryptionKey;
  }
}

export const memoryStorage = new MemoryStorageService();
