# SoT Tracker — Couche de collecte de données

> Document de conception. À valider avant implémentation.

---

## 1. Principe directeur

Rare ne sert **que les données du compte authentifié**. Il n'existe aucun moyen de demander
« les stats du joueur X ». Toute l'architecture découle de là :

| | Source | Portée | Sans inscription ? |
|---|---|---|---|
| **S1** | API interne Rare | Profil complet | ❌ Non — jeton du joueur requis |
| **S2** | Steam Web API | Heures + succès | ✅ Oui, si profil public |
| **S3** | Xbox Live (OpenXBL) | Heures + succès + gamerscore | ✅ Oui, selon confidentialité |
| **C4** | Calculé chez nous | Deltas, sessions, classements | — dérivé des snapshots |

**Conséquence produit :** un profil non inscrit est *dégradé mais pas vide* (heures + succès).
Un profil inscrit est complet. Le front doit gérer les deux sans branche spéciale → d'où le
snapshot normalisé avec des `null` (§3).

---

## 2. Schéma de base de données (PostgreSQL / Supabase)

### 2.1 Types

```sql
CREATE TYPE provider      AS ENUM ('rare', 'steam', 'xbox');
CREATE TYPE account_status AS ENUM ('active', 'needs_reauth', 'revoked', 'error');
CREATE TYPE sync_status   AS ENUM ('ok', 'no_change', 'rate_limited',
                                   'auth_expired', 'provider_error', 'skipped');
```

### 2.2 Comptes du tracker

```sql
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         citext UNIQUE NOT NULL,
  display_name  text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz              -- soft delete, purge par le worker
);
```

### 2.3 Joueurs suivis

Un `player` peut exister **sans** `user` : c'est le cas d'un profil suivi uniquement via
Steam/Xbox public. Le rattachement à un compte arrive si le joueur s'inscrit.

```sql
CREATE TABLE players (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid REFERENCES users(id) ON DELETE SET NULL,
  slug           citext UNIQUE NOT NULL,   -- /profile/<slug>
  pirate_name    text,                     -- connu seulement via S1
  is_public      boolean NOT NULL DEFAULT true,  -- apparaît dans les classements
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  last_synced_at timestamptz,
  next_sync_at   timestamptz NOT NULL DEFAULT now(), -- pilote la file du worker
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX players_sync_queue_idx ON players (next_sync_at)
  WHERE user_id IS NOT NULL OR is_public;
```

### 2.4 Identités externes

```sql
CREATE TABLE linked_accounts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id       uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  provider        provider NOT NULL,
  external_id     text NOT NULL,          -- steamid64 / xuid / id compte Rare
  handle          text,                   -- persona / gamertag / nom de pirate
  status          account_status NOT NULL DEFAULT 'active',
  last_ok_at      timestamptz,
  last_error_at   timestamptz,
  last_error_code text,
  consecutive_failures int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, external_id)
);
```

### 2.5 Jetons chiffrés — table isolée

**Décision de conception :** les secrets vivent dans leur **propre table**, jamais dans
`linked_accounts`. Le rôle SQL de l'API n'a **aucun `GRANT SELECT`** dessus ; seul le rôle du
worker y accède. Ainsi une faille dans l'API ne peut pas exfiltrer de jeton, même via une
requête mal filtrée.

```sql
CREATE TABLE credentials (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  linked_account_id uuid NOT NULL UNIQUE
                    REFERENCES linked_accounts(id) ON DELETE CASCADE,
  ciphertext        bytea NOT NULL,   -- AES-256-GCM
  iv                bytea NOT NULL,
  auth_tag          bytea NOT NULL,
  key_version       smallint NOT NULL DEFAULT 1,  -- permet la rotation de clé
  expires_at        timestamptz,      -- estimation, sert au pré-avertissement
  created_at        timestamptz NOT NULL DEFAULT now(),
  rotated_at        timestamptz
);

REVOKE ALL ON credentials FROM api_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON credentials TO worker_role;
```

