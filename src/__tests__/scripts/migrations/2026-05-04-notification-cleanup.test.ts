/**
 * Tests d'idempotence pour la migration `2026-05-04-notification-cleanup`.
 *
 * Cf. AUDIT_2026-05-11 §4.4 (P1). Vérifie que :
 *  1. Sur une DB "vierge" contenant des notifs obsolètes → suppression OK
 *  2. Re-run consécutif → no-op (0 suppression, pas d'erreur)
 *  3. Sur une DB partiellement migrée → seuls les obsolètes restants sont touchés
 */

// On mock le model AVANT d'importer la migration (le module en a une référence figée).
jest.mock("../../../models/notifications", () => {
  const mockDeleteMany = jest.fn();
  return {
    __esModule: true,
    default: { deleteMany: mockDeleteMany },
  };
});

// Mock de connectToDatabase (la migration peut être lancée standalone, et on
// veut éviter toute tentative de connexion réelle même si require.main est faux).
jest.mock("../../../config/database", () => ({
  connectToDatabase: jest.fn().mockResolvedValue(undefined),
}));

import NotificationModel from "../../../models/notifications";
import { run } from "../../../scripts/migrations/2026-05-04-notification-cleanup";

const OBSOLETE_TYPES = ["sos_resolved", "sos_stage2_sms", "data_share"];

describe("Migration 2026-05-04-notification-cleanup — idempotence", () => {
  const deleteManyMock = (NotificationModel as unknown as {
    deleteMany: jest.Mock;
  }).deleteMany;

  beforeEach(() => {
    deleteManyMock.mockReset();
  });

  it("Test 1 — DB vierge : supprime toutes les notifications obsolètes (3 docs)", async () => {
    deleteManyMock.mockResolvedValueOnce({ deletedCount: 3 });

    const deleted = await run();

    expect(deleted).toBe(3);
    expect(deleteManyMock).toHaveBeenCalledTimes(1);
    expect(deleteManyMock).toHaveBeenCalledWith({
      type: { $in: OBSOLETE_TYPES },
    });
  });

  it("Test 2 — Re-run sur DB déjà migrée : no-op, deletedCount=0, pas d'erreur", async () => {
    // 1er run : supprime 5 docs
    deleteManyMock.mockResolvedValueOnce({ deletedCount: 5 });
    const firstDeleted = await run();
    expect(firstDeleted).toBe(5);

    // 2e run consécutif : plus rien à supprimer
    deleteManyMock.mockResolvedValueOnce({ deletedCount: 0 });
    const secondDeleted = await run();

    expect(secondDeleted).toBe(0);
    expect(deleteManyMock).toHaveBeenCalledTimes(2);
    // Même filtre, donc toujours idempotent (deleteMany sur un set vide ne throw pas)
    expect(deleteManyMock).toHaveBeenLastCalledWith({
      type: { $in: OBSOLETE_TYPES },
    });
  });

  it("Test 3 — DB partiellement migrée : ne touche que les obsolètes restants", async () => {
    // Simulate 50% déjà migré : il reste 2 docs obsolètes sur 4 initiaux
    deleteManyMock.mockResolvedValueOnce({ deletedCount: 2 });

    const deleted = await run();

    expect(deleted).toBe(2);
    // Le filtre cible explicitement les types obsolètes : aucun risque
    // de toucher les autres notifications (groupes, messages, etc.)
    expect(deleteManyMock).toHaveBeenCalledWith({
      type: { $in: OBSOLETE_TYPES },
    });
  });

  it("Test 4 — deletedCount absent (driver Mongo legacy) → renvoie 0 sans crash", async () => {
    deleteManyMock.mockResolvedValueOnce({});

    const deleted = await run();

    expect(deleted).toBe(0);
  });

  it("Test 5 — erreur DB propagée (la migration ne masque pas les erreurs)", async () => {
    deleteManyMock.mockRejectedValueOnce(new Error("connection lost"));

    await expect(run()).rejects.toThrow("connection lost");
  });
});
