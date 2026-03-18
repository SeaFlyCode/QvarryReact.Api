# Page Messaging (Layout contrôleur)

## Vue d'ensemble

Le système de messagerie repose sur une architecture inhabituelle : le **layout** `(messaging)/layout.tsx` est le vrai contrôleur applicatif. Les pages `/contacts` et `/conversations` sont de simples stubs de redirection. Les deux vues (contacts et conversations) sont **toujours montées simultanément** et basculées par CSS (`hidden` / affichage normal).

---

## Routes & fichiers source

| Route | Fichier | Rôle |
|-------|---------|------|
| `/contacts` | `src/app/(messaging)/contacts/page.tsx` | Stub — redirige vers le layout |
| `/conversations` | `src/app/(messaging)/conversations/page.tsx` | Stub — redirige vers le layout |
| *(layout)* | `src/app/(messaging)/layout.tsx` | **Contrôleur réel** — contient toute la logique |

---

## Architecture "double-mount"

```
<MessagingLayout>
  ├─ <ContactsView>     ← toujours monté, visible si activeTab === 'contacts'
  └─ <ConversationsView> ← toujours monté, visible si activeTab === 'conversations'
</MessagingLayout>
```

Le basculement se fait via une classe CSS `hidden` (Tailwind) plutôt que par un démontage/remontage :

```tsx
<div className={activeTab === 'contacts' ? '' : 'hidden'}>
  <ContactsView ... />
</div>
<div className={activeTab === 'conversations' ? '' : 'hidden'}>
  <ConversationsView ... />
</div>
```

**Avantage** : les deux vues maintiennent leur état (scroll, données chargées) sans rechargement lors du basculement d'onglet.

---

## États internes (layout)

| État | Type | Rôle |
|------|------|------|
| `activeTab` | `'contacts' \| 'conversations'` | Vue actuellement visible |
| `contacts` | `Contact[]` | Liste des contacts chargés |
| `conversations` | `Conversation[]` | Liste des conversations |
| `selectedConversationId` | `string \| null` | Conversation ouverte |
| `isLoadingContacts` | `boolean` | Chargement des contacts |
| `isLoadingConversations` | `boolean` | Chargement des conversations |
| `unreadCount` | `number` | Nombre de messages non lus (badge) |

---

## Appels API

| Fonction | Module | Moment |
|----------|--------|--------|
| `getContacts()` | `src/api/contacts.ts` | Au montage |
| `getConversations()` | `src/api/conversations.ts` | Au montage |
| `markAsRead(id)` | `src/api/conversations.ts` | À l'ouverture d'une conversation |

---

## WebSocket

Le layout s'abonne au WebSocket pour recevoir les nouveaux messages en temps réel :

```ts
const ws = connectWebSocket();
ws.on('new_message', (msg) => {
  // Mise à jour optimiste de la conversation concernée
  // Incrément du unreadCount si pas la conversation active
});
```

---

## Comportements spéciaux

### Stubs de redirection
Les pages `/contacts/page.tsx` et `/conversations/page.tsx` ne rendent rien de significatif — elles existent uniquement pour satisfaire le routage Next.js. La logique d'affichage est entièrement dans le layout.

### Synchronisation de l'URL
Lorsque `activeTab` change, le layout peut ou non mettre à jour l'URL avec `router.replace()` pour refléter la vue active sans ajouter d'entrée dans l'historique.

### Badge de messages non lus
Le `unreadCount` est calculé côté client à partir des conversations dont `lastMessage.readAt === null`.

---

## Composants enfants

| Composant | Rôle |
|-----------|------|
| `<ContactList>` | Liste des contacts avec recherche |
| `<ConversationList>` | Liste des conversations avec aperçu |
| `<ConversationThread>` | Fil de messages d'une conversation ouverte |
| `<MessageInput>` | Zone de saisie et envoi de message |

---

## Extrait de code clé

```tsx
// Layout — les deux vues toujours montées
export default function MessagingLayout({ children }: { children: React.ReactNode }) {
  const [activeTab, setActiveTab] = useState<'contacts' | 'conversations'>('conversations');

  return (
    <div className="flex h-screen">
      <div className={activeTab === 'contacts' ? 'flex-1' : 'hidden'}>
        <ContactsView onSelectContact={handleSelectContact} />
      </div>
      <div className={activeTab === 'conversations' ? 'flex-1' : 'hidden'}>
        <ConversationsView selectedId={selectedConversationId} />
      </div>
      <TabBar active={activeTab} onChange={setActiveTab} />
    </div>
  );
}
```
