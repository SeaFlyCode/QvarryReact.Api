/**
 * Script de diagnostic pour identifier le problème des notifications
 * Scénario A: unreadCount: 1 mais notifications: []
 */

import mongoose from "mongoose";
import NotificationModel from "../src/models/notifications";
import { logger } from "../src/services/loggerService";
import dotenv from "dotenv";

dotenv.config();

const diagLogger = logger.child({ service: "diagnostic" });

interface DiagnosticResult {
  step: string;
  success: boolean;
  data?: any;
  error?: string;
}

async function runDiagnostic(): Promise<void> {
  const results: DiagnosticResult[] = [];

  try {
    // ═══════════════════════════════════════════════════════════════════════════
    // ÉTAPE 1 : Connexion MongoDB
    // ═══════════════════════════════════════════════════════════════════════════
    console.log("\n🔍 DIAGNOSTIC DES NOTIFICATIONS");
    console.log(
      "═════════════════════════════════════════════════════════════\n",
    );

    const dbConnString = process.env.DB_CONN_STRING;
    if (!dbConnString) {
      throw new Error("DB_CONN_STRING manquant dans .env");
    }

    console.log("📡 Connexion à MongoDB...");
    await mongoose.connect(dbConnString, {
      dbName: process.env.DB_NAME || "QvarryStorage",
    });
    results.push({ step: "Connexion MongoDB", success: true });
    console.log("✓ Connecté\n");

    // ═══════════════════════════════════════════════════════════════════════════
    // ÉTAPE 2 : Récupérer un userId de test
    // ═══════════════════════════════════════════════════════════════════════════
    console.log("👤 Recherche d'un utilisateur de test...");
    const User = mongoose.model(
      "User",
      new mongoose.Schema({}, { strict: false }),
    );
    const testUser = await User.findOne({}).lean();

    if (!testUser || !testUser._id) {
      throw new Error("Aucun utilisateur trouvé dans la base");
    }

    const userId = testUser._id as mongoose.Types.ObjectId;
    console.log(`✓ Utilisateur trouvé: ${userId}\n`);
    results.push({
      step: "Récupération utilisateur test",
      success: true,
      data: { userId: userId.toString() },
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // ÉTAPE 3 : État initial
    // ═══════════════════════════════════════════════════════════════════════════
    console.log("📊 État AVANT création...");
    const beforeCount = await NotificationModel.countDocuments({ userId });
    const beforeUnread = await NotificationModel.countDocuments({
      userId,
      read: false,
    });
    const beforeNotifications = await NotificationModel.find({ userId })
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    console.log(`   • Total notifications: ${beforeCount}`);
    console.log(`   • Non lues: ${beforeUnread}`);
    console.log(`   • Dernières: ${beforeNotifications.length}\n`);

    results.push({
      step: "État initial",
      success: true,
      data: {
        total: beforeCount,
        unread: beforeUnread,
        latest: beforeNotifications.length,
      },
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // ÉTAPE 4 : Créer une notification de test
    // ═══════════════════════════════════════════════════════════════════════════
    console.log("🔨 Création d'une notification de test...");
    const testNotification = new NotificationModel({
      userId,
      type: "admin_notification",
      title: "[DIAGNOSTIC] Test notification",
      message: `Test créé à ${new Date().toISOString()}`,
      read: false,
      createdAt: new Date(),
    });

    const savedNotification = await testNotification.save();
    console.log(`✓ Notification créée: ${savedNotification._id}`);
    console.log(`   • userId: ${savedNotification.userId}`);
    console.log(`   • type: ${savedNotification.type}`);
    console.log(`   • read: ${savedNotification.read}`);
    console.log(`   • createdAt: ${savedNotification.createdAt}\n`);

    results.push({
      step: "Création notification",
      success: true,
      data: {
        _id: savedNotification._id.toString(),
        userId: savedNotification.userId.toString(),
        read: savedNotification.read,
      },
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // ÉTAPE 5 : Vérification IMMÉDIATE (sans délai)
    // ═══════════════════════════════════════════════════════════════════════════
    console.log("⏱️  Vérification IMMÉDIATE (t+0ms)...");
    const immediateCount = await NotificationModel.countDocuments({ userId });
    const immediateUnread = await NotificationModel.countDocuments({
      userId,
      read: false,
    });
    const immediateNotifications = await NotificationModel.find({ userId })
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    console.log(`   • Total notifications: ${immediateCount}`);
    console.log(`   • Non lues: ${immediateUnread}`);
    console.log(`   • Dernières: ${immediateNotifications.length}`);

    const foundImmediately = immediateNotifications.some(
      (n: any) => n._id.toString() === savedNotification._id.toString(),
    );
    console.log(
      `   • Notification trouvée: ${foundImmediately ? "✓ OUI" : "✗ NON"}\n`,
    );

    results.push({
      step: "Vérification immédiate",
      success: foundImmediately,
      data: {
        total: immediateCount,
        unread: immediateUnread,
        found: foundImmediately,
        delta: immediateCount - beforeCount,
      },
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // ÉTAPE 6 : Vérification par _id direct
    // ═══════════════════════════════════════════════════════════════════════════
    console.log("🔎 Vérification par _id direct...");
    const directFind = await NotificationModel.findById(
      savedNotification._id,
    ).lean();

    if (directFind) {
      console.log(`✓ Notification trouvée par _id`);
      console.log(
        `   • userId correspond: ${directFind.userId.toString() === userId.toString()}`,
      );
      console.log(`   • read: ${directFind.read}`);
      console.log(`   • type: ${directFind.type}\n`);
    } else {
      console.log(`✗ Notification NON trouvée par _id\n`);
    }

    results.push({
      step: "Vérification par _id",
      success: !!directFind,
      data: directFind
        ? {
            found: true,
            userId: directFind.userId.toString(),
            read: directFind.read,
          }
        : { found: false },
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // ÉTAPE 7 : Attendre 2 secondes et revérifier
    // ═══════════════════════════════════════════════════════════════════════════
    console.log("⏳ Attente de 2 secondes...");
    await new Promise((resolve) => setTimeout(resolve, 2000));

    console.log("⏱️  Vérification APRÈS délai (t+2000ms)...");
    const delayedCount = await NotificationModel.countDocuments({ userId });
    const delayedUnread = await NotificationModel.countDocuments({
      userId,
      read: false,
    });
    const delayedNotifications = await NotificationModel.find({ userId })
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    console.log(`   • Total notifications: ${delayedCount}`);
    console.log(`   • Non lues: ${delayedUnread}`);
    console.log(`   • Dernières: ${delayedNotifications.length}`);

    const foundAfterDelay = delayedNotifications.some(
      (n: any) => n._id.toString() === savedNotification._id.toString(),
    );
    console.log(
      `   • Notification trouvée: ${foundAfterDelay ? "✓ OUI" : "✗ NON"}\n`,
    );

    results.push({
      step: "Vérification après délai",
      success: foundAfterDelay,
      data: {
        total: delayedCount,
        unread: delayedUnread,
        found: foundAfterDelay,
      },
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // ÉTAPE 8 : Vérification des index MongoDB
    // ═══════════════════════════════════════════════════════════════════════════
    console.log("📇 Vérification des index MongoDB...");
    const indexes = await NotificationModel.collection.getIndexes();
    console.log(`✓ Index trouvés: ${Object.keys(indexes).length}`);
    Object.entries(indexes).forEach(([name, spec]) => {
      console.log(`   • ${name}: ${JSON.stringify(spec)}`);
    });
    console.log();

    results.push({
      step: "Vérification index",
      success: true,
      data: { indexCount: Object.keys(indexes).length },
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // ÉTAPE 9 : Test avec requête raw MongoDB
    // ═══════════════════════════════════════════════════════════════════════════
    console.log("🔧 Test avec requête MongoDB native...");
    const rawResult = await NotificationModel.collection
      .find({ userId: new mongoose.Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .limit(5)
      .toArray();

    console.log(`   • Documents retournés: ${rawResult.length}`);
    const foundRaw = rawResult.some(
      (n: any) => n._id.toString() === savedNotification._id.toString(),
    );
    console.log(`   • Notification trouvée: ${foundRaw ? "✓ OUI" : "✗ NON"}\n`);

    results.push({
      step: "Requête MongoDB native",
      success: foundRaw,
      data: { count: rawResult.length, found: foundRaw },
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // RÉSUMÉ FINAL
    // ═══════════════════════════════════════════════════════════════════════════
    console.log(
      "═════════════════════════════════════════════════════════════",
    );
    console.log("📋 RÉSUMÉ DU DIAGNOSTIC\n");

    const failedSteps = results.filter((r) => !r.success);
    if (failedSteps.length === 0) {
      console.log("✓ TOUS LES TESTS RÉUSSIS");
      console.log("→ Le problème ne se reproduit PAS dans ce test");
      console.log("→ Hypothèse: Problème côté frontend ou API différente\n");
    } else {
      console.log(`✗ ${failedSteps.length} TEST(S) ÉCHOUÉ(S):\n`);
      failedSteps.forEach((step) => {
        console.log(`   • ${step.step}`);
        if (step.data) {
          console.log(`     ${JSON.stringify(step.data, null, 2)}`);
        }
      });
      console.log();
    }

    // Analyse du problème
    const immediateCheck = results.find(
      (r) => r.step === "Vérification immédiate",
    );
    const delayedCheck = results.find(
      (r) => r.step === "Vérification après délai",
    );

    if (!immediateCheck?.success && delayedCheck?.success) {
      console.log(
        "🔍 DIAGNOSTIC: Problème de synchronisation (race condition)",
      );
      console.log(
        "   → La notification existe mais n'est pas visible immédiatement",
      );
      console.log(
        "   → Solution: Attendre avant de requêter OU forcer un refresh\n",
      );
    } else if (!immediateCheck?.success && !delayedCheck?.success) {
      console.log("🔍 DIAGNOSTIC: Problème de persistance MongoDB");
      console.log(
        "   → La notification n'est jamais visible dans les requêtes",
      );
      console.log("   → Vérifier les transactions/commits MongoDB\n");
    }

    // Nettoyage
    console.log("🧹 Nettoyage de la notification de test...");
    await NotificationModel.deleteOne({ _id: savedNotification._id });
    console.log("✓ Nettoyé\n");
  } catch (error) {
    console.error("❌ ERREUR FATALE:", error);
    diagLogger.error("Diagnostic failed", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  } finally {
    await mongoose.disconnect();
    console.log("👋 Déconnecté de MongoDB\n");
  }
}

// Exécution
runDiagnostic()
  .then(() => {
    console.log("✓ Diagnostic terminé");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Erreur:", error);
    process.exit(1);
  });
