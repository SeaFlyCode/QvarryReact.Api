# 🔴 BUG FRONTEND : Incohérence Notifications

**Date** : 19 Mars 2026  
**Priorité** : HAUTE  
**Composant affecté** : `NotificationBell` (ou hook/service de notifications)

---

## 📋 Résumé du Problème

Le composant frontend affiche un badge de notification (`unreadCount: 1`) mais la liste reste vide (`notifications: []`).

**Log observé dans la console frontend** :

```javascript
[NotificationBell] ✅ API response:
Object {
  total: 0,
  unreadCount: 1,
  notificationsCount: 0,
  notifications: []
}
```

**Résultat** : Badge rouge "1" visible, mais aucune notification dans la liste déroulante.

---

## ✅ Tests Backend Effectués

Le backend API a été **entièrement testé et validé** :

| Test                          | Résultat              |
| ----------------------------- | --------------------- |
| Création de notification      | ✅ Succès             |
| Sauvegarde MongoDB            | ✅ Succès             |
| Récupération immédiate        | ✅ Succès             |
| Récupération différée         | ✅ Succès             |
| Requête par `_id`             | ✅ Succès             |
| Cohérence `count` vs `find()` | ✅ Succès             |
| Index MongoDB                 | ✅ 7 index OK         |
| Analyse de 39 notifications   | ✅ Aucune incohérence |

**Conclusion** : Le backend fonctionne **parfaitement**. Le bug est **côté frontend**.

---

## 🔍 Structure de Réponse API (Correcte)

### Endpoint : `GET /api/notifications`

**Headers requis** :

```http
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json
```

**Réponse réelle de l'API** :

```json
{
  "data": [
    {
      "_id": "69bbb0913f29a8986e9ab964",
      "userId": "697270fbc3b1bad900e59d33",
      "type": "contact_accepted",
      "title": "Demande de contact acceptée",
      "message": "John Doe a accepté votre demande",
      "read": false,
      "createdAt": "2026-03-18T21:12:32.000Z",
      "senderId": {
        "_id": "69b802e4253b2f35d36146ba",
        "name": "John",
        "surname": "Doe"
      }
    }
    // ... autres notifications
  ],
  "pagination": {
    "page": 1,
    "limit": 15,
    "total": 3,
    "totalPages": 1
  },
  "unreadCount": 1
}
```

**Structure garantie** :

- ✅ `data` : Array de notifications (peut être vide si aucune notification)
- ✅ `pagination.total` : Nombre total de notifications
- ✅ `pagination.page` : Page actuelle
- ✅ `pagination.limit` : Limite par page
- ✅ `pagination.totalPages` : Nombre total de pages
- ✅ `unreadCount` : Nombre de notifications non lues

---

## ❌ Structure Observée dans le Log Frontend (Incorrecte)

```javascript
{
  total: 0,                  // ❌ Devrait être pagination.total (3)
  unreadCount: 1,            // ✅ Correct
  notificationsCount: 0,     // ❌ Ce champ n'existe PAS dans l'API
  notifications: []          // ❌ Devrait être data (array non vide)
}
```

---

## 🐛 Cause Probable du Bug

### Hypothèse 1 : Mapping incorrect des données

Le code frontend transforme probablement la réponse API de manière incorrecte.

**Exemple de code bugué** :

```typescript
// ❌ INCORRECT
const response = await fetch("/api/notifications");
const json = await response.json();

const transformed = {
  total: json.total || 0, // ❌ json.total n'existe pas
  unreadCount: json.unreadCount, // ✅ Correct
  notificationsCount: json.notifications?.length || 0, // ❌ json.notifications n'existe pas
  notifications: json.notifications || [], // ❌ Devrait être json.data
};
```

**Code correct** :

```typescript
// ✅ CORRECT
const response = await fetch("/api/notifications");
const json = await response.json();

const notifications = json.data || []; // ✅ Utiliser json.data
const total = json.pagination?.total || 0; // ✅ Utiliser json.pagination.total
const unreadCount = json.unreadCount || 0; // ✅ Correct

// Utiliser directement ces valeurs
setState({
  notifications,
  total,
  unreadCount,
});
```

