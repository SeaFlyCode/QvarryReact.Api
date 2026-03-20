/\*\*

- TESTS MANUELS DES NOUVELLES FONCTIONNALITÉS
-
- Ce fichier contient des exemples de requêtes pour tester les nouvelles fonctionnalités.
- Utilisez un outil comme curl, Postman, ou Thunder Client (VSCode).
-
- IMPORTANT: Remplacez les valeurs suivantes :
- - {{BASE_URL}} : URL de base (ex: http://localhost:8080/api/v1)
- - {{TOKEN}} : Votre token d'authentification JWT
- - {{CONVERSATION_ID}} : ID d'une conversation de test
    \*/

// ═══════════════════════════════════════════════════════════════════════════
// 1. MUTE/UNMUTE
// ═══════════════════════════════════════════════════════════════════════════

// Muter une conversation indéfiniment
POST {{BASE_URL}}/conversations/{{CONVERSATION_ID}}/mute
Authorization: Bearer {{TOKEN}}
Content-Type: application/json

{
"mutedUntil": null,
"notifyOnMention": true
}

// Muter une conversation pour 24h
POST {{BASE_URL}}/conversations/{{CONVERSATION_ID}}/mute
Authorization: Bearer {{TOKEN}}
Content-Type: application/json

{
"mutedUntil": "2026-03-21T18:00:00Z",
"notifyOnMention": false
}

// Réactiver le son
PATCH {{BASE_URL}}/conversations/{{CONVERSATION_ID}}/unmute
Authorization: Bearer {{TOKEN}}

// ═══════════════════════════════════════════════════════════════════════════
// 2. ARCHIVE/UNARCHIVE
// ═══════════════════════════════════════════════════════════════════════════

// Archiver une conversation
PATCH {{BASE_URL}}/conversations/{{CONVERSATION_ID}}/archive
Authorization: Bearer {{TOKEN}}

// Désarchiver une conversation
PATCH {{BASE_URL}}/conversations/{{CONVERSATION_ID}}/unarchive
Authorization: Bearer {{TOKEN}}

// Lister les conversations archivées
GET {{BASE_URL}}/conversations/archived?limit=20&skip=0
Authorization: Bearer {{TOKEN}}

// Lister toutes les conversations (incluant archivées)
GET {{BASE_URL}}/conversations?includeArchived=true
Authorization: Bearer {{TOKEN}}

// ═══════════════════════════════════════════════════════════════════════════
// 3. PIN/UNPIN
// ═══════════════════════════════════════════════════════════════════════════

// Épingler une conversation (ordre auto-calculé)
PATCH {{BASE_URL}}/conversations/{{CONVERSATION_ID}}/pin
Authorization: Bearer {{TOKEN}}

// Épingler avec ordre spécifique
PATCH {{BASE_URL}}/conversations/{{CONVERSATION_ID}}/pin
Authorization: Bearer {{TOKEN}}
Content-Type: application/json

{
"order": 1
}

// Désépingler
PATCH {{BASE_URL}}/conversations/{{CONVERSATION_ID}}/unpin
Authorization: Bearer {{TOKEN}}

// Tester la limite de 5 pins (doit échouer après 5)
// Épinglez 6 conversations différentes et vérifiez l'erreur sur la 6ème

// ═══════════════════════════════════════════════════════════════════════════
// 4. MARK AS UNREAD/READ
// ═══════════════════════════════════════════════════════════════════════════

// Marquer comme non lu
PATCH {{BASE_URL}}/conversations/{{CONVERSATION_ID}}/mark-unread
Authorization: Bearer {{TOKEN}}

// Retirer le marquage non lu
PATCH {{BASE_URL}}/conversations/{{CONVERSATION_ID}}/mark-read-flag
Authorization: Bearer {{TOKEN}}

// ═══════════════════════════════════════════════════════════════════════════
// 5. BLOCK/UNBLOCK
// ═══════════════════════════════════════════════════════════════════════════

// Bloquer une conversation (sans raison)
PATCH {{BASE_URL}}/conversations/{{CONVERSATION_ID}}/block
Authorization: Bearer {{TOKEN}}

// Bloquer avec raison
PATCH {{BASE_URL}}/conversations/{{CONVERSATION_ID}}/block
Authorization: Bearer {{TOKEN}}
Content-Type: application/json

{
"reason": "Spam ou comportement inapproprié"
}

// Débloquer
PATCH {{BASE_URL}}/conversations/{{CONVERSATION_ID}}/unblock
Authorization: Bearer {{TOKEN}}

// Tester l'envoi de message via WebSocket quand bloqué (doit échouer)

// ═══════════════════════════════════════════════════════════════════════════
// 6. VÉRIFIER userPreferences
// ═══════════════════════════════════════════════════════════════════════════

// Lister les conversations et vérifier le champ userPreferences
GET {{BASE_URL}}/conversations
Authorization: Bearer {{TOKEN}}

// Réponse attendue :
/_
{
"data": [
{
"\_id": "...",
"name": "...",
"isGroup": true,
"participants": [...],
"lastMessage": "...",
"unreadCount": 5,
"userPreferences": {
"isMuted": false,
"mutedUntil": null,
"notifyOnMention": true,
"isArchived": false,
"isPinned": true,
"pinOrder": 1,
"isMarkedUnread": false,
"isBlocked": false
},
"createdAt": "...",
"updatedAt": "..."
}
],
"pagination": {
"page": 1,
"limit": 20,
"total": 42,
"totalPages": 3
}
}
_/

// ═══════════════════════════════════════════════════════════════════════════
// 7. TESTS DE VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

// Tester mutedUntil dans le passé (doit échouer)
PATCH {{BASE_URL}}/conversations/{{CONVERSATION_ID}}/mute
Authorization: Bearer {{TOKEN}}
Content-Type: application/json

{
"mutedUntil": "2020-01-01T00:00:00Z"
}

// Tester mutedUntil trop loin dans le futur (doit échouer)
PATCH {{BASE_URL}}/conversations/{{CONVERSATION_ID}}/mute
Authorization: Bearer {{TOKEN}}
Content-Type: application/json

{
"mutedUntil": "2030-01-01T00:00:00Z"
}

// Tester order négatif (doit échouer)
PATCH {{BASE_URL}}/conversations/{{CONVERSATION_ID}}/pin
Authorization: Bearer {{TOKEN}}
Content-Type: application/json

{
"order": -1
}

// Tester reason trop long (doit échouer)
PATCH {{BASE_URL}}/conversations/{{CONVERSATION_ID}}/block
Authorization: Bearer {{TOKEN}}
Content-Type: application/json

{
"reason": "A".repeat(501)
}

// Tester ObjectId invalide (doit échouer)
PATCH {{BASE_URL}}/conversations/invalid-id/mute
Authorization: Bearer {{TOKEN}}

// ═══════════════════════════════════════════════════════════════════════════
// 8. TESTS DE SÉCURITÉ
// ═══════════════════════════════════════════════════════════════════════════

// Tester sans authentification (doit échouer avec 401)
PATCH {{BASE_URL}}/conversations/{{CONVERSATION_ID}}/mute

// Tester sur une conversation où on n'est pas participant (doit échouer avec 403)
// Créez une conversation avec un autre utilisateur, puis essayez de la muter

// Tester double mute (devrait mettre à jour)
PATCH {{BASE_URL}}/conversations/{{CONVERSATION_ID}}/mute
PATCH {{BASE_URL}}/conversations/{{CONVERSATION_ID}}/mute

// Tester unmute sans mute préalable (doit échouer avec 400)
PATCH {{BASE_URL}}/conversations/{{CONVERSATION_ID}}/unmute

// ═══════════════════════════════════════════════════════════════════════════
// 9. TESTS DE TRI
// ═══════════════════════════════════════════════════════════════════════════

/\*
SCÉNARIO DE TEST :

1. Épinglez 3 conversations avec des orders différents (1, 2, 3)
2. Appelez GET /conversations
3. Vérifiez que :
   - Les 3 conversations épinglées sont en haut
   - Elles sont triées par order (1, 2, 3)
   - Les conversations non épinglées sont ensuite triées par updatedAt DESC
     \*/

// ═══════════════════════════════════════════════════════════════════════════
// 10. TESTS DE NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════════

/\*
SCÉNARIO DE TEST :

1. Mutez une conversation avec notifyOnMention: true
2. Demandez à un autre utilisateur d'envoyer un message normal → pas de notification
3. Demandez-lui d'envoyer un message avec mention (@vous) → notification reçue
4. Mutez avec notifyOnMention: false
5. Demandez-lui d'envoyer un message avec mention → pas de notification
   \*/

// ═══════════════════════════════════════════════════════════════════════════
// 11. TESTS WEBSOCKET
// ═══════════════════════════════════════════════════════════════════════════

/\*
SCÉNARIO DE TEST :

1. Connectez-vous au WebSocket de messages
2. Bloquez la conversation via REST API
3. Essayez d'envoyer un message via WebSocket
4. Vérifiez que vous recevez :
   {
   "type": "error",
   "code": "CONVERSATION_BLOCKED",
   "message": "Cette conversation est bloquée"
   }
5. Débloquez la conversation
6. Vérifiez que vous pouvez à nouveau envoyer des messages
   \*/

// ═══════════════════════════════════════════════════════════════════════════
// 12. TESTS CRON JOB
// ═══════════════════════════════════════════════════════════════════════════

/\*
SCÉNARIO DE TEST :

1. Mutez une conversation avec mutedUntil dans 2 minutes
2. Attendez 2 minutes
3. Vérifiez que le cron job nettoie automatiquement le mute
4. Vérifiez dans les logs :
   "Nettoyage des mutes expirés terminé"
   \*/

// Ou exécutez manuellement :
// npx ts-node -e "import('./src/jobs/cleanExpiredMutes').then(m => m.cleanExpiredMutesManually().then(console.log))"

// ═══════════════════════════════════════════════════════════════════════════
// 13. TESTS DE PERFORMANCE
// ═══════════════════════════════════════════════════════════════════════════

// Tester avec beaucoup de conversations (pagination)
GET {{BASE_URL}}/conversations?page=1&limit=100
Authorization: Bearer {{TOKEN}}

// Vérifier que les index MongoDB sont utilisés (vérifier les logs de performance)

// ═══════════════════════════════════════════════════════════════════════════
// 14. TESTS DE ROLLBACK (ATTENTION : DESTRUCTIF)
// ═══════════════════════════════════════════════════════════════════════════

/\*
SCÉNARIO DE TEST (sur environnement de dev uniquement) :

1. Mutez/archivez/épinglez plusieurs conversations
2. Exécutez le rollback :
   npx ts-node src/migrations/conversationFeatures.ts rollback
3. Vérifiez que tous les nouveaux champs sont supprimés
4. Réexécutez la migration :
   npx ts-node src/migrations/conversationFeatures.ts
5. Vérifiez que les champs sont réinitialisés à []
   \*/
