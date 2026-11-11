# Animéthèque

Catalogue de 22 681 animés (données AniList) avec filtres détaillés et **collection personnelle privée** :
coups de cœur, note de 1 à 5 étoiles, commentaire rapide (280 caractères), statuts *Regardé / En cours / Je veux regarder / Abandonné*
et listes personnelles.

- **Front** : application web statique (Vite, JavaScript sans framework), hébergée sur **Vercel**.
- **Back** : **Supabase** (Postgres + authentification). Connexion par e-mail + mot de passe ou Google, inscription libre.
- **Confidentialité** : sécurité au niveau des lignes (RLS) : chaque utilisateur ne lit et ne modifie que ses propres données.

Le catalogue reste consultable sans compte ; la collection demande une connexion.

## Structure

```
index.html                     page unique
src/main.js                    catalogue, filtres, cartes, collection
src/auth.js                    fenêtre de connexion (e-mail, Google, mot de passe oublié)
src/store.js                   lecture / écriture de la collection dans Supabase
src/supabase.js                client Supabase (variables VITE_SUPABASE_*)
src/style.css                  thème violet sombre
public/confidentialite.html    politique de confidentialité (exigée par Google pour la connexion Google)
public/conditions.html         conditions d'utilisation
public/data.json               catalogue (titres, genres, tags, studios, plateformes…)
public/chars.json              25 personnages principaux par animé
public/covers/s*.webp          planches d'affiches (200 affiches par fichier)
supabase/migrations/*.sql      tables, contraintes et règles RLS
vercel.json                    build Vite + en-têtes de cache et de sécurité
```

## Filtres

Recherche par titre (japonais, anglais, français, synonymes), disponibilité FR/EN, genres à 3 états (inclure / exclure / retirer,
dont **Isekai** et **Boys' Love (BL / Yaoi)**), personnage, thèmes, format, statut, année et saison, nombre d'épisodes, durée,
note minimale, studio, œuvre d'origine, pays.

- Contenu **18+** : masqué par défaut ; case cochée, **seuls** les titres adultes s'affichent. Leurs liens pointent vers
  **MyAnimeList** (AniList affiche une page 404 aux visiteurs non connectés pour ces titres).
- Animés **à venir** : masqués par défaut.

## Mise en route

### 1. Supabase

1. Crée un projet sur [supabase.com](https://supabase.com).
2. **SQL Editor** → colle et exécute, dans l'ordre, les fichiers de `supabase/migrations/` :
   `20261111000000_collection.sql` (tables + RLS) puis `20261111010000_delete_account.sql`
   (bouton « Supprimer mon compte »). Ou `supabase link` puis `supabase db push` avec la CLI.
   Les scripts peuvent être relancés sans risque.
3. **Authentication → Sign In / Providers**
   - *Email* : activé. Garde « Confirm email » activé (recommandé). Règle la longueur minimale du mot de passe à 8.
   - *Google* : active-le et renseigne le *Client ID* et le *Client Secret* créés dans
     [Google Cloud Console](https://console.cloud.google.com/apis/credentials) (identifiant OAuth « Application Web »).
     Dans Google, ajoute comme *URI de redirection autorisé* : `https://<ton-projet>.supabase.co/auth/v1/callback`.
     Pour publier l'application Google (sinon seuls les testeurs déclarés peuvent se connecter), remplis la page
     *Branding* : page d'accueil `https://<ton-site>/`, règles de confidentialité `https://<ton-site>/confidentialite.html`,
     conditions `https://<ton-site>/conditions.html`, domaine autorisé `<ton-site>`. N'ajoute pas de logo
     (il déclenche une vérification de plusieurs jours).
4. **Authentication → URL Configuration**
   - *Site URL* : l'adresse de production, ex. `https://animetheque.vercel.app`.
   - *Redirect URLs* : ajoute `https://animetheque.vercel.app/**`, `https://*-<ton-compte>.vercel.app/**` (aperçus Vercel)
     et `http://localhost:5173/**` (développement).
5. **Project Settings → API** : note l'*URL* et la clé *anon public*.

### 2. En local

```bash
npm install
```

```bash
cp .env.example .env.local
```

Renseigne `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY` dans `.env.local`, puis :

```bash
npm run dev
```

Sans ces variables, le site fonctionne en mode catalogue seul (la collection est désactivée).

### 3. Vercel

1. *Add New → Project* → importe ce dépôt GitHub. Le préréglage **Vite** est détecté (`vercel.json`).
2. *Environment Variables* : ajoute `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY` (Production et Preview).
3. Déploie. Pense à reporter l'URL finale dans Supabase (étape 1.4).

La clé *anon* est publique par conception : elle est incluse dans le JavaScript envoyé au navigateur.
La protection des données repose entièrement sur les règles RLS. N'utilise **jamais** la clé *service_role* côté front.

## Modèle de données

| Table | Contenu | Règles |
|---|---|---|
| `collection_entries` | une ligne par (utilisateur, animé) : `favorite`, `rating` 1–5, `comment` ≤ 280, `status` | RLS : `auth.uid() = user_id` en lecture, ajout, modification, suppression |
| `lists` | listes personnelles (`name` 1–40 caractères, unique par utilisateur sans tenir compte de la casse, 50 max) | idem |
| `list_items` | titres rangés dans une liste | idem + clé étrangère `(list_id, user_id)` : impossible d'écrire dans la liste d'un autre |

Les visiteurs non connectés (rôle `anon`) n'ont aucun droit sur ces tables. La suppression d'un compte supprime toutes ses données (`on delete cascade`).

`anime_id` est l'identifiant AniList (premier champ de chaque entrée de `data.json`).

## Format de `data.json`

`{ tables: { genres, tags, studios, platforms, format, status, season, country, source }, items: [...] }`.
Chaque entrée de `items` est un tableau ; les index renvoient aux `tables` :

`[id AniList, id MAL, romaji, anglais, natif, synonymes[], format, statut, épisodes, durée, saison, année, genres[], tags[], studios[], note /100, popularité, pays, source, synopsis, plateformes[[i, url]], langues ("F", "E", "FE" ou ""), adulte (0/1), index d'affiche]`.

`chars.json` suit le même ordre : pour chaque animé, `[[nom, nom natif, rôle M/S/B], …]`.
L'affiche n° `k` se trouve dans `covers/s{⌊k/200⌋}.webp`, grille de 10 × 20.
