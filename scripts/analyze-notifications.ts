/**
 * Script d'analyse des notifications existantes
 */

import mongoose from "mongoose";
import NotificationModel from "../src/models/notifications";
import dotenv from "dotenv";

dotenv.config();

async function analyzeNotifications(): Promise<void> {
  try {
    console.log("\n📊 ANALYSE DES NOTIFICATIONS EXISTANTES");
    console.log(
      "═════════════════════════════════════════════════════════════\n",
    );

    const dbConnString = process.env.DB_CONN_STRING;
    if (!dbConnString) {
      throw new Error("DB_CONN_STRING manquant dans .env");
    }

    await mongoose.connect(dbConnString, {
      dbName: process.env.DB_NAME || "QvarryStorage",
    });
    console.log("✓ Connecté à MongoDB\n");

    // Statistiques globales
    const totalNotifications = await NotificationModel.countDocuments();
    const totalUnread = await NotificationModel.countDocuments({ read: false });
    const usersWithNotifications = await NotificationModel.distinct("userId");

    console.log("📈 STATISTIQUES GLOBALES");
    console.log(
      "─────────────────────────────────────────────────────────────",
    );
    console.log(`   • Total notifications: ${totalNotifications}`);
    console.log(`   • Non lues: ${totalUnread}`);
    console.log(
      `   • Utilisateurs concernés: ${usersWithNotifications.length}\n`,
    );

    // Analyse par utilisateur
    console.log("👥 TOP 10 UTILISATEURS");
    console.log(
      "─────────────────────────────────────────────────────────────",
    );

    const topUsers = await NotificationModel.aggregate([
      {
        $group: {
          _id: "$userId",
          total: { $sum: 1 },
          unread: {
            $sum: {
              $cond: [{ $eq: ["$read", false] }, 1, 0],
            },
          },
        },
      },
      { $sort: { total: -1 } },
      { $limit: 10 },
    ]);

    for (const user of topUsers) {
      console.log(`   • User ${user._id}:`);
      console.log(`     - Total: ${user.total}`);
      console.log(`     - Non lues: ${user.unread}`);

      // Récupérer les notifications pour vérifier la cohérence
      const notifications = await NotificationModel.find({ userId: user._id })
        .sort({ createdAt: -1 })
        .limit(5)
        .lean();

      console.log(`     - Dernières visibles: ${notifications.length}`);

      // VÉRIFICATION: Comparer countDocuments vs find().length
      const countResult = await NotificationModel.countDocuments({
        userId: user._id,
      });
      const findResult = await NotificationModel.find({
        userId: user._id,
      }).lean();

      if (countResult !== findResult.length) {
        console.log(`     ⚠️  INCOHÉRENCE DÉTECTÉE!`);
        console.log(`        countDocuments: ${countResult}`);
        console.log(`        find().length: ${findResult.length}`);
      }
    }

    console.log();

    // Notifications récentes
    console.log("🕐 NOTIFICATIONS RÉCENTES (10 dernières)");
    console.log(
      "─────────────────────────────────────────────────────────────",
    );

    const recentNotifications = await NotificationModel.find()
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    for (const notif of recentNotifications) {
      console.log(`   • ${notif.type} - ${notif.title}`);
      console.log(`     Créée: ${notif.createdAt}`);
      console.log(`     User: ${notif.userId}`);
      console.log(`     Lue: ${notif.read ? "Oui" : "Non"}`);
    }

    console.log();

    await mongoose.disconnect();
    console.log("✓ Analyse terminée\n");
  } catch (error) {
    console.error("❌ Erreur:", error);
    process.exit(1);
  }
}

analyzeNotifications();