### 2.6 Snapshots — cœur append-only

On **n'écrase jamais**. Modèle hybride : colonnes typées pour ce qu'on classe et trace en
courbe (rapide en SQL), `payload` jsonb pour le reste (survit aux changements d'API Rare).

```sql
CREATE TABLE snapshots (
  id            bigserial PRIMARY KEY,
  player_id     uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  source        provider NOT NULL,
  captured_at   timestamptz NOT NULL DEFAULT now(),
  content_hash  bytea NOT NULL,   -- dédoublonnage : pas d'insert si identique au précédent

  -- colonnes chaudes (classements + graphiques)
  gold               bigint,
  doubloons          bigint,
  ancient_coins      bigint,
  hourglass_faction  text,        -- 'guardians' | 'servants'
  hourglass_level    int,
  ships_sunk         int,
  playtime_minutes   int,

  -- tout le reste : réputations, commendations, milestones, succès, saison
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX snapshots_player_time_idx
  ON snapshots (player_id, source, captured_at DESC);
```

> **Volumétrie :** ~96 snapshots/joueur/jour à 15 min. Le dédoublonnage par `content_hash`
> écrase l'essentiel (un joueur hors ligne ne bouge pas). Partitionnement mensuel à prévoir
> au-delà de ~10 M de lignes — pas nécessaire au départ.

### 2.7 État courant — lecture rapide

Une ligne par joueur, mise à jour à chaque sync réussie. C'est **cette table** que lisent les
classements et les profils, jamais `snapshots` (qui sert à l'historique).

```sql
CREATE TABLE player_current (
  player_id          uuid PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  last_snapshot_id   bigint REFERENCES snapshots(id),
  gold               bigint,
  doubloons          bigint,
  ancient_coins      bigint,
  hourglass_faction  text,
  hourglass_level    int,
  ships_sunk         int,
  playtime_minutes   int,
  payload            jsonb NOT NULL DEFAULT '{}'::jsonb,
  sources            provider[] NOT NULL DEFAULT '{}',  -- ce qui alimente ce profil
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX player_current_gold_idx      ON player_current (gold DESC NULLS LAST);
CREATE INDEX player_current_hourglass_idx ON player_current (hourglass_level DESC NULLS LAST);
CREATE INDEX player_current_ships_idx     ON player_current (ships_sunk DESC NULLS LAST);
```

### 2.8 Sessions de jeu

```sql
CREATE TABLE play_sessions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id           uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  opening_snapshot_id bigint NOT NULL REFERENCES snapshots(id),
  closing_snapshot_id bigint REFERENCES snapshots(id),
  started_at          timestamptz NOT NULL,
  ended_at            timestamptz,
  is_open             boolean NOT NULL DEFAULT true,
  deltas              jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX play_sessions_player_idx ON play_sessions (player_id, started_at DESC);
CREATE UNIQUE INDEX play_sessions_one_open_idx
  ON play_sessions (player_id) WHERE is_open;
```

### 2.9 Observabilité du worker

**Aucun jeton, aucune réponse brute** — uniquement des métadonnées.

```sql
CREATE TABLE sync_log (
  id                bigserial PRIMARY KEY,
  player_id         uuid REFERENCES players(id) ON DELETE CASCADE,
  linked_account_id uuid REFERENCES linked_accounts(id) ON DELETE CASCADE,
  source            provider NOT NULL,
  status            sync_status NOT NULL,
  http_status       int,
  error_code        text,
  attempt           int NOT NULL DEFAULT 1,
  duration_ms       int,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sync_log_recent_idx ON sync_log (created_at DESC);
```

### 2.10 Consentement & suppression

```sql
CREATE TABLE consents (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version    text NOT NULL,        -- version du texte accepté
  scope      jsonb NOT NULL,       -- {collect:true, publicProfile:true, leaderboards:true}
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE TABLE deletion_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
```

---

## 3. Interface commune des providers

Le point clé de l'isolation exigée : **le reste du code ne connaît que cette interface**.
Si Rare ferme son API, on retire une implémentation — rien d'autre ne bouge.

```ts
type ProviderName = 'rare' | 'steam' | 'xbox';

interface StatsProvider {
  readonly name: ProviderName;
  readonly requiresCredential: boolean;

  /** pseudo/gamertag → identité stable (steamid64, xuid…) */
  resolveIdentity(input: string): Promise<Identity>;

  /** un relevé, normalisé. Le credential n'est passé QUE si requiresCredential. */
  fetchSnapshot(account: LinkedAccount, credential?: Secret): Promise<NormalizedSnapshot>;
}
```

### Snapshot normalisé

Chaque provider remplit ce qu'il peut, `null` ailleurs. Le front n'a **aucune branche par
source** : il affiche ce qui n'est pas `null`.

```ts
interface NormalizedSnapshot {
  source: ProviderName;
  capturedAt: string;
  identity:   { externalId: string; handle: string | null };

  currencies: { gold: number; doubloons: number; ancientCoins: number } | null;
  hourglass:  { faction: 'guardians' | 'servants'; level: number; progress: number } | null;
  reputation: Record<CompanyKey, { level: number; distinction?: number }> | null;
  milestones: { shipsSunk, krakensDefeated, megalodonsDefeated,
                chestsSold, nauticalMiles, islandsVisited } | null;
  playtime:   { totalMinutes: number; recentMinutes: number | null } | null;
  achievements: Array<{ id: string; name: string; unlockedAt: string | null }> | null;
  season:     { number: number; level: number; progress: number } | null;
}
```

| Champ | Rare | Steam | Xbox |
|---|:--:|:--:|:--:|
| currencies | ✅ | — | — |
| hourglass | ✅ | — | — |
| reputation | ✅ | — | — |
| milestones | ✅ | — | — |
| playtime | — | ✅ | ✅ |
| achievements | — | ✅ | ✅ |
| season | ✅ | — | — |

> **Rappel :** pas de kills PvP ni de K/D — Rare ne les expose pas. Le rang PvP affiché est
> l'allégeance Hourglass, complétée par `shipsSunk` et les commendations de combat.

---

## 4. Worker de collecte

### Boucle

```
cron (1 min)
  └─ SELECT joueurs WHERE next_sync_at <= now() ORDER BY next_sync_at LIMIT batch
       └─ pour chaque compte lié actif :
            1. déchiffrer le jeton (mémoire seule, jamais loggé)
            2. fetchSnapshot() via le provider
            3. hash du payload normalisé
            4. si hash == dernier hash → status 'no_change', pas d'insert
               sinon → INSERT snapshot + UPDATE player_current
            5. mise à jour des sessions (§5)
            6. écrire sync_log (métadonnées uniquement)
            7. next_sync_at = now() + intervalle (+ jitter)
```

### Gestion d'erreurs

| Cas | Action |
|---|---|
| **401 / 403** | `status = needs_reauth`, purge du credential, notification joueur, sortie de la file |
| **429** | backoff exponentiel + jitter, `next_sync_at` repoussé, jamais de retry immédiat |
| **5xx / réseau** | retry exponentiel (1m, 4m, 15m…), `consecutive_failures++` ; au-delà de 10 → `status = error` |
| **Réponse inattendue** | log du *shape*, pas du contenu ; snapshot ignoré ; alerte si taux global > seuil |

### Rate limiting

- **Par joueur** : 15 min par défaut (configurable), + jitter ±2 min pour éviter les rafales.
- **Global par provider** : token bucket. Rare étant non documenté → très conservateur
  (≈ 1 req/s, concurrence 2). Steam/Xbox suivent leurs limites publiées.
- Sync adaptatif (option) : joueur actif → 15 min ; inactif > 7 j → 6 h. Réduit la charge
  et le risque de blocage.

### Mode dégradé

Un flag par provider (`provider_health`) coupe une source sans redéployer. Si Rare tombe,
le worker ne traite plus que Steam/Xbox, et le front affiche un bandeau + les données
disponibles. Les profils ne cassent pas, ils rétrécissent.

---

## 5. Couche calculée

### Deltas
`valeur(t) − valeur(t₀)` sur les colonnes chaudes, bornes prises par index
`(player_id, captured_at)`. Périodes : jour / semaine / mois / saison.

### Sessions
- Un snapshot dont le `content_hash` change ⇒ activité détectée.
- Pas de session ouverte ⇒ on en ouvre une, baseline = snapshot précédent.
- Session ouverte + aucun changement pendant **45 min** ⇒ clôture, `deltas` = clôture − ouverture.
- Contrainte SQL : une seule session ouverte par joueur (index partiel unique).

### Classements
Lecture directe de `player_current` (indexé), filtrable plateforme / guilde.
Versions hebdo & mensuelle via delta sur la fenêtre → vue matérialisée rafraîchie
périodiquement plutôt que calcul à la volée.
**Uniquement les joueurs `is_public = true`.**

### Comparaison
Deux `player_current` + deux séries temporelles côte à côte. Pas de stockage dédié.

---

## 6. API interne (front)

```
GET  /api/players/:slug                  → profil (player_current + sources)
GET  /api/players/:slug/history?metric&range
GET  /api/players/:slug/sessions
GET  /api/leaderboards?metric&period&platform&guild
GET  /api/compare?a=&b=
POST /api/link/steam            { vanityOrId }
POST /api/link/xbox             { gamertag }
POST /api/link/rare             { token }      ← seul endroit où un jeton transite
DELETE /api/link/:id                            ← révocation en un clic
POST /api/account/delete                        ← purge complète
```

**Garanties :**
- Le rôle SQL de l'API n'a pas accès à `credentials` → un jeton ne *peut pas* fuiter par
  une réponse, même en cas de bug.
- `POST /api/link/rare` chiffre et écrit immédiatement ; le jeton ne repart jamais en lecture.
- Middleware de rédaction sur les logs : toute valeur ressemblant à un jeton est masquée
  avant écriture.

---

## 7. Sécurité — récapitulatif

| Exigence | Mise en œuvre |
|---|---|
| Chiffrement au repos | AES-256-GCM, clé en variable d'env / KMS, `key_version` pour rotation |
| Isolation | Table `credentials` séparée, `GRANT` restreint au worker |
| Jamais côté client | Aucun endpoint ne lit `credentials` ; réponses typées sans champ secret |
| Jamais en logs | Le jeton ne transite pas par le logger ; middleware de rédaction en filet |
| Révocation | `DELETE /api/link/:id` → suppression du credential + `status = revoked` |
| Suppression totale | `deletion_requests` → purge en cascade (players, snapshots, sessions) |
| Consentement | Table `consents` versionnée, texte explicite sur collecte / fréquence / visibilité |

---

## 8. Points à valider

1. **Stockage du jeton `rat`** — persisté chiffré (permet la collecte planifiée, donc
   l'historique et les sessions) **ou** session seulement (beaucoup plus safe, mais plus de
   collecte automatique → pas d'historique). *La valeur ajoutée du tracker dépend du premier.*
2. **Intervalle de collecte** — 15 min fixe, ou adaptatif selon l'activité (recommandé).
3. **Visibilité par défaut** — profil public (classements alimentés) ou privé par défaut
   (opt-in explicite pour apparaître) ?
4. **Stack** — Vercel Functions + Supabase Postgres, ou autre ?
5. **Rétention** — garder tous les snapshots indéfiniment, ou agréger au-delà de N mois
   (résolution horaire → journalière) ?
