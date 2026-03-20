import { getErrorMessage } from "../utils/errorUtils";
import { logger } from "./loggerService";
import { IPoint } from "../models/points";
import { IFiche } from "../models/fiches";
import { IList } from "../models/lists";
import mongoose from "mongoose";
import { IConversation } from "../models/conversations";
import { IContact } from "../models/contacts";

// Create child logger for memory-storage service
const memoryLogger = logger.child({ service: "memory-storage" });

const MAX_ITEMS_PER_SESSION = {
  points: 5000,
  fiches: 1000,
  lists: 500,
  conversations: 200,
  contacts: 1000,
};

interface UserSession {
  points: Map<string, IPoint>; // ID → Point déchiffré
  fiches: Map<string, IFiche>; // ID → Fiche déchiffrée
  lists: Map<string, IList>; // ID → Liste déchiffrée (si nécessaire)
  conversations: Map<string, IConversation>; // ID → Conversation déchiffrée
  contacts: Map<string, IContact>; // ID → Contact
  encryptionKey: string;
  lastAccessed: Date;
  lastRefreshedAt: Date; // Dernier refresh depuis la DB (pour sync incrémental mobile → PC)
  isDirty: boolean; // Indique si les données ont été modifiées depuis le dernier sync
  dirtyPointIds: Set<string>; // IDs des points modifiés depuis le dernier sync
  dirtyFicheIds: Set<string>; // IDs des fiches modifiées depuis le dernier sync
  dirtyListIds: Set<string>; // IDs des listes modifiées depuis le dernier sync
}

export class MemoryStorageService {
  private sessions: Map<string, UserSession> = new Map();
  private readonly SESSION_TIMEOUT = 1000 * 60 * 30; // 30 minutes
  private accessCounter: Record<string, number> = {}; // Pour suivre le nombre d'accès
  private readonly STATS_RESET_INTERVAL = 1000 * 60 * 60; // 1 heure
  private lastStatsReset: Date = new Date();

  constructor() {
    // Démarrer un timer pour nettoyer les sessions expirées
    setInterval(() => this.cleanExpiredSessions(), 1000 * 60 * 5); // Toutes les 5 minutes

    // Démarrer un timer pour réinitialiser les statistiques d'accès (éviter fuite mémoire)
    setInterval(() => this.resetUsageStats(), this.STATS_RESET_INTERVAL);
  }

  private enforceLimit(map: Map<string, any>, maxSize: number): void {
    if (map.size >= maxSize) {
      const toDelete = Math.ceil(maxSize * 0.1);
      const keys = Array.from(map.keys()).slice(0, toDelete);
      for (const key of keys) {
        map.delete(key);
      }
    }
  }

  private logAccess(method: string, userId: string, _details?: any): void {
    // Vérifier que userId est défini
    if (!userId) {
      return;
    }

    // Incrémenter le compteur pour ce type d'accès
    if (!this.accessCounter[method]) {
      this.accessCounter[method] = 0;
    }
    this.accessCounter[method]++;
  }

  // Initialiser une session utilisateur avec toutes les données déchiffrées
  initSession(userId: string, encryptionKey: string): boolean {
    try {
      this.logAccess("initSession", userId);

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
        lastRefreshedAt: new Date(),
        isDirty: false,
        dirtyPointIds: new Set(),
        dirtyFicheIds: new Set(),
        dirtyListIds: new Set(),
      });

