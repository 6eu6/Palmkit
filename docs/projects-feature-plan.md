# Projects — design plan

Status: **proposed, not built.** The "Move to project" item exists in the
conversation menu, disabled and marked *Soon*, so the menu already has its
final shape. This document is what has to be agreed before it is wired up.

---

## 1. What a project is

A **project** is a named container that groups conversations that belong to
the same piece of work — "Palmkit landing page", "Client X app", "Thesis".

It is a *grouping*, not a new kind of conversation. Every conversation still
belongs to exactly one tab (`mode`: chat / work / code). A project sits on
top of that.

### Projects are cross-tab

This is the central decision, and the recommendation is that a project spans
all three tabs.

Real work does not respect the tab split. Building "Client X app" means code
sessions in **Code**, questions about the stack in **Chat**, and a proposal
document in **Work**. Forcing the user to create three separate projects for
one job would make the feature busywork.

So:

- `mode` answers *what kind of conversation is this?*
- `folder_id` answers *what work does it belong to?*

They are independent. A project acts as a **filter layered on top of the tab
filter**, never a replacement for it.

### What the user sees

- Sidebar, **not** in a project: the list behaves exactly as it does today —
  conversations for the current tab.
- Sidebar, **inside** a project: the Chat/Work/Code tabs still work, but the
  list is narrowed to that project's conversations for the current tab.
  A header strip shows the project name and a way back out.

Nothing about the current behaviour changes for users who never make a
project.

---

## 2. Naming warning

The Supabase table already called `projects` **stores conversations**, not
projects — one row per chat, keyed by `url_id`. It is the account-side mirror
of the local `chats` store.

Calling the new entity `projects` in the database would be a lasting source
of confusion. Use **`folders`** as the internal/table name and show
"Projects" in the UI. This document uses `folders` for anything schema-level
and "project" for anything the user sees.

---

## 3. Data model

### Supabase — migration `0015_folders.sql`

```sql
create table if not exists public.folders (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 60),
  color       text,                       -- optional accent, for the sidebar dot
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists folders_user_idx on public.folders (user_id, updated_at desc);

alter table public.folders enable row level security;

create policy "own folders" on public.folders
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- The link. ON DELETE SET NULL is deliberate: deleting a project must never
-- delete the conversations inside it (see §6).
alter table public.projects
  add column if not exists folder_id uuid references public.folders(id) on delete set null;

create index if not exists projects_user_folder_idx
  on public.projects (user_id, folder_id, mode, pinned desc, updated_at desc);
```

### IndexedDB

`openDatabase()` goes to **version 4**:

- new object store `folders`, keyPath `id`
- chat records gain `folderId?: string`

Same rules the existing fields already follow:

- `setMessages` must carry `folderId` forward explicitly — `put` replaces the
  whole record, so an unlisted field is silently dropped (this is exactly how
  `pinned` would have been lost).
- The sync-down path (`seedChatFromAccount`, `syncAllFromAccount`) must
  restore `folder_id`, and folders themselves must be pulled **before** the
  conversations that reference them.

### Client types

```ts
export interface Folder {
  id: string;
  name: string;
  color?: string;
  createdAt: string;
  updatedAt: string;
}

// on ChatHistoryItem
folderId?: string;
```

---

## 4. API

New route `app/routes/api.account.folders.ts`, mirroring the shape of
`api.account.projects.ts`:

| Method | Path | Does |
|---|---|---|
| `GET` | `/api/account/folders` | list the user's folders |
| `POST` | `/api/account/folders` | create / rename (`{id?, name, color?}`) |
| `DELETE` | `/api/account/folders?id=` | delete the folder; rows keep their conversations |

`api.account.projects.ts` extends to carry `folder_id` in select and upsert —
and must extend the existing `isMissingNewColumn` fallback to cover it, so a
database that has not run `0015` yet keeps syncing instead of failing every
read and write. That guard has already earned its keep twice (`mode`,
`pinned`); do not skip it.

