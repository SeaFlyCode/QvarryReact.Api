# 🔴 RAPPORT DE DIAGNOSTIC : Incohérence Notifications

**Date**: 19 Mars 2026  
**Problème**: `unreadCount: 1` mais `notifications: []`  
**Scénario**: A - Notification créée mais invisible

---

## 📊 Symptômes Observés

```javascript
// Log Frontend (NotificationBell)
Object {
  total: 0,
  unreadCount: 1,
  notificationsCount: 0,
  notifications: []
}
```

**Incohérence identifiée** :

- ✅ `unreadCount: 1` → Le compteur détecte 1 notification non lue
- ❌ `notifications: []` → Mais le tableau est vide
- ❌ `total: 0` → Le total indique 0 notifications

---

## 🔍 Analyse du Code Backend

### 1. **Modèle Notification** (`src/models/notifications.ts`)

```typescript
const notificationSchema: Schema<INotification> = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    type: { type: String, enum: [...], required: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    read: { type: Boolean, default: false, index: true },
    createdAt: { type: Date, default: Date.now, index: true },
    expiresAt: { type: Date, default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
    // ... autres champs
  },
  {
    timestamps: true,  // ⚠️ Génère automatiquement createdAt et updatedAt
  },
);
```

**⚠️ Problème potentiel identifié** :

- Le schéma définit `createdAt` **manuellement** (ligne 143-145)
- Mais `timestamps: true` génère **aussi** `createdAt` automatiquement (ligne 156)
- **Conflit possible** : Mongoose peut créer deux champs `createdAt` différents

---

### 2. **Fonction createNotification** (`src/services/notificationService.ts`)

```typescript
export async function createNotification(
  userId: mongoose.Types.ObjectId,
  type: NotificationType,
  title: string,
  message: string,
  data?: {...}
): Promise<INotification> {
  const notification = new NotificationModel({
    userId,
    type,
    title,
    message,
    read: false,
    createdAt: new Date(),  // ⚠️ Défini manuellement
    // ...
  });

  await notification.save();  // ✓ Sauvegarde réussie

  // Envoi WebSocket/Push
  await NotificationService.sendNotificationToUser(...);

  return notification;
}
```

**Flux d'exécution** :

1. ✅ `new NotificationModel(...)` crée l'objet
2. ✅ `await notification.save()` persiste en DB
3. ✅ Log "Notification créée" s'affiche
4. ✅ WebSocket envoie la notification
5. ❌ **Mais** la requête `find()` ne la trouve pas

---

### 3. **Endpoint GET /api/notifications** (`src/controllers/notificationsControllers.ts`)

```typescript
export const getNotifications = async (req: Request, res: Response) => {
  const userId = (req as any).user?.id;

  // Supprimer les notifications expirées
  await NotificationModel.deleteMany({
    userId: new mongoose.Types.ObjectId(userId),
    expiresAt: { $lt: new Date() },
  });

  const [notifications, total, unreadCount] = await Promise.all([
    NotificationModel.find({ userId: new mongoose.Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(skip)
      .populate("senderId", "name surname")
      .lean(),
    NotificationModel.countDocuments({
      userId: new mongoose.Types.ObjectId(userId),
    }),
    NotificationModel.countDocuments({
      userId: new mongoose.Types.ObjectId(userId),
      read: false,
    }),
  ]);

  res.json({
    data: notifications,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    unreadCount,
  });
};
```

**Structure de réponse** :

```json
{
  "data": [], // notifications array
  "pagination": {
    "total": 0 // total count
  },
  "unreadCount": 1 // unread count
}
```

**⚠️ Problème** : Le log frontend montre `total: 0, notificationsCount: 0` mais l'API retourne `pagination.total`. Il y a une **transformation côté frontend** ou un **autre endpoint**.

---

## 🧪 Hypothèses Classées par Probabilité

### **Hypothèse 1 : Conflit `createdAt` et `timestamps: true`** (⚠️ HAUTE)

**Cause** :

