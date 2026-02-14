import { getErrorMessage } from '../utils/errorUtils';
import { memoryStorage } from './memoryStorageService';

class SyncService {  
  // Synchroniser maintenant et retourner le résultat
  async syncNow(userId: string): Promise<{success: boolean, message?: string, error?: any}> {
    console.log(`Tentative de synchronisation pour l'utilisateur ${userId}`);
    
    // Vérifier si une synchronisation est nécessaire
    if (!memoryStorage.isDirty(userId)) {
      console.log(`Aucune synchronisation nécessaire pour l'utilisateur ${userId}`);
      return { success: true, message: "Aucune modification à synchroniser" };
    }
    
    try {
      // Import dynamique pour éviter les dépendances circulaires
      const { syncUserDataToDB } = await import('../controllers/authControllers');
      
      // Appeler la fonction de synchronisation et attendre le résultat
      await syncUserDataToDB(userId);
      
      console.log(`Synchronisation réussie pour l'utilisateur ${userId}`);
      return { 
        success: true, 
        message: "Synchronisation effectuée avec succès" 
      };
    } catch (error) {
      console.error(`Échec de la synchronisation pour l'utilisateur ${userId}:`, error);
      return { 
        success: false, 
        message: "Échec de la synchronisation", 
        error: error instanceof Error ? getErrorMessage(error) : String(error) 
      };
    }
  }
}

export const syncService = new SyncService();