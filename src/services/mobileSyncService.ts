// ═══════════════════════════════════════════════════════════════════════════
// SERVICE DE SYNCHRONISATION MOBILE
// ═══════════════════════════════════════════════════════════════════════════
// Gère la synchronisation des données entre le serveur et l'app mobile
// Stratégie: Offline-first avec sync incrémentale
// ═══════════════════════════════════════════════════════════════════════════

import mongoose from "mongoose";
import PointModel from "../models/points";
import FicheModel from "../models/fiches";
import ListModel from "../models/lists";
import SosContactModel from "../models/sosContact";
import SosSessionModel from "../models/sosSession";
import KeysModel from "../models/keys";
import { decrypt } from "../utils/masterEncryptionUtils";
import { decryptWithKey, encryptWithKey } from "../utils/userEncryptionUtils";
import { getErrorMessage } from "../utils/errorUtils";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface SyncResult {
  points: {
    created: DecryptedPoint[];
    updated: DecryptedPoint[];
    deleted: string[];
  };
  fiches: {
    created: DecryptedFiche[];
    updated: DecryptedFiche[];
    deleted: string[];
  };
  lists: {
    created: DecryptedList[];
    updated: DecryptedList[];
    deleted: string[];
  };
  sosContacts: {
    created: SyncedSosContact[];
    updated: SyncedSosContact[];
    deleted: string[];
  };
  activeSosSession: SyncedSosSession | null;
  lastSyncDate: string;
  totalChanges: number;
}

export interface DecryptedPoint {
  _id: string;
  name: string;
  description: string;
  location: {
    type: "Point";
    coordinates: [number, number];
  } | null;
  ficheId?: string;
  accessType?: string;
  createdAt: string;
  updatedAt: string;
  version?: number;
}

export interface DecryptedFiche {
  _id: string;
  name: string;
  ville: string;
  type: string;
  etat: string;
  accessibilite?: string;
  difficulte_acces?: string;
  risque_oxygene?: string;
  acces_souterrain?: string;
  praticite_souterrain?: string;
  etat_general?: string;
  commentaire?: string;
  points_ids: string[];
  date_creation: string;
  date_modification: string;
  equipement_conseille?: string[];
  surface?: string[];
  type_galeries?: string[];
  interets?: string;
  center_cavite?: {
    type: string;
    coordinates: number[];
  };
  version?: number;
}

export interface DecryptedList {
  _id: string;
  name: string;
  description: string;
  points: string[];
  color: string;
  icon: string;
  createdAt: string;
  updatedAt: string;
  version?: number;
}

export interface SyncedSosContact {
  _id: string;
  name: string;
  phone: string;
  relationship?: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SyncedSosSession {
  _id: string;
  status: string;
  currentStage: number;
  activatedAt: string;
  expectedDuration: number;
  expiresAt: string;
  lastHeartbeatAt?: string;
  heartbeatCount: number;
  extensionCount: number;
  note?: string;
}

export interface LocalChange {
  type: "point" | "fiche" | "list" | "sosContact";
  action: "create" | "update" | "delete";
  id?: string;
  localId?: string; // ID temporaire côté client
  data?: any;
  timestamp: string;
}

export interface SyncConflict {
  type: "point" | "fiche" | "list" | "sosContact";
  id: string;
  localVersion: any;
  serverVersion: any;
  resolution: "server_wins" | "client_wins" | "manual";
}

// ═══════════════════════════════════════════════════════════════════════════
// CLASSE MobileSyncService
// ═══════════════════════════════════════════════════════════════════════════

class MobileSyncService {
  /**
   * Récupère la clé AES de l'utilisateur
   */
  async getUserKey(userId: string): Promise<string> {
    const userKeyData = await KeysModel.findOne({
      userId: new mongoose.Types.ObjectId(userId),
      type: "user",
    });

    if (!userKeyData || !userKeyData.key) {
      throw new Error(`Clé utilisateur non trouvée pour ${userId}`);
    }

    // Vérifier que ce n'est pas une clé RSA
    if (userKeyData.key.includes("-----BEGIN")) {
      throw new Error(`Erreur: Clé RSA récupérée au lieu de la clé AES`);
    }

    // Déchiffrer avec la clé maître
    return decrypt(userKeyData.key);
  }