---

### Hypothèse 2 : Mauvais endpoint appelé

Vérifiez que le frontend appelle bien :

```
GET /api/notifications
```

Et **PAS** un autre endpoint comme :

- ❌ `/api/notifications/unread-count` (retourne seulement `{ unreadCount: 1 }`)
- ❌ Un endpoint custom qui n'existe pas

---

### Hypothèse 3 : État Redux/Context corrompu

Si vous utilisez Redux ou Context API, vérifiez que :

- Le reducer traite correctement `json.data` (pas `json.notifications`)
- Le state initial est cohérent
- Aucun autre action ne réinitialise `notifications` à `[]`

---

## 🛠️ Fichiers à Vérifier

Cherchez ces fichiers dans votre projet frontend :

### 1. Hook ou Service de Notifications

```bash
# Cherchez ces noms de fichiers
src/hooks/useNotifications.ts
src/hooks/useNotifications.tsx
src/services/notificationService.ts
src/services/api/notifications.ts
src/api/notifications.ts
```

**Ce qu'il faut vérifier** :

- La requête fetch/axios vers `/api/notifications`
- Le mapping de la réponse (`json.data` vs `json.notifications`)
- La structure retournée par le hook

---

### 2. Composant NotificationBell

```bash
# Cherchez ces noms de fichiers
src/components/NotificationBell.tsx
src/components/Notifications/NotificationBell.tsx
src/components/Header/NotificationBell.tsx
```

**Ce qu'il faut vérifier** :

- Comment les données sont reçues du hook/service
- L'affichage du badge (`unreadCount`)
- L'affichage de la liste (`notifications.map(...)`)
- Le log console qui affiche la structure incorrecte

---

### 3. Store Redux (si utilisé)

```bash
# Cherchez ces fichiers
src/store/notifications/notificationsSlice.ts
src/redux/notifications/reducer.ts
src/store/slices/notificationsSlice.ts
```

**Ce qu'il faut vérifier** :

- L'action qui fetch les notifications
- Le reducer qui traite la réponse
- La transformation des données dans le reducer

---

## ✅ Solution Recommandée

### Étape 1 : Localiser le code responsable

Cherchez dans votre codebase :

```bash
# Chercher où l'API est appelée
grep -r "/api/notifications" src/

# Chercher le log qui affiche la structure incorrecte
grep -r "API response" src/
grep -r "NotificationBell" src/
```

---

### Étape 2 : Corriger le mapping

**Avant (bugué)** :

```typescript
const { total, notifications, unreadCount } = await response.json();
```

**Après (correct)** :

```typescript
const { data, pagination, unreadCount } = await response.json();
const notifications = data || [];
const total = pagination?.total || 0;
```

---

### Étape 3 : Vérifier tous les usages

Cherchez tous les endroits où vous utilisez :

- `response.notifications` → Remplacer par `response.data`
- `response.total` → Remplacer par `response.pagination.total`
- `response.notificationsCount` → **Supprimer** (ce champ n'existe pas dans l'API)

---

## 🧪 Test de Validation

### 1. Tester l'API directement

Dans la console du navigateur (avec un token valide) :

```javascript
fetch("/api/notifications", {
  headers: {
    Authorization: "Bearer " + document.cookie.match(/token=([^;]+)/)[1],
    "Content-Type": "application/json",
  },
})
  .then((r) => r.json())
  .then((data) => {
    console.log("Structure API réelle:", data);
    console.log("Notifications:", data.data);
    console.log("Total:", data.pagination.total);
    console.log("Non lues:", data.unreadCount);
  });
```

**Résultat attendu** :

```javascript
Structure API réelle: { data: [...], pagination: {...}, unreadCount: 1 }
Notifications: [{ _id: "...", title: "...", ... }]
Total: 3
Non lues: 1
```

---

### 2. Créer une notification de test

**Endpoint de test (dev uniquement)** :

```http
POST /api/notifications/test
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json

{
  "type": "share_received",
  "title": "Test notification",
  "message": "Ceci est un test"
}
```

**Commande curl** :

