-- ============================================================
-- Schema for the hosted database (Supabase / any Postgres).
--
-- Run once, in the Supabase dashboard: SQL Editor → New query →
-- paste → Run.
--
-- Why a database at all: free hosting has an ephemeral disk. Without
-- this, every redeploy and every idle sleep deletes all accounts and
-- all snapshots, and testers have to start over.
-- ============================================================

-- Published stats. One row per sync, so history is kept and
-- progression can be charted later.
create table if not exists snapshots (
  id          bigserial primary key,
  handle      text        not null,
  captured_at timestamptz not null default now(),
  snapshot    jsonb       not null
);

-- Looking up one pirate is the hot path; the index makes it cheap and
-- is case-insensitive because gamertags are compared that way.
create index if not exists snapshots_handle_idx
  on snapshots (lower(handle), captured_at);

-- Who may publish under which name.
-- id is the SHA-256 of the extension's account key: the key itself is
-- never stored, so this table cannot be used to impersonate anyone.
create table if not exists accounts (
  id         text primary key,
  handle     text not null,
  "createdAt" timestamptz not null default now(),
  "lastSync"  timestamptz,
  syncs      integer not null default 0
);

create unique index if not exists accounts_handle_idx
  on accounts (lower(handle));

-- ------------------------------------------------------------
-- Row Level Security.
--
-- The API talks to Postgres with the SERVICE key, which bypasses RLS —
-- all authorisation happens in server/accounts.js, where the account
-- key is checked. RLS is still enabled so that if the anon key ever
-- leaks, or someone points a browser at the REST endpoint, they get
-- nothing rather than the whole table.
-- ------------------------------------------------------------
alter table snapshots enable row level security;
alter table accounts  enable row level security;

-- No policies are created on purpose: with RLS on and no policy, every
-- non-service request is denied. Do not add a permissive policy unless
-- you intend the table to be world-readable.
