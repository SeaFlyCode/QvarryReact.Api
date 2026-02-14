import mongoose from "mongoose";
import { getErrorMessage } from "../utils/errorUtils";

/**
 * Masque les credentials dans une connection string MongoDB
 * Transforme: mongodb+srv://user:password@cluster... en mongodb+srv://user:***@cluster...
 */
function maskConnectionString(connString: string): string {
    return connString.replace(/:([^:@]+)@/, ':***@');
}

export async function connectToDatabase() {
    const dbName = process.env.DB_NAME || "QvarryStorage";
    const dbConnString = process.env.DB_CONN_STRING || "";
    const isProduction = process.env.NODE_ENV === 'production';

    // SSL/TLS: activé par défaut en production, configurable via DB_SSL
    const enableSSL = process.env.DB_SSL
        ? process.env.DB_SSL === 'true'
        : isProduction;

    if (!dbConnString) {
        console.error("❌ Missing DB_CONN_STRING environment variable");
        throw new Error("Missing DB_CONN_STRING env variable");
    }

    // Options de sécurité MongoDB
    const mongoOptions: mongoose.ConnectOptions = {
        dbName,
        // Timeouts pour éviter les connexions infinies
        serverSelectionTimeoutMS: 5000,    // Timeout sélection serveur: 5s
        socketTimeoutMS: 45000,            // Timeout socket: 45s
        connectTimeoutMS: 10000,           // Timeout connexion: 10s
        // Pool de connexions
        maxPoolSize: 10,                   // Max 10 connexions simultanées
        minPoolSize: 2,                    // Min 2 connexions maintenues
        // Sécurité écriture
        retryWrites: true,
        w: 'majority',                     // Confirmation écriture majorité
        // SSL/TLS configurable
        ...(enableSSL && {
            ssl: true,
            tls: true,
        }),
    };

    try {
        await mongoose.connect(dbConnString, mongoOptions);
        console.log(`✅ Database "${dbName}" connected${enableSSL ? ' (SSL/TLS)' : ''}`);
    } catch (error) {
        // SÉCURITÉ: Ne jamais afficher la connection string avec les credentials
        const maskedConnString = maskConnectionString(dbConnString);
        console.error(`❌ Database connection failed (${maskedConnString}):`,
            error instanceof Error ? getErrorMessage(error) : 'Unknown error'
        );
        throw new Error('Database connection failed');
    }
}