```bash
curl -X POST "http://localhost:3000/api/notifications/test" \
  -H "Authorization: Bearer VOTRE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "admin_notification",
    "title": "Test Frontend",
    "message": "Vérification du mapping frontend"
  }'
```

Ensuite, vérifiez que :

1. ✅ Le badge affiche `unreadCount: 2` (ou +1)
2. ✅ La liste affiche la nouvelle notification
3. ✅ Le log console affiche la bonne structure

---

## 📞 Support Backend

**Confirmation backend** :

- ✅ L'API `/api/notifications` fonctionne correctement
- ✅ Les notifications sont créées et persistées en base
- ✅ La structure de réponse est garantie et documentée ci-dessus
- ✅ Scripts de diagnostic disponibles dans `QvarryReact.Api/scripts/`

**Contact** : Si le problème persiste après correction du frontend, vérifier :

- Les headers de la requête (Authorization)
- Le format du token JWT
- Les CORS si frontend et backend sont sur des domaines différents

---

## 📎 Annexes

### Exemple de Hook Correct

```typescript
// src/hooks/useNotifications.ts
import { useState, useEffect } from "react";

interface Notification {
  _id: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
  senderId?: {
    _id: string;
    name: string;
    surname: string;
  };
}

interface UseNotificationsReturn {
  notifications: Notification[];
  unreadCount: number;
  total: number;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useNotifications(): UseNotificationsReturn {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchNotifications = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/notifications", {
        headers: {
          Authorization: `Bearer ${getToken()}`, // Fonction qui récupère le token
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const json = await response.json();

      // ✅ MAPPING CORRECT
      setNotifications(json.data || []);
      setTotal(json.pagination?.total || 0);
      setUnreadCount(json.unreadCount || 0);

      console.log("[useNotifications] ✅ Données reçues:", {
        notifications: json.data?.length || 0,
        total: json.pagination?.total || 0,
        unreadCount: json.unreadCount || 0,
      });
    } catch (err) {
      console.error("[useNotifications] ❌ Erreur:", err);
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNotifications();
  }, []);

  return {
    notifications,
    unreadCount,
    total,
    loading,
    error,
    refresh: fetchNotifications,
  };
}
```

---

### Exemple de Composant NotificationBell Correct

```typescript
// src/components/NotificationBell.tsx
import React from 'react';
import { useNotifications } from '../hooks/useNotifications';

export function NotificationBell() {
  const { notifications, unreadCount, total, loading, refresh } = useNotifications();

  return (
    <div className="notification-bell">
      {/* Badge */}
      <button onClick={refresh}>
        🔔
        {unreadCount > 0 && (
          <span className="badge">{unreadCount}</span>
        )}
      </button>

      {/* Liste déroulante */}
      <div className="notification-dropdown">
        <p>Notifications ({total})</p>

        {loading && <p>Chargement...</p>}

        {!loading && notifications.length === 0 && (
          <p>Aucune notification</p>
        )}

        {!loading && notifications.length > 0 && (
          <ul>
            {notifications.map(notif => (
              <li key={notif._id} className={notif.read ? 'read' : 'unread'}>
                <strong>{notif.title}</strong>
                <p>{notif.message}</p>
                <small>{new Date(notif.createdAt).toLocaleString()}</small>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
```

---

## ✅ Checklist de Résolution

- [ ] Identifier le fichier qui appelle `/api/notifications`
- [ ] Vérifier que la requête utilise `Authorization: Bearer <token>`
- [ ] Remplacer `json.notifications` par `json.data`
- [ ] Remplacer `json.total` par `json.pagination.total`
- [ ] Supprimer les références à `json.notificationsCount` (n'existe pas)
- [ ] Tester avec l'endpoint `/api/notifications/test` (dev)
- [ ] Vérifier que le badge ET la liste affichent les données
- [ ] Supprimer les logs de debug après correction

---

**Bonne chance pour la correction ! 🚀**

Si après correction le problème persiste, contactez l'équipe backend avec :

- Le code du composant/hook modifié
- Les logs console complets
- La réponse brute de l'API (Network tab de DevTools)
