// src/__tests__/services/notificationService.preferences.test.ts
// Tests : respect des préférences de notifications dans sendNotificationToUser

const mockMessaging = {
  sendEach: jest.fn(),
  send: jest.fn(),
};

const mockApp = { name: "default" };

const mockFirebaseAdmin = {
  apps: [mockApp] as any[],
  app: jest.fn(() => mockApp),
  initializeApp: jest.fn(() => mockApp),
  credential: {
    cert: jest.fn((serviceAccount) => ({ serviceAccount })),
    applicationDefault: jest.fn(() => ({ type: "application_default" })),
  },
  messaging: jest.fn(() => mockMessaging),
};

jest.mock("firebase-admin", () => mockFirebaseAdmin);

jest.mock("../../models/notifications");
jest.mock("../../models/pendingNotification");
jest.mock("../../models/users", () => ({
  __esModule: true,
  default: {
    findById: jest.fn(),
  },
  UserModel: {
    findById: jest.fn(),
  },
}));
jest.mock("../../services/pushTokenService");
jest.mock("../../services/webSocketService", () => ({
  webSocketService: {
    sendNotificationToUser: jest.fn(),
  },
}));
jest.mock("../../services/dataArchiveService", () => ({
  __esModule: true,
  default: {
    archiveAndRecordDeletion: jest.fn().mockResolvedValue({}),
  },
}));

import mongoose from "mongoose";
import UserModel from "../../models/users";
import { NotificationService } from "../../services/notificationService";
import { webSocketService } from "../../services/webSocketService";
import * as pushTokenService from "../../services/pushTokenService";

type Prefs = {
  messages: boolean;
  contacts: boolean;
  shares: boolean;
  groups: boolean;
  community_sos: boolean;
  quietHours: { enabled: boolean; start: string; end: string };
};

const defaultPrefs: Prefs = {
  messages: true,
  contacts: true,
  shares: true,
  groups: true,
  community_sos: true,
  quietHours: { enabled: false, start: "22:00", end: "07:00" },
};

function mockUserPrefs(prefs: Prefs) {
  const lean = jest.fn().mockResolvedValue({ notificationPreferences: prefs });
  const select = jest.fn().mockReturnValue({ lean });
  (UserModel.findById as jest.Mock).mockReturnValue({ select });
}

function mockTokens(count: number) {
  (pushTokenService.getTokensByUserId as jest.Mock).mockResolvedValue(
    Array.from({ length: count }, (_, i) => ({
      token: `tok-${i}`,
      deviceId: `dev-${i}`,
      platform: "android" as const,
    })),
  );
  mockMessaging.sendEach.mockResolvedValue({
    successCount: count,
    failureCount: 0,
    responses: Array.from({ length: count }, () => ({ success: true })),
  });
}

describe("NotificationService — préférences utilisateur", () => {
  const userId = "507f1f77bcf86cd799439011";

  beforeEach(() => {
    jest.clearAllMocks();
    // Force fcmInitialized=true via accès interne
    (NotificationService as any).fcmInitialized = true;
    // resetMocks (jest.config) ré-initialise les implémentations.
    // On restaure celles dont on a besoin.
    mockFirebaseAdmin.messaging.mockReturnValue(mockMessaging);
    mockFirebaseAdmin.credential.cert.mockImplementation((sa: any) => ({
      serviceAccount: sa,
    }));
    // WebSocket : par défaut, user offline → délégation au push
    (webSocketService.sendNotificationToUser as jest.Mock).mockReturnValue(
      false,
    );
    mockTokens(1);
  });

  it("envoie sos_alert (P0 perso) même si messages=false", async () => {
    mockUserPrefs({ ...defaultPrefs, messages: false });

    await NotificationService.sendNotificationToUser(
      userId,
      "sos_alert",
      "SOS",
      "Alerte SOS",
    );

    expect(mockMessaging.sendEach).toHaveBeenCalledTimes(1);
  });

  it("skip push pour message (P1) si messages=false", async () => {
    mockUserPrefs({ ...defaultPrefs, messages: false });

    await NotificationService.sendNotificationToUser(
      userId,
      "message",
      "Nouveau message",
      "Bonjour",
    );

    expect(mockMessaging.sendEach).not.toHaveBeenCalled();
  });

  it("skip push pour share_received (P2) en quiet hours", async () => {
    mockUserPrefs({
      ...defaultPrefs,
      quietHours: { enabled: true, start: "00:00", end: "23:59" },
    });

    await NotificationService.sendNotificationToUser(
      userId,
      "share_received",
      "Partage",
      "Reçu",
    );

    expect(mockMessaging.sendEach).not.toHaveBeenCalled();
  });

  it("envoie sos_alert (P0 perso) même en quiet hours", async () => {
    mockUserPrefs({
      ...defaultPrefs,
      quietHours: { enabled: true, start: "00:00", end: "23:59" },
    });

    await NotificationService.sendNotificationToUser(
      userId,
      "sos_alert",
      "SOS",
      "Alerte",
    );

    expect(mockMessaging.sendEach).toHaveBeenCalledTimes(1);
  });

  it("skip sos_stage1_alert si community_sos=false", async () => {
    mockUserPrefs({ ...defaultPrefs, community_sos: false });

    await NotificationService.sendNotificationToUser(
      new mongoose.Types.ObjectId(userId),
      "sos_stage1_alert",
      "Alerte communauté",
      "Quelqu'un a besoin d'aide",
    );

    expect(mockMessaging.sendEach).not.toHaveBeenCalled();
  });
});
