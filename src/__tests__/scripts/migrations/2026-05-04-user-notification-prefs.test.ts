/**
 * Tests d'idempotence pour la migration `2026-05-04-user-notification-prefs`.
 *
 * Cf. AUDIT_2026-05-11 §4.4 (P1). La migration injecte
 * `DEFAULT_NOTIFICATION_PREFERENCES` UNIQUEMENT sur les users où le champ
 * `notificationPreferences` est absent ou null. Vérifie que :
 *
 *  1. DB vierge (champ absent) → applique sur tous les users
 *  2. Re-run consécutif → 0 modif (idempotent)
 *  3. DB partiellement migrée → ne touche QUE les users non migrés
 *  4. Le filtre `$or { $exists: false } / null` est exact (anti-régression)
 */

jest.mock("../../../models/users", () => {
  const mockUpdateMany = jest.fn();
  return {
    __esModule: true,
    default: { updateMany: mockUpdateMany },
  };
});

jest.mock("../../../config/database", () => ({
  connectToDatabase: jest.fn().mockResolvedValue(undefined),
}));

import UserModel from "../../../models/users";
import { run } from "../../../scripts/migrations/2026-05-04-user-notification-prefs";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "../../../services/notificationPreferencesService";

describe("Migration 2026-05-04-user-notification-prefs — idempotence", () => {
  const updateManyMock = (UserModel as unknown as {
    updateMany: jest.Mock;
  }).updateMany;

  beforeEach(() => {
    updateManyMock.mockReset();
  });

  it("Test 1 — DB vierge : tous les users sans prefs reçoivent les défauts", async () => {
    // 10 users, aucun n'a notificationPreferences
    updateManyMock.mockResolvedValueOnce({
      matchedCount: 10,
      modifiedCount: 10,
    });

    const modified = await run();

    expect(modified).toBe(10);
    expect(updateManyMock).toHaveBeenCalledTimes(1);
    expect(updateManyMock).toHaveBeenCalledWith(
      {
        $or: [
          { notificationPreferences: { $exists: false } },
          { notificationPreferences: null },
        ],
      },
      {
        $set: {
          notificationPreferences: DEFAULT_NOTIFICATION_PREFERENCES,
        },
      },
    );
  });

  it("Test 2 — Re-run consécutif : aucun user matché, 0 modif (idempotent)", async () => {
    // 1er run : 8 users migrés
    updateManyMock.mockResolvedValueOnce({
      matchedCount: 8,
      modifiedCount: 8,
    });
    const firstRun = await run();
    expect(firstRun).toBe(8);

    // 2e run : plus aucun user sans prefs (filtre $or vide)
    updateManyMock.mockResolvedValueOnce({
      matchedCount: 0,
      modifiedCount: 0,
    });
    const secondRun = await run();

    expect(secondRun).toBe(0);
    expect(updateManyMock).toHaveBeenCalledTimes(2);
  });

  it("Test 3 — DB partiellement migrée : seuls les users non migrés sont touchés", async () => {
    // 5 users sans prefs, 15 déjà migrés → seul 5 doivent être modifiés
    updateManyMock.mockResolvedValueOnce({
      matchedCount: 5,
      modifiedCount: 5,
    });

    const modified = await run();

    expect(modified).toBe(5);

    // Vérif anti-régression : le filtre exclut bien les users avec prefs définies
    const filterArg = updateManyMock.mock.calls[0][0];
    expect(filterArg).toEqual({
      $or: [
        { notificationPreferences: { $exists: false } },
        { notificationPreferences: null },
      ],
    });
    // Pas de filtre vide qui matcherait TOUT le monde !
    expect(filterArg).not.toEqual({});
  });

  it("Test 4 — DB avec users à notificationPreferences=null → ils sont migrés", async () => {
    // Cas hybride : 3 users avec field absent, 2 avec field=null
    updateManyMock.mockResolvedValueOnce({
      matchedCount: 5,
      modifiedCount: 5,
    });

    const modified = await run();

    expect(modified).toBe(5);
    expect(updateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        $or: expect.arrayContaining([
          { notificationPreferences: { $exists: false } },
          { notificationPreferences: null },
        ]),
      }),
      expect.objectContaining({
        $set: { notificationPreferences: DEFAULT_NOTIFICATION_PREFERENCES },
      }),
    );
  });

  it("Test 5 — modifiedCount absent (driver legacy) → retourne 0 sans crash", async () => {
    updateManyMock.mockResolvedValueOnce({ matchedCount: 3 });

    const modified = await run();

    expect(modified).toBe(0);
  });

  it("Test 6 — erreur DB propagée (la migration ne masque pas les erreurs)", async () => {
    updateManyMock.mockRejectedValueOnce(new Error("write conflict"));

    await expect(run()).rejects.toThrow("write conflict");
  });

  it("Test 7 — DEFAULT_NOTIFICATION_PREFERENCES contient toutes les catégories attendues", () => {
    // Garde-fou : si quelqu'un ajoute une catégorie au type sans toucher
    // le défaut, ce test pète et oblige à mettre à jour la migration.
    expect(DEFAULT_NOTIFICATION_PREFERENCES).toEqual(
      expect.objectContaining({
        messages: expect.any(Boolean),
        contacts: expect.any(Boolean),
        shares: expect.any(Boolean),
        groups: expect.any(Boolean),
        community_sos: expect.any(Boolean),
        quietHours: expect.objectContaining({
          enabled: expect.any(Boolean),
          start: expect.any(String),
          end: expect.any(String),
        }),
      }),
    );
  });
});
