# 🎫 TICKET : Bug Mapping Notifications Frontend

**Priorité** : 🔴 HAUTE  
**Type** : Bug  
**Composant** : NotificationBell / useNotifications  
**Équipe** : Frontend

---

## 🐛 Problème

Badge de notification affiché (`unreadCount: 1`) mais liste vide (`notifications: []`).

---

## ✅ Tests Backend

Le backend a été **entièrement validé** :

- ✅ API `/api/notifications` fonctionne
- ✅ Notifications créées et récupérées correctement
- ✅ Aucune incohérence en base de données

**Le bug est côté frontend** (mapping incorrect des données API).

---

## 📦 Structure API (Correcte)

```json
{
  "data": [
    /* notifications */
  ],
  "pagination": {
    "total": 3,
    "page": 1,
    "limit": 15
  },
  "unreadCount": 1
}
```

---

## ❌ Structure Observée (Incorrecte)

```javascript
{
  total: 0,               // ❌ Devrait être pagination.total
  notificationsCount: 0,  // ❌ N'existe pas dans l'API
  notifications: []       // ❌ Devrait être data
}
```

---

## 🔧 Correction à Apporter

**Avant (bugué)** :

```typescript
const { notifications, total } = await response.json();
```

**Après (correct)** :

```typescript
const { data, pagination, unreadCount } = await response.json();
const notifications = data || [];
const total = pagination?.total || 0;
```

---

## 📂 Fichiers à Vérifier

- `src/hooks/useNotifications.ts` (ou similaire)
- `src/components/NotificationBell.tsx`
- `src/store/notifications/*` (si Redux)

Chercher :

```bash
grep -r "notifications.*response" src/
grep -r "/api/notifications" src/
```

---

## 📎 Documentation Complète

👉 **Voir** : `FRONTEND_BUG_NOTIFICATIONS.md` pour :

- Structure détaillée de l'API
- Exemples de code correct
- Tests de validation
- Hook React complet

---

## ✅ Définition de Done

- [ ] Remplacer `json.notifications` par `json.data`
- [ ] Remplacer `json.total` par `json.pagination.total`
- [ ] Tester avec `/api/notifications/test` (POST)
- [ ] Badge ET liste affichent les bonnes données
- [ ] Aucune incohérence dans les logs
