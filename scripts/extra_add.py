# Ajoute au catalogue des séries absentes d'AniList (ex. Arcane, production française) décrites dans scripts/extra/*.json.
# Usage : python3 scripts/extra_add.py scripts/extra/arcane.json
#   1. insère chaque animé à sa position de popularité (« pos ») dans public/data.json ;
#   2. décale en conséquence tous les fichiers alignés sur l'ordre des animés : covers-hd.json, chars.json,
#      franchises.json et dshards/ (synopsis + plateformes) ;
#   3. écrit scripts/extra/<nom>-raw.json (personnages au format AniList) pour characters_build.py.
# Ensuite : python3 scripts/characters_build.py public/data.json public/characters.json <dossier raw> scripts/extra/<nom>-raw.json
# À ne lancer qu'une fois par fichier : le script refuse si les animés sont déjà présents.
import json, os, sys

SRC = sys.argv[1]
PUB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public")
P = lambda f: os.path.join(PUB, f)
ex = json.load(open(SRC))
data = json.load(open(P("data.json")))
T, items = data["tables"], data["items"]
if any(x[0] in {a["id"] for a in ex["anime"]} for x in items): sys.exit("déjà présent : rien à faire")

def idx(table, v):
    if v not in T[table]: T[table].append(v)
    return T[table].index(v)

anime = sorted(ex["anime"], key=lambda a: a["pos"])     # positions finales croissantes
n_old = len(items)
# ancien index → nouvel index
final_pos = [a["pos"] for a in anime]
def remap(i):
    k = 0
    for p in final_pos:
        if i + k >= p: k += 1
    return i + k

# 1. data.json
new_items = [None] * (n_old + len(anime))
for i, x in enumerate(items): new_items[remap(i)] = x
for a in anime:
    assert new_items[a["pos"]] is None, "position déjà occupée"
    before = new_items[a["pos"] - 1][16] if a["pos"] > 0 else 0
    after = next((x[16] for x in new_items[a["pos"] + 1:] if x), before)
    pop = (before + after) // 2                       # garde l'ordre de popularité du fichier
    new_items[a["pos"]] = [a["id"], 0, a["romaji"], a["english"], a["native"], a["syn"], idx("format", a["format"]), idx("status", a["status"]),
        a["eps"], a["dur"], idx("season", a["season"]), a["year"], [T["genres"].index(g) for g in a["genres"]],
        [T["tags"].index(t) for t in a["tags"] if t in T["tags"]], [idx("studios", s) for s in a["studios"]], a.get("score", 0), pop,
        idx("country", a["country"]), idx("source", a["source"]), 1, len(a["plats"]), a["lang"], 0, -1, a["ext"]]
assert all(new_items)
data["items"] = new_items
json.dump(data, open(P("data.json"), "w"), ensure_ascii=False, separators=(",", ":"))

# 2a. affiches HD (adresse complète, « {w} » = largeur)
hd = json.load(open(P("covers-hd.json")))
c = [None] * len(new_items)
for i, f in enumerate(hd["c"]): c[remap(i)] = f
for a in anime: c[a["pos"]] = a["cover"] + "|" + a["color"]
hd["c"] = [x or "" for x in c]
json.dump(hd, open(P("covers-hd.json"), "w"), ensure_ascii=False, separators=(",", ":"))

# 2b. personnages par animé (recherche du catalogue)
C = json.load(open(P("chars.json")))
cc = [None] * len(new_items)
for i, x in enumerate(C): cc[remap(i)] = x
for a in anime:
    cc[a["pos"]] = [[ch["name"], "", r] for ch in ex["chars"] for r in [ch["roles"][0 if a["year"] < 2024 else 1]] if r]
json.dump([x if x is not None else [] for x in cc], open(P("chars.json"), "w"), ensure_ascii=False, separators=(",", ":"))

# 2c. franchises (une franchise pour les saisons ajoutées)
fr = json.load(open(P("franchises.json")))
fr["f"] = [[[remap(i), k] for i, k in f] for f in fr["f"]]
if len(anime) > 1: fr["f"].append([[a["pos"], 0] for a in anime])
json.dump(fr, open(P("franchises.json"), "w"), ensure_ascii=False, separators=(",", ":"))

# 2d. synopsis et plateformes (64 fichiers, clé = index de l'animé)
SH = 64
old = [json.load(open(P(f"dshards/{s}.json"))) for s in range(SH)]
new = [dict() for _ in range(SH)]
for s in range(SH):
    for k, v in old[s].items():
        j = remap(int(k)); new[j % SH][str(j)] = v
for a in anime:
    new[a["pos"] % SH][str(a["pos"])] = [a["desc"], [[T["platforms"].index(p), u] for p, u in a["plats"]]]
for s in range(SH): json.dump(new[s], open(P(f"dshards/{s}.json"), "w"), ensure_ascii=False, separators=(",", ":"))

# 3. personnages au format AniList (pour characters_build.py)
raw = []
for a in anime:
    si = 0 if a["year"] < 2024 else 1
    edges = [{"role": {"M": "MAIN", "S": "SUPPORTING", "B": "BACKGROUND"}[ch["roles"][si]],
              "node": {"id": ch["id"], "name": {"full": ch["name"], "native": None, "alternative": []}, "image": {"medium": ch["img"]},
                       "gender": ch["gender"], "age": None, "bloodType": None, "dateOfBirth": {"month": None, "day": None},
                       "favourites": 0, "description": ch["desc_en"]}} for ch in ex["chars"] if ch["roles"][si]]
    raw.append({"id": a["id"], "characters": {"edges": edges}})
out = SRC.replace(".json", "-raw.json")
json.dump(raw, open(out, "w"), ensure_ascii=False, indent=0)
# fiches des personnages (description française, lien) pour le site
xc = json.load(open(P("extra-chars.json"))) if os.path.exists(P("extra-chars.json")) else {}
xc.update({str(ch["id"]): {"d": ch["desc_fr"], "g": ch["gender"], "u": ch["wiki"]} for ch in ex["chars"]})
json.dump(xc, open(P("extra-chars.json"), "w"), ensure_ascii=False, separators=(",", ":"))
print("ajouté :", [(a["english"], a["pos"]) for a in anime], "→", out)