      return true;
    } catch (error) {
      memoryLogger.error("Failed to initialize session", {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  // Vérifier si une session existe pour un utilisateur
  hasSession(userId: string): boolean {
    if (!userId) {
      memoryLogger.warn("hasSession called without userId");
      return false;
    }
    this.logAccess("hasSession", userId);
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
      memoryLogger.error("getSession called without userId");
      throw new Error(
        "Session utilisateur non trouvée. Veuillez vous reconnecter.",
      );
    }

    // Log minimal pour cette méthode interne fréquemment appelée
    const session = this.sessions.get(userId);
    if (!session) {
      this.logAccess("getSession_ERROR", userId, {
        error: "Session non trouvée",
      });
      throw new Error(
        "Session utilisateur non trouvée. Veuillez vous reconnecter.",
      );
    }
    return session;
  }

  // Stocker un point déchiffré
  storePoint(userId: string, point: IPoint): boolean {
    try {
      this.logAccess("storePoint", userId, { pointId: point._id });
      const session = this.getSession(userId);

      if (!point._id) {
        throw new Error("Impossible de stocker un point sans ID");
      }

      this.enforceLimit(session.points, MAX_ITEMS_PER_SESSION.points);
      session.points.set(point._id.toString(), point);
      session.isDirty = true;
      session.dirtyPointIds.add(point._id.toString());
      this.touchSession(userId);
      return true;
    } catch (error) {
      memoryLogger.error("Failed to store point", {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  // Stocker une fiche déchiffrée
  storeFiche(userId: string, fiche: IFiche): boolean {
    try {
      this.logAccess("storeFiche", userId, { ficheId: fiche._id });
      const session = this.getSession(userId);

      if (!fiche._id) {
        throw new Error("Impossible de stocker une fiche sans ID");
      }

      this.enforceLimit(session.fiches, MAX_ITEMS_PER_SESSION.fiches);
      session.fiches.set(fiche._id.toString(), fiche);
      session.isDirty = true;
      session.dirtyFicheIds.add(fiche._id.toString());
      this.touchSession(userId);
      return true;
    } catch (error) {
      memoryLogger.error("Failed to store fiche", {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  // Stocker une liste déchiffrée
  storeList(userId: string, list: IList): boolean {
    try {
      this.logAccess("storeList", userId, { listId: list._id });
      const session = this.getSession(userId);

      if (!list._id) {
        throw new Error("Impossible de stocker une liste sans ID");
      }

      this.enforceLimit(session.lists, MAX_ITEMS_PER_SESSION.lists);
      session.lists.set(list._id.toString(), list);
      session.isDirty = true;
      session.dirtyListIds.add(list._id.toString());
      this.touchSession(userId);
      return true;
    } catch (error) {
      memoryLogger.error("Failed to store list", {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  // Stocker une conversation déchiffrée
  storeConversation(userId: string, conversation: IConversation): boolean {
    try {
      this.logAccess("storeConversation", userId, {
        conversationId: conversation._id,
      });
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
        deletedBy: conversation.deletedBy ?? [],
        mutedBy: conversation.mutedBy ?? [],
        archivedBy: conversation.archivedBy ?? [],
        pinnedBy: conversation.pinnedBy ?? [],
        markedUnreadBy: conversation.markedUnreadBy ?? [],
        blockedBy: conversation.blockedBy ?? [],
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
      } as IConversation;
      this.enforceLimit(
        session.conversations,
        MAX_ITEMS_PER_SESSION.conversations,
      );
      session.conversations.set(
        conversation._id.toString(),
        conversationToStore,
      );
      session.isDirty = true;
      this.touchSession(userId);
      return true;
    } catch (error) {
      memoryLogger.error("Failed to store conversation", {
        userId,
        conversationId: conversation._id?.toString(),
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  // Supprimer une conversation du cache
  removeConversation(userId: string, conversationId: string): boolean {
    try {
      this.logAccess("removeConversation", userId, { conversationId });
      if (!this.hasSession(userId)) {
        return false;
      }
      const session = this.getSession(userId);
      const deleted = session.conversations.delete(conversationId);
      if (deleted) {
        session.isDirty = true;
        this.touchSession(userId);
      }
      return deleted;
    } catch (error) {
      memoryLogger.error("Failed to remove conversation", {
        userId,
        conversationId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  // Mettre à jour le lastMessage d'une conversation dans le cache pour tous les participants
  updateConversationLastMessage(
    conversationId: string,
    lastMessageId: any,
    participantUserIds: string[],
  ): void {
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
        }
      }
    } catch (error) {
      memoryLogger.error("Failed to update conversation lastMessage", {
        conversationId,
        participantCount: participantUserIds.length,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Récupérer un point par ID
  getPointById(userId: string, pointId: string): IPoint | undefined {
    this.logAccess("getPointById", userId, { pointId });
    const session = this.getSession(userId);
    this.touchSession(userId);
    return session.points.get(pointId);
  }

  // Récupérer une fiche par ID
  getFicheById(userId: string, ficheId: string): IFiche | undefined {
    this.logAccess("getFicheById", userId, { ficheId });
    const session = this.getSession(userId);
    this.touchSession(userId);
    return session.fiches.get(ficheId);
  }

  // Récupérer une liste par ID
  getListById(userId: string, listId: string): IList | undefined {
    this.logAccess("getListById", userId, { listId });
    const session = this.getSession(userId);
    this.touchSession(userId);
    return session.lists.get(listId);
  }

  // Récupérer une conversation par ID
  getConversationById(
    userId: string,
    conversationId: string,
  ): IConversation | undefined {
    this.logAccess("getConversationById", userId, { conversationId });
    const session = this.getSession(userId);
    this.touchSession(userId);
    return session.conversations.get(conversationId);
  }

  // Récupérer tous les points d'un utilisateur
  getAllPoints(userId: string): IPoint[] {
    try {
      this.logAccess("getAllPoints", userId);
      const session = this.getSession(userId);
      this.touchSession(userId);
      return Array.from(session.points.values());
    } catch (error) {
      memoryLogger.error("Failed to get all points", {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
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
    },
  ): IPoint[] {
    try {
      this.logAccess("searchPoints", userId, filters);
      const session = this.getSession(userId);
      this.touchSession(userId);

      let results = Array.from(session.points.values());

      // Filtre par recherche textuelle (nom et description)
      if (filters.query && filters.query.trim()) {
        const searchTerm = filters.query.toLowerCase().trim();
        results = results.filter((point) => {
          const nameMatch = point.name?.toLowerCase().includes(searchTerm);
          const descMatch = point.description
            ?.toLowerCase()
            .includes(searchTerm);
          return nameMatch || descMatch;
        });
      }

      // Filtre par ficheId
      if (filters.ficheId) {
        results = results.filter((point) => {
          const pointFicheId = (point as any).ficheId;
          if (!pointFicheId) return false;

          // Gérer le cas où ficheId est un array ou un ObjectId unique
          if (Array.isArray(pointFicheId)) {
            return pointFicheId.some(
              (fid) => fid.toString() === filters.ficheId,
            );
          }
          return pointFicheId.toString() === filters.ficheId;
        });
      }

      // Filtre par listId
      if (filters.listId) {
        results = results.filter((point) => {
          const pointListIds = (point as any).listIds;
          if (!pointListIds || !Array.isArray(pointListIds)) return false;
          return pointListIds.includes(filters.listId);
        });
      }

      return results;
    } catch (error) {
      memoryLogger.error("Failed to search points", {
        userId,
        filters,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  // Récupérer toutes les fiches d'un utilisateur
  getAllFiches(userId: string): IFiche[] {
    this.logAccess("getAllFiches", userId);
    const session = this.getSession(userId);
    this.touchSession(userId);
    return Array.from(session.fiches.values());
  }

  // Récupérer toutes les listes d'un utilisateur
  getAllLists(userId: string): IList[] {
    this.logAccess("getAllLists", userId);
    const session = this.getSession(userId);
    this.touchSession(userId);
    return Array.from(session.lists.values());
  }

  // Récupérer toutes les conversations d'un utilisateur
  getAllConversations(userId: string): IConversation[] {
    this.logAccess("getAllConversations", userId);
    const session = this.getSession(userId);
    this.touchSession(userId);
    return Array.from(session.conversations.values());
  }

  // Supprimer un point
  deletePoint(userId: string, pointId: string): boolean {
    try {
      this.logAccess("deletePoint", userId, { pointId });
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
            fiche.points_ids = fiche.points_ids.filter(
              (id) => id.toString() !== pointId,
            );
            session.dirtyFicheIds.add(ficheId);
          }
        } catch (refError) {
          memoryLogger.error("Failed to remove point reference from fiche", {
            pointId,
            ficheId: (point as any).ficheId?.toString(),
            error:
              refError instanceof Error ? refError.message : String(refError),
          });
        }
      }

      // Supprimer le point de toutes les listes où il apparaît
      try {
        for (const [listId, list] of session.lists.entries()) {
          if (
            list.points &&
            list.points.some((id) => id.toString() === pointId)
          ) {
            list.points = list.points.filter((id) => id.toString() !== pointId);
            session.dirtyListIds.add(listId);
          }
        }
      } catch (listError) {
        memoryLogger.error("Failed to remove point from lists", {
          pointId,
          error:
            listError instanceof Error ? listError.message : String(listError),
        });
      }

      // Supprimer le point
      const result = session.points.delete(pointId);
      if (result) {
        session.isDirty = true;
        this.touchSession(userId);
      }
      return result;
    } catch (error) {
      memoryLogger.error("Failed to delete point", {
        userId,
        pointId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  // Supprimer une fiche
  deleteFiche(userId: string, ficheId: string): boolean {
    try {
      this.logAccess("deleteFiche", userId, { ficheId });
      const session = this.getSession(userId);

      // Récupérer la fiche avant suppression
      const fiche = session.fiches.get(ficheId);
      if (!fiche) {
        return false;
      }

      // Supprimer les références à cette fiche dans tous les points associés
      if (fiche.points_ids && fiche.points_ids.length > 0) {
        for (const pointIdObj of fiche.points_ids) {
          const pointId = pointIdObj.toString();
          try {
            const point = session.points.get(pointId);

            if (
              point &&
              (point as any).ficheId &&
              (point as any).ficheId.toString() === ficheId
            ) {
              (point as any).ficheId = undefined;
              session.dirtyPointIds.add(pointId);
            }
          } catch (pointRefError) {
            memoryLogger.error("Failed to remove fiche reference from point", {
              ficheId,
              pointId,
              error:
                pointRefError instanceof Error
                  ? pointRefError.message
                  : String(pointRefError),
            });
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
      memoryLogger.error("Failed to delete fiche", {
        userId,
        ficheId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  // Supprimer une liste
  deleteList(userId: string, listId: string): boolean {
    try {
      this.logAccess("deleteList", userId, { listId });
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
      memoryLogger.error("Failed to delete list", {
        userId,
        listId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  // Vérifier si les données ont été modifiées
  isDirty(userId: string): boolean {
    this.logAccess("isDirty", userId);
    const session = this.getSession(userId);
    return session.isDirty;
  }

  // Marquer comme synchronisé
  markAsSynced(userId: string): void {
    this.logAccess("markAsSynced", userId);
    const session = this.getSession(userId);
    session.isDirty = false;
    session.dirtyPointIds.clear();
    session.dirtyFicheIds.clear();
    session.dirtyListIds.clear();
    this.touchSession(userId);
  }

  // Récupérer les IDs des points modifiés depuis le dernier sync
  getDirtyPointIds(userId: string): Set<string> {
    const session = this.getSession(userId);
    return new Set(session.dirtyPointIds);
  }

  // Récupérer les IDs des fiches modifiées depuis le dernier sync
  getDirtyFicheIds(userId: string): Set<string> {
    const session = this.getSession(userId);
    return new Set(session.dirtyFicheIds);
  }

  // Récupérer les IDs des listes modifiées depuis le dernier sync
  getDirtyListIds(userId: string): Set<string> {
    const session = this.getSession(userId);
    return new Set(session.dirtyListIds);
  }

  // Récupérer la date du dernier refresh depuis la DB
  getLastRefreshedAt(userId: string): Date {
    const session = this.getSession(userId);
    return session.lastRefreshedAt;
  }

  // Mettre à jour la date du dernier refresh
  setLastRefreshedAt(userId: string, date: Date): void {
    const session = this.getSession(userId);
    session.lastRefreshedAt = date;
  }

  // Terminer une session
  endSession(userId: string): void {
    this.logAccess("endSession", userId);
    this.sessions.delete(userId);
  }

  // Nettoyer les sessions expirées
  private cleanExpiredSessions(): void {
    const now = new Date();

    for (const [userId, session] of this.sessions.entries()) {
      const elapsed = now.getTime() - session.lastAccessed.getTime();
      if (elapsed > this.SESSION_TIMEOUT) {
        this.endSession(userId);
      }
    }
  }

  // ============ GESTION DES CONTACTS ============

  // Stocker un contact
  storeContact(userId: string, contact: IContact): boolean {
    try {
      this.logAccess("storeContact", userId, { contactId: contact._id });
      const session = this.getSession(userId);

      if (!contact._id) {
        throw new Error("Impossible de stocker un contact sans ID");
      }

      this.enforceLimit(session.contacts, MAX_ITEMS_PER_SESSION.contacts);
      session.contacts.set(contact._id.toString(), contact);
      session.isDirty = true;
      this.touchSession(userId);
      return true;
    } catch (error) {
      memoryLogger.error("Failed to store contact", {
        userId,
        contactId: contact._id?.toString(),
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  // Récupérer un contact par ID
  getContact(userId: string, contactId: string): IContact | undefined {
    this.logAccess("getContact", userId, { contactId });
    const session = this.getSession(userId);
    this.touchSession(userId);
    return session.contacts.get(contactId);
  }

  // Récupérer tous les contacts d'un utilisateur (avec filtre optionnel par statut)
  getContacts(userId: string, status?: string): IContact[] {
    this.logAccess("getContacts", userId, { status });
    const session = this.getSession(userId);
    this.touchSession(userId);

    let contacts = Array.from(session.contacts.values());

    if (status) {
      contacts = contacts.filter((contact) => contact.status === status);
    }

    return contacts;
  }

  // Supprimer un contact
  deleteContact(userId: string, contactId: string): boolean {
    try {
      this.logAccess("deleteContact", userId, { contactId });
      const session = this.getSession(userId);

      const result = session.contacts.delete(contactId);
      if (result) {
        session.isDirty = true;
        this.touchSession(userId);
      }
      return result;
    } catch (error) {
      memoryLogger.error("Failed to delete contact", {
        userId,
        contactId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  // Obtenir des points par IDs
  getPointsByIds(userId: string, pointIds: string[]): IPoint[] {
    this.logAccess("getPointsByIds", userId, { pointCount: pointIds.length });
    const session = this.getSession(userId);
    this.touchSession(userId);
    return pointIds
      .map((id) => session.points.get(id))
      .filter((point): point is IPoint => point !== undefined);
  }

  // Obtenir des points pour une fiche spécifique
  getPointsByFicheId(userId: string, ficheId: string): IPoint[] {
    this.logAccess("getPointsByFicheId", userId, { ficheId });
    const session = this.getSession(userId);
    const fiche = session.fiches.get(ficheId);
    if (!fiche) return [];

    return this.getPointsByIds(
      userId,
      fiche.points_ids.map((id) => id.toString()),
    );
  }

  // Ajouter un point à une fiche
  addPointToFiche(userId: string, ficheId: string, pointId: string): boolean {
    try {
      this.logAccess("addPointToFiche", userId, { ficheId, pointId });
      const session = this.getSession(userId);
      const fiche = session.fiches.get(ficheId);
      const point = session.points.get(pointId);

      if (!point) {
        return false;
      }

      if (!fiche) {
        return false;
      }

      // Ajouter le point à la fiche s'il n'existe pas déjà
      if (!fiche.points_ids.some((id) => id.toString() === pointId)) {
        fiche.points_ids.push(pointId as any);

        // Stockage de ficheId comme ObjectID explicite
        try {
          // Convertir en ObjectID si ce n'est pas déjà fait
          const objectIdFicheId = mongoose.Types.ObjectId.isValid(ficheId)
            ? new mongoose.Types.ObjectId(ficheId)
            : ficheId;

          // Assigner la valeur ObjectID au point
          (point as any).ficheId = objectIdFicheId;
        } catch (_idError) {
          // Fallback à une chaîne simple si la conversion échoue
          (point as any).ficheId = ficheId;
        }

        session.isDirty = true;
        session.dirtyFicheIds.add(ficheId);
        session.dirtyPointIds.add(pointId);
        this.touchSession(userId);
        return true;
      }

      return false;
    } catch (error) {
      memoryLogger.error("Failed to add point to fiche", {
        userId,
        ficheId,
        pointId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  // Supprimer un point d'une fiche
  removePointFromFiche(
    userId: string,
    ficheId: string,
    pointId: string,
  ): boolean {
    try {
      this.logAccess("removePointFromFiche", userId, { ficheId, pointId });
      const session = this.getSession(userId);
      const fiche = session.fiches.get(ficheId);
      const point = session.points.get(pointId);

      if (!fiche) {
        return false;
      }

      const initialLength = fiche.points_ids.length;

      // 1. Supprimer l'ID du point de la liste des points de la fiche
      try {
        fiche.points_ids = fiche.points_ids.filter(
          (id) => id.toString() !== pointId,
        );
      } catch (_filterError) {
        return false;
      }

      // 2. Si le point existe, supprimer sa référence à cette fiche
      if (point) {
        try {
          // Vérifier si le point est associé à la fiche qu'on modifie
          if (
            (point as any).ficheId &&
            (point as any).ficheId.toString() === ficheId
          ) {
            (point as any).ficheId = undefined;
          }
        } catch (_pointError) {
          // On continue malgré l'erreur pour au moins mettre à jour la fiche
        }
      }

      // 3. Marquer comme modifié seulement si quelque chose a changé
      if (fiche.points_ids.length !== initialLength) {
        session.isDirty = true;
        session.dirtyFicheIds.add(ficheId);
        if (point) {
          session.dirtyPointIds.add(pointId);
        }
        this.touchSession(userId);
        return true;
      }

      return false;
    } catch (error) {
      memoryLogger.error("Failed to remove point from fiche", {
        userId,
        ficheId,
        pointId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  // Ajouter des points à une liste
  addPointToList(userId: string, listId: string, pointId: string): boolean {
    try {
      this.logAccess("addPointToList", userId, { listId, pointId });
      const session = this.getSession(userId);
      const list = session.lists.get(listId);
      const point = session.points.get(pointId);

      if (!list || !point) {
        return false;
      }

      // Initialiser pointIds s'il n'existe pas
      if (!list.points) {
        list.points = [];
      }

      // Ajouter le point à la liste s'il n'existe pas déjà
      if (!list.points.some((id) => id.toString() === pointId)) {
        list.points.push(pointId as any);
        session.isDirty = true;
        session.dirtyListIds.add(listId);
        this.touchSession(userId);
        return true;
      }

      return false;
    } catch (error) {
      memoryLogger.error("Failed to add point to list", {
        userId,
        listId,
        pointId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  // Supprimer un point d'une liste
  removePointFromList(
    userId: string,
    listId: string,
    pointId: string,
  ): boolean {
    try {
      this.logAccess("removePointFromList", userId, { listId, pointId });
      const session = this.getSession(userId);
      const list = session.lists.get(listId);

      if (!list || !list.points) {
        return false;
      }

      const initialLength = list.points.length;

      // Filtrer pour enlever le point spécifié
      list.points = list.points.filter((id) => id.toString() !== pointId);

      // Vérifier si le point a été retiré
      if (list.points.length !== initialLength) {
        session.isDirty = true;
        session.dirtyListIds.add(listId);
        this.touchSession(userId);
        return true;
      }

      return false;
    } catch (error) {
      memoryLogger.error("Failed to remove point from list", {
        userId,
        listId,
        pointId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  // Obtenir les points d'une liste spécifique
  getPointsByListId(userId: string, listId: string): IPoint[] {
    try {
      this.logAccess("getPointsByListId", userId, { listId });
      const session = this.getSession(userId);
      const list = session.lists.get(listId);

      if (!list || !list.points) return [];

      // Récupérer tous les points qui sont dans la liste
      return this.getPointsByIds(
        userId,
        list.points.map((id) => id.toString()),
      );
    } catch (error) {
      memoryLogger.error("Failed to get points by list", {
        userId,
        listId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  // Obtenir toutes les listes contenant un point spécifique
  getListsByPointId(userId: string, pointId: string): IList[] {
    try {
      this.logAccess("getListsByPointId", userId, { pointId });
      const session = this.getSession(userId);

      return Array.from(session.lists.values()).filter(
        (list) =>
          list.points && list.points.some((id) => id.toString() === pointId),
      );
    } catch (error) {
      memoryLogger.error("Failed to get lists by point", {
        userId,
        pointId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  // Mettre à jour l'ordre des points dans une liste
  updateListPointsOrder(
    userId: string,
    listId: string,
    orderedPointIds: string[],
  ): boolean {
    try {
      this.logAccess("updateListPointsOrder", userId, { listId });
      const session = this.getSession(userId);
      const list = session.lists.get(listId);

      if (!list) {
        return false;
      }

      // Vérifier que tous les IDs fournis correspondent à des points existants dans la liste
      const existingPointIds = new Set(
        list.points?.map((id) => id.toString()) || [],
      );
      const validPointIds = orderedPointIds.filter((id) =>
        existingPointIds.has(id),
      );

      // Vérifier que nous avons le même nombre de points
      if (validPointIds.length !== existingPointIds.size) {
        memoryLogger.warn("Invalid points in list order update", {
          userId,
          listId,
          providedCount: orderedPointIds.length,
          existingCount: existingPointIds.size,
          validCount: validPointIds.length,
        });
        return false;
      }

      // Mettre à jour la liste avec le nouvel ordre
      list.points = validPointIds.map((id) => id as any);
      session.isDirty = true;
      session.dirtyListIds.add(listId);
      this.touchSession(userId);
      return true;
    } catch (error) {
      memoryLogger.error("Failed to update list points order", {
        userId,
        listId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  // Vérifier si un point est dans une liste
  isPointInList(userId: string, listId: string, pointId: string): boolean {
    try {
      this.logAccess("isPointInList", userId, { listId, pointId });
      const session = this.getSession(userId);
      const list = session.lists.get(listId);

      if (!list || !list.points) {
        return false;
      }

      return list.points.some((id) => id.toString() === pointId);
    } catch (error) {
      memoryLogger.error("Failed to check if point is in list", {
        userId,
        listId,
        pointId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  // Mise à jour complète d'une liste existante
  updateList(
    userId: string,
    listId: string,
    updatedData: Partial<IList>,
  ): boolean {
    try {
      this.logAccess("updateList", userId, { listId });
      const session = this.getSession(userId);
      const list = session.lists.get(listId);

      if (!list) {
        return false;
      }

      // Mettre à jour les propriétés modifiables
      if (updatedData.name !== undefined) list.name = updatedData.name;
      if (updatedData.description !== undefined)
        list.description = updatedData.description;
      if (updatedData.color !== undefined) list.color = updatedData.color;
      if (updatedData.icon !== undefined) list.icon = updatedData.icon;

      // Mettre à jour pointIds seulement si explicitement fourni
      if (updatedData.points !== undefined) {
        // Vérifier que tous les points existent
        const validPointIds = updatedData.points.filter((id) =>
          session.points.has(id.toString()),
        );
        list.points = validPointIds;
      }

      // Mettre à jour la date de modification
      list.updatedAt = new Date();

      session.isDirty = true;
      session.dirtyListIds.add(listId);
      this.touchSession(userId);
      return true;
    } catch (error) {
      memoryLogger.error("Failed to update list", {
        userId,
        listId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  // Mise à jour de getAllUserData pour inclure les listes
  getAllUserData(userId: string): Record<string, any> {
    try {
      this.logAccess("getAllUserData", userId);
      const userData: Record<string, any> = {};
      const session = this.sessions.get(userId);

      if (!session) {
        throw new Error(`Session non trouvée pour l'utilisateur ${userId}`);
      }

      try {
        userData.points = Array.from(session.points.values());
      } catch (pointsError) {
        memoryLogger.error("Failed to retrieve points for getAllUserData", {
          userId,
          error:
            pointsError instanceof Error
              ? pointsError.message
              : String(pointsError),
        });
        userData.points = [];
        userData.pointsError = "Erreur lors de la récupération des points";
      }

      try {
        userData.fiches = Array.from(session.fiches.values());
      } catch (fichesError) {
        memoryLogger.error("Failed to retrieve fiches for getAllUserData", {
          userId,
          error:
            fichesError instanceof Error
              ? fichesError.message
              : String(fichesError),
        });
        userData.fiches = [];
        userData.fichesError = "Erreur lors de la récupération des fiches";
      }

      try {
        userData.lists = Array.from(session.lists.values());
      } catch (listsError) {
        memoryLogger.error("Failed to retrieve lists for getAllUserData", {
          userId,
          error:
            listsError instanceof Error
              ? listsError.message
              : String(listsError),
        });
        userData.lists = [];
        userData.listsError = "Erreur lors de la récupération des listes";
      }

      // Note: encryptionKey is NOT exposed via getAllUserData for security reasons
      // Use getUserEncryptionKey() method if you need the encryption key
      userData.lastAccessed = session.lastAccessed;
      userData.isDirty = session.isDirty;
      userData.user = { id: userId };

      return userData;
    } catch (error) {
      memoryLogger.error("Failed to get all user data", {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        error: `Impossible de récupérer les données utilisateur: ${error instanceof Error ? getErrorMessage(error) : String(error)}`,
      };
    }
  }

  // Méthode pour obtenir les statistiques d'utilisation de la mémoire
  getUsageStats(): any {
    return {
      activeSessions: this.sessions.size,
      totalAccesses: this.accessCounter,
      lastStatsReset: this.lastStatsReset,
      statsResetInterval: `${this.STATS_RESET_INTERVAL / 1000 / 60} minutes`,
      memoryUsage: process.memoryUsage(),
      uptime: process.uptime(),
    };
  }

  /**
   * Réinitialiser les statistiques d'accès
   * Cette méthode est appelée périodiquement pour éviter une fuite mémoire
   * où accessCounter accumulerait indéfiniment des clés.
   */
  resetUsageStats(): void {
    const previousCount = Object.keys(this.accessCounter).length;
    this.accessCounter = {};
    this.lastStatsReset = new Date();
    memoryLogger.info("Usage stats reset", {
      entriesRemoved: previousCount,
    });
  }

  // Trouver une fiche par pointId
  getFicheByPointId(userId: string, pointId: string): IFiche | undefined {
    try {
      this.logAccess("getFicheByPointId", userId, { pointId });
      const session = this.getSession(userId);
      const point = session.points.get(pointId);

      if (!point || !point.ficheId) {
        return undefined;
      }

      // Récupérer la fiche associée au point
      return session.fiches.get(point.ficheId.toString());
    } catch (error) {
      memoryLogger.error("Failed to get fiche by point", {
        userId,
        pointId,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  // Récupérer la clé de chiffrement d'un utilisateur
  getUserEncryptionKey(userId: string): string {
    this.logAccess("getUserEncryptionKey", userId);
    const session = this.getSession(userId);
    this.touchSession(userId);
    return session.encryptionKey;
  }
}

export const memoryStorage = new MemoryStorageService();