- Le schéma définit `createdAt` manuellement ET active `timestamps: true`
- Mongoose peut créer un conflit entre les deux
- La requête `find().sort({ createdAt: -1 })` utilise peut-être le mauvais champ

**Test** :

```bash
npm run ts-node scripts/diagnose-notifications.ts
```

**Solution** :

```typescript
// OPTION A : Supprimer createdAt manuel, garder timestamps
const notificationSchema: Schema<INotification> = new Schema(
  {
    // ... autres champs (SANS createdAt)
  },
  {
    timestamps: true, // Génère createdAt et updatedAt automatiquement
  },
);

// OPTION B : Garder createdAt manuel, supprimer timestamps
const notificationSchema: Schema<INotification> = new Schema(
  {
    createdAt: { type: Date, default: Date.now, index: true },
    // ... autres champs
  },
  // PAS de timestamps: true
);
```

---

### **Hypothèse 2 : Index MongoDB corrompu** (⚠️ MOYENNE)

**Cause** :

- L'index `{ userId: 1, read: 1, createdAt: -1 }` est désynchronisé
- `countDocuments` utilise un index différent de `find()`
- Les deux retournent des résultats incohérents

**Test** :

```bash
npm run ts-node scripts/analyze-notifications.ts
```

**Solution** :

```bash
# Reconstruire les index MongoDB
mongosh "mongodb+srv://..." --eval "
  use QvarryStorage;
  db.notifications.reIndex();
"
```

---

### **Hypothèse 3 : Race Condition (timing)** (⚠️ FAIBLE)

**Cause** :

- Le frontend appelle l'API trop rapidement après la création
- MongoDB n'a pas encore répliqué la donnée (si cluster)
- `save()` retourne avant que l'index soit mis à jour

**Test** :
Le script de diagnostic vérifie immédiatement après `save()`

**Solution** :

```typescript
await notification.save();
await new Promise((resolve) => setTimeout(resolve, 100)); // Attendre 100ms
```

---

### **Hypothèse 4 : Filtre involontaire côté frontend** (⚠️ FAIBLE)

**Cause** :

- Le frontend transforme la réponse API
- Un filtre client exclut la notification
- Le log montre `notificationsCount: 0` qui n'existe pas dans l'API

**Test** :
Vérifier le code frontend (React) qui appelle `/api/notifications`

---

## 🛠️ Plan d'Action

### **Phase 1 : Diagnostic**

```bash
# 1. Analyser les notifications existantes
npm run ts-node scripts/analyze-notifications.ts

# 2. Tester la création + récupération
npm run ts-node scripts/diagnose-notifications.ts

# 3. Vérifier les index MongoDB
mongosh "mongodb+srv://..." --eval "
  use QvarryStorage;
  db.notifications.getIndexes();
"
```

### **Phase 2 : Correction (selon diagnostic)**

**Si Hypothèse 1 confirmée** :
→ Supprimer le conflit `createdAt` / `timestamps`

**Si Hypothèse 2 confirmée** :
→ Reconstruire les index MongoDB

**Si Hypothèse 3 confirmée** :
→ Ajouter un délai ou forcer un `await` supplémentaire

**Si Hypothèse 4 confirmée** :
→ Corriger le code frontend

### **Phase 3 : Tests**

1. Créer une notification de test via `/api/notifications/test`
2. Vérifier immédiatement via `/api/notifications`
3. Confirmer `unreadCount` == `notifications.length`
4. Valider dans le frontend (NotificationBell)

---

## 📝 Scripts Créés

1. **`scripts/diagnose-notifications.ts`**  
   → Test complet : création + vérification immédiate/différée

2. **`scripts/analyze-notifications.ts`**  
   → Analyse des données existantes + détection d'incohérences

---

## ✅ Prochaines Étapes

1. **Exécuter les scripts de diagnostic**
2. **Identifier l'hypothèse correcte**
3. **Appliquer la correction**
4. **Tester en environnement réel**
5. **Ajouter des tests unitaires** pour éviter la régression

---

**Voulez-vous que je lance les scripts de diagnostic maintenant ?**