  /**
   * Déchiffre un point avec la clé utilisateur
   */
  decryptPoint(point: any, userKey: string): DecryptedPoint {
    try {
      const name = decryptWithKey(point.name, userKey);
      const description = point.description
        ? decryptWithKey(point.description, userKey)
        : "";

      let location = null;
      if (point.location_encrypted) {
        const locationJson = decryptWithKey(point.location_encrypted, userKey);
        const parsedLocation = JSON.parse(locationJson);
        location = {
          type: "Point" as const,
          coordinates: [
            parseFloat(parsedLocation.coordinates[0]),
            parseFloat(parsedLocation.coordinates[1]),
          ] as [number, number],
        };
      }

      return {
        _id: point._id.toString(),
        name,
        description,
        location,
        ficheId: point.ficheId?.toString(),
        accessType: point.accessType,
        createdAt: point.createdAt?.toISOString() || new Date().toISOString(),
        updatedAt: point.updatedAt?.toISOString() || new Date().toISOString(),
        version: point.version || 1,
      };
    } catch (error) {
      console.error(
        `❌ [SYNC] Erreur déchiffrement point ${point._id}:`,
        getErrorMessage(error),
      );
      throw error;
    }
  }

  /**
   * Déchiffre une fiche avec la clé utilisateur
   */
  decryptFiche(fiche: any, userKey: string): DecryptedFiche {
    try {
      const name = decryptWithKey(fiche.name, userKey);
      const ville = decryptWithKey(fiche.ville, userKey);
      const type = decryptWithKey(fiche.type, userKey);
      const etat = decryptWithKey(fiche.etat, userKey);
      const accessibilite = fiche.accessibilite
        ? decryptWithKey(fiche.accessibilite, userKey)
        : undefined;

      const difficulte_acces = fiche.difficulte_acces
        ? decryptWithKey(fiche.difficulte_acces, userKey)
        : undefined;
      const risque_oxygene = fiche.risque_oxygene
        ? decryptWithKey(fiche.risque_oxygene, userKey)
        : undefined;
      const acces_souterrain = fiche.acces_souterrain
        ? decryptWithKey(fiche.acces_souterrain, userKey)
        : undefined;
      const praticite_souterrain = fiche.praticite_souterrain
        ? decryptWithKey(fiche.praticite_souterrain, userKey)
        : undefined;
      const etat_general = fiche.etat_general
        ? decryptWithKey(fiche.etat_general, userKey)
        : undefined;
      const commentaire = fiche.commentaire
        ? decryptWithKey(fiche.commentaire, userKey)
        : "";
      const interets = fiche.interets
        ? decryptWithKey(fiche.interets, userKey)
        : "";

      return {
        _id: fiche._id.toString(),
        name,
        ville,
        type,
        etat,
        accessibilite,
        difficulte_acces,
        risque_oxygene,
        acces_souterrain,
        praticite_souterrain,
        etat_general,
        commentaire,
        points_ids: fiche.points_ids?.map((id: any) => id.toString()) || [],
        date_creation:
          fiche.date_creation?.toISOString() || new Date().toISOString(),
        date_modification:
          fiche.date_modification?.toISOString() || new Date().toISOString(),
        equipement_conseille: fiche.equipement_conseille
          ? fiche.equipement_conseille.map((item: string) => {
              try {
                return decryptWithKey(item, userKey);
              } catch {
                return item; // Fallback: plaintext or corrupt data
              }
            })
          : [],
        surface: fiche.surface
          ? fiche.surface.map((item: string) => {
              try {
                return decryptWithKey(item, userKey);
              } catch {
                return item;
              }
            })
          : [],
        type_galeries: fiche.type_galeries
          ? fiche.type_galeries.map((item: string) => {
              try {
                return decryptWithKey(item, userKey);
              } catch {
                return item;
              }
            })
          : [],
        interets,
        center_cavite: fiche.center_cavite || undefined,
        version: fiche.version || 1,
      };
    } catch (error) {
      console.error(
        `❌ [SYNC] Erreur déchiffrement fiche ${fiche._id}:`,
        getErrorMessage(error),
      );
      throw error;
    }
  }

