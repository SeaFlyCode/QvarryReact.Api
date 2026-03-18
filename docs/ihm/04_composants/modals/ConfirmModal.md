# Composant `ConfirmModal`

## Localisation

```
src/components/modals/ConfirmModal.tsx
```

---

## Vue d'ensemble

Modal de confirmation rendu par `ConfirmModalProvider`. Affiche un titre, un message optionnel, et deux boutons (confirmer / annuler). Le bouton annuler peut être masqué en mode `forceConfirmOnly`.

---

## Interface / Props

```ts
interface ConfirmModalProps {
  isOpen:          boolean;
  title:           string;
  message?:        string;
  confirmText?:    string;           // Défaut: "Confirmer"
  cancelText?:     string;           // Défaut: "Annuler"
  variant?:        'default' | 'danger' | 'warning';
  onConfirm:       () => void;
  onCancel:        () => void;
  forceConfirmOnly?: boolean;        // Masque le bouton annuler
}
```

---

## Variants visuels

| Variant | Couleur bouton confirm | Usage |
|---------|----------------------|-------|
| `default` | Vert (`bg-green-600`) | Actions neutres |
| `danger` | Rouge (`bg-red-600`) | Suppressions, blocages |
| `warning` | Orange (`bg-orange-500`) | Actions risquées |

---

## Mode `forceConfirmOnly`

```tsx
{!forceConfirmOnly && (
  <button
    onClick={onCancel}
    className="btn-secondary"
  >
    {cancelText || 'Annuler'}
  </button>
)}
```

Déclenché quand `confirmText === 'Se reconnecter'` (session expirée).

---

## Fermeture par backdrop

```tsx
<div
  className="modal-backdrop"
  onClick={forceConfirmOnly ? undefined : onCancel}
  // En mode forceConfirmOnly : clic backdrop ignoré
/>
```

---

## Accessibilité

- `role="dialog"`, `aria-modal="true"`
- `aria-labelledby` lié au titre
- Focus piégé dans la modal (focus trap)
- `Escape` ferme la modal (sauf `forceConfirmOnly`)

---

## Extrait de code clé

```tsx
export default function ConfirmModal({
  isOpen, title, message, confirmText, cancelText,
  variant = 'default', onConfirm, onCancel, forceConfirmOnly = false
}: ConfirmModalProps) {
  if (!isOpen) return null;

  const confirmButtonClass = {
    default: 'bg-green-600 hover:bg-green-700',
    danger:  'bg-red-600 hover:bg-red-700',
    warning: 'bg-orange-500 hover:bg-orange-600',
  }[variant];

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal-content">
        <h2>{title}</h2>
        {message && <p>{message}</p>}
        <div className="modal-actions">
          {!forceConfirmOnly && (
            <button onClick={onCancel}>{cancelText || 'Annuler'}</button>
          )}
          <button onClick={onConfirm} className={confirmButtonClass}>
            {confirmText || 'Confirmer'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

---

## Note

Ce composant est rendu par `ConfirmModalProvider` et n'est **jamais instancié directement** dans les pages/composants. L'accès se fait via `useConfirm()` ou `window.showGlobalConfirmModal()`.
