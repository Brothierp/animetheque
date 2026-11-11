# Outils et données de l'Animéthèque

Tout ce qui a servi à construire la première version (page claude.ai), gardé de côté pour être trié plus tard.

- `scripts/` : téléchargement depuis AniList et construction de la base
  - `fetch.py` : catalogue hors contenu adulte → `raw.jsonl` (`python3 fetch.py raw.jsonl 221000`)
  - `fetch_adult.py` : titres 18+ → `raw_adult.jsonl`
  - `fetch_chars.py` : 25 personnages principaux par animé → `chars.jsonl`
  - `fetch_covers.py` : affiches (`python3 fetch_covers.py dossier raw.jsonl raw_adult.jsonl`)
  - `build.py` : construit `data.json`, `chars.json`, les planches d'affiches, `anime.sqlite` et `anime.csv`
    (`python3 build.py sortie --chars chars.jsonl --covers dossier raw.jsonl raw_adult.jsonl`)
- `donnees-brutes/` : réponses AniList complètes (novembre 2026), compressées en gzip
- `exports/` : base SQLite et CSV (séparateur `;`)
- `page-claude/index.html` : code de la page publiée sur claude.ai (version avec collection `window.claude`)

Source des données : AniList (https://anilist.co). La disponibilité FR/EN est déduite des plateformes de streaming.
