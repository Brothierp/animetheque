# Recalcule les « genres » issus d'étiquettes AniList (Isekai, Boys' Love, Yuri, Vampires…) d'après le score de
# pertinence de l'étiquette : un titre n'a le genre que si AniList lui donne au moins 60 % (70 % si l'étiquette est
# marquée comme spoiler, c'est-à-dire qu'elle ne concerne qu'un passage de l'histoire).
# Les 19 vrais genres AniList ne sont pas modifiés.
# Usage : python3 genres_tags_fetch.py ids.json all_tags.json   (ids = identifiants AniList de data.json)
#         python3 genres_fix.py public/data.json all_tags.json
import json, sys, collections
DATA, TAGS = sys.argv[1], sys.argv[2]
d = json.load(open(DATA)); tags = json.load(open(TAGS))
G = d["tables"]["genres"]
ANILIST_GENRES = {"Action", "Adventure", "Comedy", "Drama", "Ecchi", "Fantasy", "Hentai", "Horror", "Mahou Shoujo", "Mecha", "Music",
                  "Mystery", "Psychological", "Romance", "Sci-Fi", "Slice of Life", "Sports", "Supernatural", "Thriller"}
FROM_TAGS = {i: g for i, g in enumerate(G) if g not in ANILIST_GENRES}
def ok(t): return t["rank"] >= (70 if t["isMediaSpoiler"] else 60)
added, removed, missing = collections.Counter(), collections.Counter(), 0
for x in d["items"]:
    info = tags.get(str(x[0]))
    if info is None: missing += 1; continue          # titre introuvable sur AniList : on ne touche à rien
    rank = {t["name"]: t for t in info["tags"]}
    keep = [g for g in x[12] if g not in FROM_TAGS or (G[g] in rank and ok(rank[G[g]]))]
    for g in x[12]:
        if g not in keep: removed[G[g]] += 1
    for i, name in FROM_TAGS.items():
        if i not in keep and name in rank and ok(rank[name]): keep.append(i); added[name] += 1
    x[12] = keep
json.dump(d, open(DATA, "w"), ensure_ascii=False, separators=(",", ":"))
print("titres non trouvés sur AniList :", missing)
print("retirés :", dict(removed.most_common()))
print("ajoutés :", dict(added.most_common()))
