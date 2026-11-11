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
index.html                     squelette de la page (en-tête, navigation, barre mobile)
src/app.js                     routeur (#/…), en-tête, recherche globale, session
src/data.js                    catalogue : chargement, traductions, affiches, titres similaires
src/state.js                   session, profil, collection et listes (mises à jour immédiates)
src/ui.js                      cartes d'affiche, menu « + Ajouter », étoiles, rangées
src/views/home.js              accueil : à la une, recommandations, rangées, genres
src/views/catalogue.js         catalogue : grille, genres, panneau de filtres, tri
src/views/detail.js            fiche d'un animé (fenêtre)
src/views/collection.js        ma collection (onglets par statut)
src/views/lists.js             mes listes et page d'une liste
src/views/account.js           mon compte : profil, avatar, suppression
src/auth.js                    fenêtre de connexion (e-mail, Google, mot de passe oublié, profil)
src/profile.js                 pseudo, année de naissance, avatar
src/store.js                   lecture / écriture de la collection dans Supabase
src/supabase.js                client Supabase (variables VITE_SUPABASE_*)
src/style.css                  thème violet sombre
public/data.json               catalogue (titres, genres, tags, studios, plateformes…)
public/chars.json              25 personnages principaux par animé
public/covers/s*.webp          planches d'affiches (200 affiches par fichier)
public/confidentialite.html    politique de confidentialité
public/conditions.html         conditions d'utilisation
supabase/migrations/*.sql      tables, contraintes et règles RLS
vercel.json                    build Vite + en-têtes de cache et de sécurité
```

### Navigation

`#/` accueil · `#/catalogue` (paramètres possibles : `?genre=Isekai`, `?tag=…`, `?status=RELEASING`, `?sort=score`,
`?chara=Luffy`, `?studio=MAPPA`) · `#/anime/<id AniList>` fiche · `#/collection/<onglet>` · `#/listes` · `#/listes/<id>` ·
`#/compte`. Raccourci clavier : `/` pour rechercher, `Échap` pour fermer une fiche.

## Filtres

Recherche par titre (japonais, anglais, français, synonymes), disponibilité FR/EN, genres à 3 états (inclure / exclure / retirer,
dont **Isekai** et **Boys' Love (BL / Yaoi)**), personnage, thèmes, format, statut, année et saison, nombre d'épisodes, durée,
note minimale, studio, œuvre d'origine, pays.

- Contenu **18+** : masqué par défaut et réservé aux comptes majeurs. L'année de naissance est demandée à l'inscription
  (ou après la première connexion Google), une seule fois, sans modification possible. Elle est stockée dans `profiles`
  et la majorité est recalculée chaque année. L'accès est ouvert à partir de l'année des 19 ans, par prudence,
  puisque le jour de naissance n'est pas connu. Case cochée, **seuls** les titres adultes s'affichent. Leurs liens pointent vers
  **MyAnimeList** (AniList affiche une page 404 aux visiteurs non connectés pour ces titres).
- Animés **à venir** : masqués par défaut.

## Mise en route

### 1. Supabase

1. Crée un projet sur [supabase.com](https://supabase.com).
2. **SQL Editor** → colle et exécute, dans l'ordre, les fichiers de `supabase/migrations/` :
   `20261111000000_collection.sql` (tables + RLS), `20261111010000_delete_account.sql`
   (bouton « Supprimer mon compte ») `20261111020000_profiles_birth_year.sql` (année de naissance, contrôle 18+) et
   `20261111030000_pseudo_avatar_moderation.sql` (pseudo, avatar, filtre de mots interdits). Ou `supabase link` puis `supabase db push` avec la CLI.
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

## Pseudo, avatar et modération

- **Pseudo** : 3 à 20 caractères (lettres, accents, chiffres, `_ . -`), unique sans tenir compte des majuscules,
  modifiable depuis « Mon compte ». Les noms réservés (admin, modérateur, support…) sont refusés.
- **Mots interdits** : table `banned_words` (Supabase → Table Editor). Mode `word` = mot entier seulement,
  `substring` = même collé à d'autres lettres. La comparaison ignore majuscules, accents, séparateurs (`c.o.n`) et
  « leet » (`c0nn4rd`). Le filtre s'applique côté base (déclencheurs) au pseudo, aux noms de listes et aux commentaires :
  il ne peut pas être contourné depuis le navigateur. Ajoute des lignes à la table pour l'étendre.
- **Avatar** : stockage Supabase privé `avatars/<id utilisateur>/…`, 1 Mo max, recadré en 256 × 256 WebP dans le
  navigateur (les métadonnées EXIF / GPS disparaissent). Les images ne sont pas analysées automatiquement.
- **Mots de passe** : Supabase ne stocke qu'une empreinte bcrypt (`auth.users.encrypted_password`), impossible à
  inverser ; personne, pas même l'administrateur, ne peut lire un mot de passe.

## Personnages

- **Données** : récupérées depuis l'[API AniList](https://docs.anilist.co) (25 personnages par animé, triés par rôle puis
  importance) avec `scripts/characters_fetch.py` (≈ 450 requêtes, limite de débit respectée, reprise automatique), puis
  transformées par `scripts/characters_build.py` en :
  - `public/characters.json` : index (nom, nom natif, image, nombre de fans, étiquettes, apparitions) pour la page Personnages ;
  - `public/characters-top.json` : les 40 plus aimés, pour l'accueil ;
  - `public/cshards/<n>.json` : visages par animé (64 fichiers légers) pour la fiche d'un animé.
- **Images** : servies par le CDN d'AniList (`s4.anilist.co`), pas stockées dans le dépôt.
- **Description, âge, anniversaire** : chargés en direct depuis AniList à l'ouverture d'une fiche personnage (anglais,
  spoilers floutés).
- **Étiquettes** : AniList ne fournit pas d'étiquettes de personnages. Elles sont déduites en français de ses champs
  (genre, âge, date de naissance → signe, groupe sanguin, taille) et de la description (cheveux, yeux, lunettes, espèce,
  métier, personnalité…), par des règles prudentes. Elles sont donc indicatives et inégales : les personnages populaires,
  mieux décrits, en ont davantage. Modifier les règles dans `characters_build.py` puis relancer le script.

## Genres issus d'étiquettes

AniList n'a que 19 genres. Les autres « genres » du catalogue (Boys' Love, Yuri, Isekai, Vampires, Vie scolaire…) sont
des étiquettes votées par la communauté, avec un score de pertinence. Un titre n'a ce genre que si l'étiquette atteint
**60 %** (**70 %** si elle est marquée comme spoiler). Pour mettre à jour : `scripts/genres_tags_fetch.py` puis
`scripts/genres_fix.py` (voir l'en-tête du script).

## Fonctions

- **Accueil** : à la une, Reprendre (+1 épisode), La suite de tes séries, recommandations (une par franchise, hors
  franchises déjà connues), rangées thématiques, personnages les plus aimés, genres. Guide de bienvenue masquable.
- **Catalogue** : grille, genres, panneau de filtres, tri, « Regrouper les saisons » (un titre par franchise).
- **Fiche d'animé** : où regarder, statut / étoiles / ♥ / épisodes vus / avis / listes, ordre de visionnage
  (`public/franchises.json`, construit par `scripts/relations_fetch.py` puis `scripts/franchises_build.py`),
  synopsis (`public/dshards/`, voir `scripts/split_desc.py`), personnages, titres similaires.
- **Personnages**, **Calendrier** (AniList en direct), **Ma collection** (onglets, statistiques, personnages favoris,
  tirage au sort), **Mes listes**, **Mon compte** (profil, import MyAnimeList / AniList, export JSON, suppression).
- **Recherche unifiée** (animés + personnages, flèches et Entrée), **installation sur téléphone** (`manifest.webmanifest`,
  `sw.js` : pages réseau d'abord, affiches et code en cache).

## Ce qui reste à faire de ton côté

- **E-mails** : brancher un service SMTP (Resend, Brevo…) dans Supabase → Authentication → Emails, sinon les e-mails
  de confirmation sont limités à quelques-uns par heure.
- **Mentions légales** : page obligatoire en France (identité de l'éditeur, hébergeur Vercel).