`accountSync.ts` gains `pushFolder`, `deleteFolder`, `listFolders`, and
carries `folderId` in the conversation payload.

---

## 5. UI

### Sidebar — a Projects section above the conversation list

```
┌─────────────────────────────┐
│  Chat  │  Work  │  Code     │   ← unchanged
├─────────────────────────────┤
│  + New Chat                 │
│  Context · My Builds · …    │
├─────────────────────────────┤
│  PROJECTS            + New  │   ← new
│   ● Client X app        12  │
│   ● Landing page         4  │
│   ● Thesis               7  │
├─────────────────────────────┤
│  YOUR CHATS                 │   ← unchanged, filtered by tab
│   📌 Pinned                 │
│   Today …                   │
└─────────────────────────────┘
```

The count is that project's conversations **in the current tab**, so it
agrees with what clicking it shows.

Clicking a project enters project scope: the "Your chats" list narrows to it
and a header strip appears with the project name, a ⋯ menu (Rename, Change
colour, Delete) and a way back to everything. Same section, same rows, same
per-conversation menu — only the filter changes. On mobile this is the same
strip inside the drawer.

### "Move to project" in the conversation menu

Becomes a submenu:

```
Move to project  ▸   ┌──────────────────┐
                     │ ○ No project     │
                     │ ● Client X app   │
                     │ ○ Landing page   │
                     │ ──────────────── │
                     │ + New project…   │
                     └──────────────────┘
```

"New project…" opens a small dialog, creates the folder and moves the
conversation in one step.

### Routing

Project scope is a URL, so it survives reload and can be shared between the
user's own devices:

```
/chat?project=<folderId>
/code/<chatId>?project=<folderId>
```

A query parameter rather than a path segment, so the existing
`/{mode}/{id}` routes and the `pathHasChatId` logic in `useChatHistory` are
untouched — that teardown is load-bearing and should not be disturbed for a
cosmetic URL.

---

## 6. Rules worth deciding up front

1. **Deleting a project never deletes conversations.** They return to the
   ungrouped list (`folder_id → null`). Destroying a dozen conversations
   behind one "Delete project" tap is not recoverable, and the local delete
   path already tears down snapshots, sandboxes and account rows. If
   "delete conversations too" is wanted later, it should be a separate,
   explicitly-worded action.
2. **A conversation belongs to at most one project.** Multi-membership needs
   a join table and buys little here.
3. **Projects are cross-tab; the tab filter still applies.** Never show a
   Work conversation in the Code tab because they share a project.
4. **Pinning stays per-conversation** and applies inside whatever list the
   conversation is shown in.
5. **A project is not a build target.** It does not own an E2B sandbox or a
   deployment; those stay attached to the conversation that created them.

---

## 7. Phases

**Phase 1 — grouping (the feature as asked for)**
Migration 0015, folders CRUD API, IndexedDB v4, sidebar Projects section,
"Move to project" submenu, project scope filtering. At the end of this phase
"Move to project" stops being *Soon*.

**Phase 2 — project scope polish**
Per-project conversation counts, colours, reordering, drag-a-conversation-
onto-a-project, project-scoped search.

**Phase 3 — shared project context (the real payoff)**
A project carries files and standing instructions that every conversation in
it inherits — so "Client X app" already knows the stack, the brand and the
API shape without being told again in each new chat.

This is where the feature stops being folders and starts being useful, and it
connects directly to the **Context** quick action already in the sidebar and
to the memory system in `0012_memory_system.sql`. Worth designing Phase 1's
schema with it in mind (hence `folders` owning rows of its own rather than
being a plain text label on a conversation), but not worth building until
Phase 1 is in use.

---

## 8. Estimate

| Phase | Scope | Rough size |
|---|---|---|
| 1 | schema + API + sync + sidebar + move-to-project | ~1 focused session |
| 2 | polish, drag & drop, counts, search | ~half a session |
| 3 | shared context / instructions per project | needs its own design pass |
