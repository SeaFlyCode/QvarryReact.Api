# Composant `ConfirmModalProvider` + `showConfirm()`

## Localisation

```
src/components/modals/ConfirmModalProvider.tsx
```

---

## Vue d'ensemble

Provider qui expose une fonction `showConfirm()` retournant une `Promise<boolean>`. La confirmation est asynchrone et peut être attendue avec `await`. Expose également la fonction globalement via `window.showGlobalConfirmModal` pour les contextes hors React.

---

## Interface / Props

```ts
// Provider
interface ConfirmModalProviderProps {
  children: React.ReactNode;
}

// Options passées à showConfirm()
interface ConfirmOptions {
  title:            string;
  message?:         string;
  confirmText?:     string;   // Défaut: "Confirmer"
  cancelText?:      string;   // Défaut: "Annuler"
  variant?:         'default' | 'danger' | 'warning';
}
```

---

## États internes

| État | Type | Rôle |
|------|------|------|
| `isOpen` | `boolean` | Modal visible |
| `options` | `ConfirmOptions \| null` | Options de la modale courante |
| `resolve` | `((value: boolean) => void) \| null` | Résolveur de la Promise en attente |

---

## Pattern Promise

```ts
const showConfirm = (options: ConfirmOptions): Promise<boolean> => {
  return new Promise((resolve) => {
    setOptions(options);
    setResolve(() => resolve); // Stocke le résolveur
    setIsOpen(true);
  });
};

const handleConfirm = () => {
  setIsOpen(false);
  resolve?.(true);
};

const handleCancel = () => {
  setIsOpen(false);
  resolve?.(false);
};
```

---

## Exposition globale

```ts
useEffect(() => {
  window.showGlobalConfirmModal = showConfirm;
  return () => {
    delete window.showGlobalConfirmModal;
  };
}, []);
```

Permet d'utiliser `showConfirm()` depuis n'importe quel module sans injection de contexte :

```ts
// Dans un module API ou utilitaire
await window.showGlobalConfirmModal?.({
  title: 'Session expirée',
  message: 'Votre session a expiré. Voulez-vous vous reconnecter ?',
  confirmText: 'Se reconnecter',
});
```

---

## Mode `forceConfirmOnly`

Quand `confirmText === 'Se reconnecter'`, le bouton "Annuler" est masqué :

```tsx
const forceConfirmOnly = options?.confirmText === 'Se reconnecter';

{!forceConfirmOnly && (
  <button onClick={handleCancel}>{options.cancelText || 'Annuler'}</button>
)}
```

Ce cas est utilisé lors de l'expiration de session pour obliger l'utilisateur à se reconnecter.

---

## Contexte exposé

```ts
interface ConfirmModalContextType {
  showConfirm: (options: ConfirmOptions) => Promise<boolean>;
}

export const ConfirmModalContext = createContext<ConfirmModalContextType>({
  showConfirm: async () => false
});

export const useConfirm = () => useContext(ConfirmModalContext);
```

---

## Utilisation typique

### Depuis un composant React

```tsx
const { showConfirm } = useConfirm();

const handleDelete = async () => {
  const confirmed = await showConfirm({
    title: 'Supprimer ce point ?',
    message: 'Cette action est irréversible.',
    confirmText: 'Supprimer',
    variant: 'danger'
  });
  if (confirmed) await deletePoint(id);
};
```

### Depuis l'extérieur de React (ex: module API)

```ts
const confirmed = await window.showGlobalConfirmModal?.({
  title: 'Session expirée',
  confirmText: 'Se reconnecter',
});
```