  /**
   * Transforme une liste en format DecryptedList
   */
  transformList(list: any, userKey: string): DecryptedList {
    let name = list.name || "";
    let description = list.description || "";

    // Déchiffrer si le champ est au format chiffré (iv:authTag:encrypted)
    if (name) {
      const parts = name.split(":");
      if (
        parts.length === 3 &&
        parts[0].length >= 16 &&
        parts[1].length >= 16
      ) {
        try {
          name = decryptWithKey(name, userKey);
        } catch {
          // Plaintext (données pré-migration) — garder tel quel
        }
      }
    }

    if (description) {
      const parts = description.split(":");
      if (
        parts.length === 3 &&
        parts[0].length >= 16 &&
        parts[1].length >= 16
      ) {
        try {
          description = decryptWithKey(description, userKey);
        } catch {
          // Plaintext (données pré-migration) — garder tel quel
        }
      }
    }

    return {
      _id: list._id.toString(),
      name,
      description,
      points: list.points?.map((id: any) => id.toString()) || [],
      color: list.color || "#000000",
      icon: list.icon || "default-icon",
      createdAt: list.createdAt?.toISOString() || new Date().toISOString(),
      updatedAt: list.updatedAt?.toISOString() || new Date().toISOString(),
      version: list.version || 1,
    };
  }

  /**
   * Transforme un SosContact en format SyncedSosContact
   */
  transformSosContact(contact: any): SyncedSosContact {
    return {
      _id: contact._id.toString(),
      name: contact.name,
      phone: contact.phone,
      relationship: contact.relationship,
      isDefault: contact.isDefault || false,
      createdAt: contact.createdAt?.toISOString() || new Date().toISOString(),
      updatedAt: contact.updatedAt?.toISOString() || new Date().toISOString(),
    };
  }

  /**
   * Transforme une SosSession en format SyncedSosSession
   */
  transformSosSession(session: any): SyncedSosSession {
    return {
      _id: session._id.toString(),
      status: session.status,
      currentStage: session.currentStage,
      activatedAt:
        session.activatedAt?.toISOString() || new Date().toISOString(),
      expectedDuration: session.expectedDuration,
      expiresAt: session.expiresAt?.toISOString() || new Date().toISOString(),
      lastHeartbeatAt: session.lastHeartbeatAt?.toISOString(),
      heartbeatCount: session.heartbeatCount || 0,
      extensionCount: session.extensionCount || 0,
      note: session.note,
    };
  }

