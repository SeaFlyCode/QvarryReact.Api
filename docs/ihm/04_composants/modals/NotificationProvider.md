# Composant `NotificationProvider`

## Localisation

```
src/components/modals/NotificationProvider.tsx
```

---

## Vue d'ensemble

Provider de notifications toast. Permet d'afficher plusieurs notifications simultanément, chacune avec sa propre durée de vie et son type. Les notifications coexistent en pile (stack) grâce à un ID auto-incrémenté.

---

## Interface / Props

```ts
interface NotificationProviderProps {
  children: React.ReactNode;
}

// Options d'une notification
interface NotificationOptions {
  type?:      'success' | 'error' | 'warning' | 'info';  // Défaut: 'info'
  duration?:  number;   // ms avant fermeture automatique. Défaut: 5000
  autoClose?: boolean;  // Défaut: true
}

// Notification dans le stack
interface Notification extends NotificationOptions {
  id:      number;
  message: string;
}
```

---

## États internes

| État | Type | Rôle |
|------|------|------|
| `notifications` | `Notification[]` | Stack de notifications actives |
| `nextId` | `number` | Compteur auto-incrémenté pour les IDs |

---

## Coexistence simultanée

Plusieurs notifications peuvent être visibles en même temps. Chaque appel à `addNotification()` crée une nouvelle entrée avec un ID unique :

```ts
let nextId = 0;

const addNotification = (message: string, options: NotificationOptions = {}) => {
  const id = ++nextId;
  setNotifications(prev => [...prev, { id, message, ...options }]);

  if (options.autoClose !== false) {
    setTimeout(() => removeNotification(id), options.duration ?? 5000);
  }
};
```

---

## Fermeture d'une notification

```ts
const removeNotification = (id: number) => {
  setNotifications(prev => prev.filter(n => n.id !== id));
};
```

---

## Contexte exposé

```ts
interface NotificationContextType {
  addNotification:    (message: string, options?: NotificationOptions) => void;
  removeNotification: (id: number) => void;
}

export const useNotification = () => useContext(NotificationContext);
```

---

## Rendu du stack

```tsx
<NotificationContext.Provider value={{ addNotification, removeNotification }}>
  {children}
  <div className="notification-stack fixed bottom-4 right-4 flex flex-col gap-2 z-50">
    {notifications.map(n => (
      <NotificationToast
        key={n.id}
        notification={n}
        onClose={() => removeNotification(n.id)}
      />
    ))}
  </div>
</NotificationContext.Provider>
```

---

## Utilisation typique

```tsx
// Provider dans le layout
<NotificationProvider>
  <App />
</NotificationProvider>

// Utilisation dans un composant
const { addNotification } = useNotification();

addNotification('Point créé avec succès !', { type: 'success' });
addNotification('Erreur réseau', { type: 'error', duration: 8000 });
addNotification('Import terminé', { type: 'info', autoClose: false }); // Manuel
```