  /**
   * Récupère toutes les données de l'utilisateur (premier sync / sync complet)
   */
  async getFullData(userId: string): Promise<SyncResult> {
    const startTime = Date.now();
    console.log(`📱 [SYNC] Début sync complète pour userId: ${userId}`);

    const userKey = await this.getUserKey(userId);

    // Charger toutes les données en parallèle (exclure les éléments soft-deleted)
    const [points, fiches, lists, sosContacts, activeSosSession] =
      await Promise.all([
        PointModel.find({ userId, deletedAt: null }).lean(),
        FicheModel.find({ userId, deletedAt: null }).lean(),
        ListModel.find({ userId, deletedAt: null }).lean(),
        SosContactModel.find({
          userId: new mongoose.Types.ObjectId(userId),
        }).lean(),
        SosSessionModel.findOne({
          userId: new mongoose.Types.ObjectId(userId),
          status: { $in: ["ACTIVE", "ESCALATING"] },
        }).lean(),
      ]);

    // Déchiffrer/transformer les données
    // BUG-010: Wrap individual decrypt calls in try/catch to skip failed items
    // instead of crashing the entire sync operation
    const decryptedPoints = points
      .map((p) => {
        try {
          return this.decryptPoint(p, userKey);
        } catch (err) {
          console.warn(`⚠️ [SYNC] Échec déchiffrement point ${p._id}:`, err);
          return null;
        }
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);
    const decryptedFiches = fiches
      .map((f) => {
        try {
          return this.decryptFiche(f, userKey);
        } catch (err) {
          console.warn(`⚠️ [SYNC] Échec déchiffrement fiche ${f._id}:`, err);
          return null;
        }
      })
      .filter((f): f is NonNullable<typeof f> => f !== null);
    const transformedLists = lists.map((l) => this.transformList(l, userKey));
    const transformedSosContacts = sosContacts.map((c) =>
      this.transformSosContact(c),
    );

    const result: SyncResult = {
      points: {
        created: decryptedPoints,
        updated: [],
        deleted: [],
      },
      fiches: {
        created: decryptedFiches,
        updated: [],
        deleted: [],
      },
      lists: {
        created: transformedLists,
        updated: [],
        deleted: [],
      },
      sosContacts: {
        created: transformedSosContacts,
        updated: [],
        deleted: [],
      },
      activeSosSession: activeSosSession
        ? this.transformSosSession(activeSosSession)
        : null,
      lastSyncDate: new Date().toISOString(),
      totalChanges:
        points.length + fiches.length + lists.length + sosContacts.length,
    };

    console.log(
      `✅ [SYNC] Sync complète terminée en ${Date.now() - startTime}ms - ${result.totalChanges} éléments`,
    );
    return result;
  }

  /**
   * Récupère les changements depuis une date donnée (sync incrémentale)
   */
  async getIncrementalChanges(
    userId: string,
    since: Date,
  ): Promise<SyncResult> {
    const startTime = Date.now();
    console.log(
      `📱 [SYNC] Début sync incrémentale depuis ${since.toISOString()} pour userId: ${userId}`,
    );

    const userKey = await this.getUserKey(userId);

    // Récupérer les éléments créés/modifiés depuis la date (exclure les soft-deleted)
    const [updatedPoints, updatedFiches, updatedLists, updatedSosContacts] =
      await Promise.all([
        PointModel.find({
          userId,
          updatedAt: { $gt: since },
          deletedAt: null,
        }).lean(),
        FicheModel.find({
          userId,
          date_modification: { $gt: since },
          deletedAt: null,
        }).lean(),
        ListModel.find({
          userId,
          updatedAt: { $gt: since },
          deletedAt: null,
        }).lean(),
        SosContactModel.find({
          userId: new mongoose.Types.ObjectId(userId),
          updatedAt: { $gt: since },
        }).lean(),
      ]);

    // Séparer créés et modifiés
    // BUG-010: Wrap individual decrypt calls in try/catch to skip failed items
    const createdPoints = updatedPoints
      .filter((p) => p.createdAt && new Date(p.createdAt) > since)
      .map((p) => {
        try {
          return this.decryptPoint(p, userKey);
        } catch (err) {
          console.warn(`⚠️ [SYNC] Échec déchiffrement point ${p._id}:`, err);
          return null;
        }
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);

    const modifiedPoints = updatedPoints
      .filter((p) => p.createdAt && new Date(p.createdAt) <= since)
      .map((p) => {
        try {
          return this.decryptPoint(p, userKey);
        } catch (err) {
          console.warn(`⚠️ [SYNC] Échec déchiffrement point ${p._id}:`, err);
          return null;
        }
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);

    const createdFiches = updatedFiches
      .filter((f) => f.date_creation && new Date(f.date_creation) > since)
      .map((f) => {
        try {
          return this.decryptFiche(f, userKey);
        } catch (err) {
          console.warn(`⚠️ [SYNC] Échec déchiffrement fiche ${f._id}:`, err);
          return null;
        }
      })
      .filter((f): f is NonNullable<typeof f> => f !== null);

    const modifiedFiches = updatedFiches
      .filter((f) => f.date_creation && new Date(f.date_creation) <= since)
      .map((f) => {
        try {
          return this.decryptFiche(f, userKey);
        } catch (err) {
          console.warn(`⚠️ [SYNC] Échec déchiffrement fiche ${f._id}:`, err);
          return null;
        }
      })
      .filter((f): f is NonNullable<typeof f> => f !== null);

    const createdLists = updatedLists
      .filter((l) => l.createdAt && new Date(l.createdAt) > since)
      .map((l) => this.transformList(l, userKey));
    const modifiedLists = updatedLists
      .filter((l) => l.createdAt && new Date(l.createdAt) <= since)
      .map((l) => this.transformList(l, userKey));

    const createdSosContacts = updatedSosContacts
      .filter((c) => c.createdAt && new Date(c.createdAt) > since)
      .map((c) => this.transformSosContact(c));
    const modifiedSosContacts = updatedSosContacts
      .filter((c) => c.createdAt && new Date(c.createdAt) <= since)
      .map((c) => this.transformSosContact(c));

    // Récupérer la session SOS active
    const activeSosSession = await SosSessionModel.findOne({
      userId: new mongoose.Types.ObjectId(userId),
      status: { $in: ["ACTIVE", "ESCALATING"] },
    }).lean();

    // Détection des suppressions (soft-delete)
    const deletedPointsDocs = await PointModel.find({
      userId,
      deletedAt: { $ne: null, $gt: since },
    })
      .select("_id")
      .lean();
    const deletedPoints: string[] = deletedPointsDocs.map((p) =>
      p._id.toString(),
    );

    const deletedFichesDocs = await FicheModel.find({
      userId,
      deletedAt: { $ne: null, $gt: since },
    })
      .select("_id")
      .lean();
    const deletedFiches: string[] = deletedFichesDocs.map((f) =>
      f._id.toString(),
    );

    const deletedListsDocs = await ListModel.find({
      userId,
      deletedAt: { $ne: null, $gt: since },
    })
      .select("_id")
      .lean();
    const deletedLists: string[] = deletedListsDocs.map((l: any) =>
      l._id.toString(),
    );

    const result: SyncResult = {
      points: {
        created: createdPoints,
        updated: modifiedPoints,
        deleted: deletedPoints,
      },
      fiches: {
        created: createdFiches,
        updated: modifiedFiches,
        deleted: deletedFiches,
      },
      lists: {
        created: createdLists,
        updated: modifiedLists,
        deleted: deletedLists,
      },
      sosContacts: {
        created: createdSosContacts,
        updated: modifiedSosContacts,
        deleted: [], // Hard-delete, pas détectable en incrémental
      },
      activeSosSession: activeSosSession
        ? this.transformSosSession(activeSosSession)
        : null,
      lastSyncDate: new Date().toISOString(),
      totalChanges:
        createdPoints.length +
        modifiedPoints.length +
        deletedPoints.length +
        createdFiches.length +
        modifiedFiches.length +
        deletedFiches.length +
        createdLists.length +
        modifiedLists.length +
        deletedLists.length +
        createdSosContacts.length +
        modifiedSosContacts.length,
    };

    console.log(
      `✅ [SYNC] Sync incrémentale terminée en ${Date.now() - startTime}ms - ${result.totalChanges} changements`,
    );
    return result;
  }

  /**
   * Applique les changements locaux du mobile vers le serveur
   */
  async applyLocalChanges(
    userId: string,
    changes: LocalChange[],
  ): Promise<{
    synced: LocalChange[];
    conflicts: SyncConflict[];
    errors: any[];
  }> {
    const startTime = Date.now();
    console.log(
      `📱 [SYNC] Application de ${changes.length} changements locaux pour userId: ${userId}`,
    );

    const userKey = await this.getUserKey(userId);
    const synced: LocalChange[] = [];
    const conflicts: SyncConflict[] = [];
    const errors: any[] = [];

    for (const change of changes) {
      try {
        switch (change.type) {
          case "point":
            await this.applyPointChange(
              userId,
              userKey,
              change,
              synced,
              conflicts,
            );
            break;
          case "fiche":
            await this.applyFicheChange(
              userId,
              userKey,
              change,
              synced,
              conflicts,
            );
            break;
          case "list":
            await this.applyListChange(
              userId,
              userKey,
              change,
              synced,
              conflicts,
            );
            break;
          case "sosContact":
            await this.applySosContactChange(userId, change, synced, conflicts);
            break;
        }
      } catch (error) {
        console.error(
          `❌ [SYNC] Erreur application changement:`,
          getErrorMessage(error),
        );
        errors.push({
          change,
          error: getErrorMessage(error),
        });
      }
    }

    console.log(
      `✅ [SYNC] Changements appliqués en ${Date.now() - startTime}ms - synced: ${synced.length}, conflicts: ${conflicts.length}, errors: ${errors.length}`,
    );
    return { synced, conflicts, errors };
  }

  /**
   * Applique un changement sur un point
   */
  private async applyPointChange(
    userId: string,
    userKey: string,
    change: LocalChange,
    synced: LocalChange[],
    conflicts: SyncConflict[],
  ): Promise<void> {
    const data = change.data;

    switch (change.action) {
      case "create": {
        // Chiffrer les données
        const encryptedName = encryptWithKey(data.name, userKey);
        const encryptedDescription = data.description
          ? encryptWithKey(data.description, userKey)
          : "";
        const encryptedLocation = data.location
          ? encryptWithKey(JSON.stringify(data.location), userKey)
          : "";

        const newPoint = await PointModel.create({
          userId: new mongoose.Types.ObjectId(userId),
          name: encryptedName,
          description: encryptedDescription,
          location_encrypted: encryptedLocation,
          ficheId: data.ficheId
            ? new mongoose.Types.ObjectId(data.ficheId)
            : null,
          accessType: data.accessType || "",
          version: 1,
        });

        synced.push({
          ...change,
          id: newPoint._id.toString(),
        });
        break;
      }

      case "update": {
        if (!change.id) throw new Error("ID manquant pour update");

        // Vérifier les conflits (last-write-wins pour l'instant)
        const existingPoint = await PointModel.findOne({
          _id: change.id,
          userId: new mongoose.Types.ObjectId(userId),
        });

        if (!existingPoint) {
          throw new Error(`Point ${change.id} non trouvé`);
        }

        // Vérification de version (optimistic concurrency)
        const clientVersion = data.version || 0;
        const serverVersion = (existingPoint as any).version || 1;

        if (clientVersion > 0 && clientVersion < serverVersion) {
          // Conflit: le client a une version obsolète
          conflicts.push({
            type: "point",
            id: change.id!,
            localVersion: data,
            serverVersion: this.decryptPoint(existingPoint, userKey),
            resolution: "server_wins",
          });
          break;
        }

        // Chiffrer et mettre à jour
        const updateData: any = {};
        if (data.name) updateData.name = encryptWithKey(data.name, userKey);
        if (data.description !== undefined)
          updateData.description = encryptWithKey(data.description, userKey);
        if (data.location)
          updateData.location_encrypted = encryptWithKey(
            JSON.stringify(data.location),
            userKey,
          );
        if (data.accessType !== undefined)
          updateData.accessType = data.accessType;
        updateData.version = serverVersion + 1;

        await PointModel.updateOne(
          { _id: change.id, userId: new mongoose.Types.ObjectId(userId) },
          { $set: updateData },
        );

        synced.push(change);
        break;
      }

      case "delete": {
        if (!change.id) throw new Error("ID manquant pour delete");

        // Soft-delete au lieu de hard-delete
        await PointModel.updateOne(
          { _id: change.id, userId: new mongoose.Types.ObjectId(userId) },
          { $set: { deletedAt: new Date() } },
        );

        synced.push(change);
        break;
      }
    }
  }

  /**
   * Applique un changement sur une fiche
   */
  private async applyFicheChange(
    userId: string,
    userKey: string,
    change: LocalChange,
    synced: LocalChange[],
    conflicts: SyncConflict[],
  ): Promise<void> {
    const data = change.data;

    switch (change.action) {
      case "create": {
        const encryptedData = {
          userId: new mongoose.Types.ObjectId(userId),
          name: encryptWithKey(data.name, userKey),
          ville: encryptWithKey(data.ville, userKey),
          type: encryptWithKey(data.type, userKey),
          etat: encryptWithKey(data.etat, userKey),
          accessibilite: data.accessibilite
            ? encryptWithKey(data.accessibilite, userKey)
            : "",
          difficulte_acces: data.difficulte_acces
            ? encryptWithKey(data.difficulte_acces, userKey)
            : "",
          risque_oxygene: data.risque_oxygene
            ? encryptWithKey(data.risque_oxygene, userKey)
            : "",
          acces_souterrain: data.acces_souterrain
            ? encryptWithKey(data.acces_souterrain, userKey)
            : "",
          praticite_souterrain: data.praticite_souterrain
            ? encryptWithKey(data.praticite_souterrain, userKey)
            : "",
          etat_general: data.etat_general
            ? encryptWithKey(data.etat_general, userKey)
            : "",
          commentaire: data.commentaire
            ? encryptWithKey(data.commentaire, userKey)
            : "",
          interets: data.interets ? encryptWithKey(data.interets, userKey) : "",
          points_ids:
            data.points_ids?.map(
              (id: string) => new mongoose.Types.ObjectId(id),
            ) || [],
          equipement_conseille: data.equipement_conseille || [],
          surface: data.surface || [],
          type_galeries: data.type_galeries || [],
          center_cavite: data.center_cavite || undefined,
          version: 1,
        };

        const newFiche = await FicheModel.create(encryptedData);

        synced.push({
          ...change,
          id: newFiche._id.toString(),
        });
        break;
      }

      case "update": {
        if (!change.id) throw new Error("ID manquant pour update");

        const existingFiche = await FicheModel.findOne({
          _id: change.id,
          userId: new mongoose.Types.ObjectId(userId),
        });

        if (!existingFiche) {
          throw new Error(`Fiche ${change.id} non trouvée`);
        }

        // Vérification de version (optimistic concurrency)
        const clientVersion = data.version || 0;
        const serverVersion = (existingFiche as any).version || 1;

        if (clientVersion > 0 && clientVersion < serverVersion) {
          // Conflit: le client a une version obsolète
          conflicts.push({
            type: "fiche",
            id: change.id!,
            localVersion: data,
            serverVersion: this.decryptFiche(existingFiche, userKey),
            resolution: "server_wins",
          });
          break;
        }

        const updateData: any = {
          date_modification: new Date(),
          version: serverVersion + 1,
        };
        if (data.name !== undefined)
          updateData.name = encryptWithKey(data.name, userKey);
        if (data.ville !== undefined)
          updateData.ville = encryptWithKey(data.ville, userKey);
        if (data.type !== undefined)
          updateData.type = encryptWithKey(data.type, userKey);
        if (data.etat !== undefined)
          updateData.etat = encryptWithKey(data.etat, userKey);
        if (data.accessibilite !== undefined)
          updateData.accessibilite = encryptWithKey(
            data.accessibilite,
            userKey,
          );
        if (data.difficulte_acces !== undefined)
          updateData.difficulte_acces = encryptWithKey(
            data.difficulte_acces,
            userKey,
          );
        if (data.risque_oxygene !== undefined)
          updateData.risque_oxygene = encryptWithKey(
            data.risque_oxygene,
            userKey,
          );
        if (data.acces_souterrain !== undefined)
          updateData.acces_souterrain = encryptWithKey(
            data.acces_souterrain,
            userKey,
          );
        if (data.praticite_souterrain !== undefined)
          updateData.praticite_souterrain = encryptWithKey(
            data.praticite_souterrain,
            userKey,
          );
        if (data.etat_general !== undefined)
          updateData.etat_general = encryptWithKey(data.etat_general, userKey);
        if (data.commentaire !== undefined)
          updateData.commentaire = encryptWithKey(data.commentaire, userKey);
        if (data.interets !== undefined)
          updateData.interets = encryptWithKey(data.interets, userKey);
        if (data.points_ids)
          updateData.points_ids = data.points_ids.map(
            (id: string) => new mongoose.Types.ObjectId(id),
          );
        if (data.equipement_conseille !== undefined)
          updateData.equipement_conseille = data.equipement_conseille;
        if (data.surface !== undefined) updateData.surface = data.surface;
        if (data.type_galeries !== undefined)
          updateData.type_galeries = data.type_galeries;
        if (data.center_cavite !== undefined)
          updateData.center_cavite = data.center_cavite;

        await FicheModel.updateOne(
          { _id: change.id, userId: new mongoose.Types.ObjectId(userId) },
          { $set: updateData },
        );

        synced.push(change);
        break;
      }

      case "delete": {
        if (!change.id) throw new Error("ID manquant pour delete");

        // Soft-delete au lieu de hard-delete
        await FicheModel.updateOne(
          { _id: change.id, userId: new mongoose.Types.ObjectId(userId) },
          { $set: { deletedAt: new Date() } },
        );

        synced.push(change);
        break;
      }
    }
  }

  /**
   * Applique un changement sur une liste
   */
  private async applyListChange(
    userId: string,
    userKey: string,
    change: LocalChange,
    synced: LocalChange[],
    conflicts: SyncConflict[],
  ): Promise<void> {
    const data = change.data;

    switch (change.action) {
      case "create": {
        const newList = await ListModel.create({
          userId: new mongoose.Types.ObjectId(userId),
          name: data.name ? encryptWithKey(data.name, userKey) : "",
          description: data.description
            ? encryptWithKey(data.description, userKey)
            : "",
          points:
            data.points?.map((id: string) => new mongoose.Types.ObjectId(id)) ||
            [],
          color: data.color || "#000000",
          icon: data.icon || "default-icon",
          version: 1,
        });

        synced.push({
          ...change,
          id: newList._id.toString(),
        });
        break;
      }

      case "update": {
        if (!change.id) throw new Error("ID manquant pour update");

        const existingList = await ListModel.findOne({
          _id: change.id,
          userId: new mongoose.Types.ObjectId(userId),
        });

        if (!existingList) {
          throw new Error(`Liste ${change.id} non trouvée`);
        }

        // Vérification de version (optimistic concurrency)
        const clientVersion = data.version || 0;
        const serverVersion = (existingList as any).version || 1;

        if (clientVersion > 0 && clientVersion < serverVersion) {
          conflicts.push({
            type: "list",
            id: change.id!,
            localVersion: data,
            serverVersion: this.transformList(existingList, userKey),
            resolution: "server_wins",
          });
          break;
        }

        // Chiffrer les champs texte avant mise à jour
        const encryptedData: any = { ...data };
        if (data.name) {
          encryptedData.name = encryptWithKey(data.name, userKey);
        }
        if (data.description !== undefined) {
          encryptedData.description = encryptWithKey(
            data.description || "",
            userKey,
          );
        }
        encryptedData.version = serverVersion + 1;

        await ListModel.updateOne(
          { _id: change.id, userId: new mongoose.Types.ObjectId(userId) },
          { $set: encryptedData },
        );

        synced.push(change);
        break;
      }

      case "delete": {
        if (!change.id) throw new Error("ID manquant pour delete");

        // Soft-delete au lieu de hard-delete
        await ListModel.updateOne(
          { _id: change.id, userId: new mongoose.Types.ObjectId(userId) },
          { $set: { deletedAt: new Date() } },
        );

        synced.push(change);
        break;
      }
    }
  }

  /**
   * Applique un changement sur un contact SOS
   */
  private async applySosContactChange(
    userId: string,
    change: LocalChange,
    synced: LocalChange[],
    conflicts: SyncConflict[],
  ): Promise<void> {
    const data = change.data;

    switch (change.action) {
      case "create": {
        // Vérifier le nombre max de contacts (5)
        const count = await SosContactModel.countDocuments({
          userId: new mongoose.Types.ObjectId(userId),
        });
        if (count >= 5) {
          throw new Error("MAX_CONTACTS_REACHED");
        }

        const newContact = await SosContactModel.create({
          userId: new mongoose.Types.ObjectId(userId),
          name: data.name,
          phone: data.phone,
          relationship: data.relationship || undefined,
          isDefault: data.isDefault || false,
        });

        synced.push({
          ...change,
          id: newContact._id.toString(),
        });
        break;
      }

      case "update": {
        if (!change.id) throw new Error("ID manquant pour update");

        const existingContact = await SosContactModel.findOne({
          _id: new mongoose.Types.ObjectId(change.id),
          userId: new mongoose.Types.ObjectId(userId),
        });

        if (!existingContact) {
          throw new Error(`Contact SOS ${change.id} non trouvé`);
        }

        const updateData: any = {};
        if (data.name) updateData.name = data.name;
        if (data.phone) updateData.phone = data.phone;
        if (data.relationship !== undefined)
          updateData.relationship = data.relationship;
        if (data.isDefault !== undefined) updateData.isDefault = data.isDefault;

        await SosContactModel.updateOne(
          { _id: change.id, userId: new mongoose.Types.ObjectId(userId) },
          { $set: updateData },
        );

        synced.push(change);
        break;
      }

      case "delete": {
        if (!change.id) throw new Error("ID manquant pour delete");

        // Hard-delete pour les contacts SOS (pas de soft-delete)
        await SosContactModel.deleteOne({
          _id: new mongoose.Types.ObjectId(change.id),
          userId: new mongoose.Types.ObjectId(userId),
        });

        synced.push(change);
        break;
      }
    }
  }

  /**
   * Soft-delete un point (marque comme supprimé sans supprimer physiquement)
   */
  async softDeletePoint(pointId: string, userId: string): Promise<boolean> {
    const result = await PointModel.updateOne(
      { _id: pointId, userId },
      { $set: { deletedAt: new Date() } },
    );
    return result.modifiedCount > 0;
  }

  /**
   * Soft-delete une fiche (marque comme supprimée sans supprimer physiquement)
   */
  async softDeleteFiche(ficheId: string, userId: string): Promise<boolean> {
    const result = await FicheModel.updateOne(
      { _id: ficheId, userId },
      { $set: { deletedAt: new Date() } },
    );
    return result.modifiedCount > 0;
  }

  /**
   * Soft-delete une liste (marque comme supprimée sans supprimer physiquement)
   */
  async softDeleteList(listId: string, userId: string): Promise<boolean> {
    const result = await ListModel.updateOne(
      { _id: listId, userId },
      { $set: { deletedAt: new Date() } },
    );
    return result.modifiedCount > 0;
  }
}

// Export singleton
export const mobileSyncService = new MobileSyncService();
