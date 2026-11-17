# Mise à jour automatique du catalogue depuis AniList (lancée chaque semaine par .github/workflows/catalogue.yml).
#   1. met à jour les titres existants : statut, nombre d'épisodes, note, popularité, saison et année ;
#   2. ajoute les nouveaux titres (sortis depuis un an, en cours ou annoncés) avec synopsis, plateformes,
#      affiche HD, personnages (étiquettes françaises calculées comme pour les autres) et franchise (suite d'une série connue) ;
#   3. retrie le catalogue par popularité et décale tous les fichiers qui dépendent de l'ordre des animés.
# Usage : python3 scripts/catalogue_refresh.py [--dry-run]
# Sécurités : rien n'est écrit si AniList répond mal (moins de 95 % des titres trouvés) ou si le catalogue rétrécit.
import json, os, re, sys, time, collections, datetime, urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from characters_build import tags_for, CATS   # même calcul d'étiquettes que pour les personnages existants

PUB = os.path.join(HERE, "..", "public")
P = lambda f: os.path.join(PUB, f)
DRY = "--dry-run" in sys.argv
EXTRA_MIN_ID = 900000                      # séries ajoutées à la main (Arcane…) : absentes d'AniList
MIN_POP = 30                               # popularité minimale d'un nouveau titre
COUNTRIES = {"JP", "CN", "KR", "TW"}
UA = "animetheque-catalogue-builder/1.0"

def gql(query, variables):
    body = json.dumps({"query": query, "variables": variables}).encode()
    for attempt in range(8):
        req = urllib.request.Request("https://graphql.anilist.co", data=body,
              headers={"Content-Type": "application/json", "Accept": "application/json", "User-Agent": UA})
        try:
            r = urllib.request.urlopen(req, timeout=90); d = json.load(r)
            if "errors" in d: raise RuntimeError(str(d["errors"])[:300])
            rem = int(r.headers.get("X-RateLimit-Remaining") or 10)
            time.sleep(0.8 if rem > 10 else 25)
            return d["data"]
        except urllib.error.HTTPError as e:
            wait = int(e.headers.get("Retry-After") or 30) + 2
            print(f"HTTP {e.code}, pause {wait}s", flush=True); time.sleep(wait)
        except Exception as e:
            print("erreur :", e, flush=True); time.sleep(10)
    raise SystemExit("AniList ne répond pas : abandon sans rien modifier")

data = json.load(open(P("data.json")))
T, items = data["tables"], data["items"]
n_before = len(items)
def idx(table, v):
    if v not in T[table]: T[table].append(v)
    return T[table].index(v)

# ---------- 1. titres existants ----------
Q_UPD = """query($ids:[Int]){ Page(perPage:50){ media(id_in:$ids, type:ANIME){ id status episodes averageScore popularity season seasonYear startDate{year} } } }"""
ids = [x[0] for x in items if x[0] < EXTRA_MIN_ID]
found, changed = 0, collections.Counter()
byid = {x[0]: x for x in items}
for i in range(0, len(ids), 50):
    for m in gql(Q_UPD, {"ids": ids[i:i + 50]})["Page"]["media"]:
        x = byid[m["id"]]; found += 1
        new = {7: idx("status", m["status"]) if m["status"] else x[7], 8: m["episodes"] or x[8], 15: m["averageScore"] or x[15],
               16: m["popularity"] or x[16], 10: idx("season", m["season"]) if m["season"] else x[10],
               11: m["seasonYear"] or (m["startDate"] or {}).get("year") or x[11]}
        for k, v in new.items():
            if x[k] != v: x[k] = v; changed[k] += 1
    if i % 2500 == 0: print(f"mises à jour : {i}/{len(ids)}", flush=True)
print("titres trouvés :", found, "/", len(ids), "| champs modifiés :", {["", "", "", "", "", "", "", "statut", "épisodes", "", "saison", "année", "", "", "", "note", "popularité"][k]: n for k, n in changed.items()})
if found < 0.95 * len(ids): raise SystemExit("moins de 95 % des titres trouvés : abandon sans rien modifier")

# ---------- 2. nouveaux titres ----------
since = int((datetime.date.today() - datetime.timedelta(days=365)).strftime("%Y%m%d"))
Q_FIND = """query($p:Int,$since:FuzzyDateInt,$st:MediaStatus){ Page(perPage:50, page:$p){ pageInfo{ hasNextPage }
  media(type:ANIME, startDate_greater:$since, status:$st, popularity_greater:%d, sort:POPULARITY_DESC){ id countryOfOrigin } } }""" % MIN_POP
Q_TBA = """query($p:Int){ Page(perPage:50, page:$p){ pageInfo{ hasNextPage }
  media(type:ANIME, status:NOT_YET_RELEASED, popularity_greater:%d, sort:POPULARITY_DESC){ id countryOfOrigin } } }""" % MIN_POP
cand = set()
for q, v in ((Q_FIND, {"since": since, "st": None}), (Q_TBA, {})):
    for page in range(1, 41):
        pg = gql(q, dict(v, p=page))["Page"]
        for m in pg["media"]:
            if m["id"] not in byid and m["countryOfOrigin"] in COUNTRIES: cand.add(m["id"])
        if not pg["pageInfo"]["hasNextPage"]: break
print("nouveaux titres à ajouter :", len(cand))

Q_FULL = """query($ids:[Int]){ Page(perPage:10){ media(id_in:$ids, type:ANIME){ id idMal title{ romaji english native } synonyms format status episodes duration
  season seasonYear startDate{ year month day } genres tags{ name rank isMediaSpoiler } studios(isMain:true){ nodes{ name } } averageScore popularity
  countryOfOrigin source description(asHtml:false) externalLinks{ site url type language } isAdult coverImage{ extraLarge color }
  relations{ edges{ relationType node{ id } } }
  characters(perPage:25, sort:[ROLE,RELEVANCE,ID]){ edges{ role node{ id name{ full native alternative } image{ medium }
    gender age bloodType dateOfBirth{ month day } favourites description } } } } } }"""
ANILIST_GENRES = {"Action", "Adventure", "Comedy", "Drama", "Ecchi", "Fantasy", "Hentai", "Horror", "Mahou Shoujo", "Mecha", "Music",
                  "Mystery", "Psychological", "Romance", "Sci-Fi", "Slice of Life", "Sports", "Supernatural", "Thriller"}
TAG_GENRES = [g for g in T["genres"] if g not in ANILIST_GENRES]          # genres déduits d'étiquettes (voir genres_fix.py)
EN_SITES = {"Crunchyroll", "Netflix", "HIDIVE", "Hulu", "Amazon Prime Video", "Prime Video", "Disney Plus", "Max", "Apple TV+", "YouTube"}
COVER_ROOT = "https://s4.anilist.co/file/anilistcdn/media/anime/cover/"

def clean(t):
    t = re.sub(r"<br\s*/?>", "\n", t or ""); t = re.sub(r"<[^>]+>", "", t)
    t = re.sub(r"\(Source:[^)]*\)\s*$", "", t.strip()); return re.sub(r"\n{3,}", "\n\n", t).strip()

new_media = []
cl = sorted(cand)
for i in range(0, len(cl), 10):
    new_media += gql(Q_FULL, {"ids": cl[i:i + 10]})["Page"]["media"]
new_rows, extra_info = [], {}
for m in new_media:
    tags = {t["name"]: t for t in m["tags"] or []}
    ok = lambda t: t["rank"] >= (70 if t["isMediaSpoiler"] else 60)
    genres = [idx("genres", g) for g in m["genres"] or [] if g in ANILIST_GENRES or g in T["genres"]]
    genres += [T["genres"].index(g) for g in TAG_GENRES if g in tags and ok(tags[g]) and T["genres"].index(g) not in genres]
    tag_ix = [idx("tags", t["name"]) for t in sorted(m["tags"] or [], key=lambda t: -t["rank"]) if not t["isMediaSpoiler"] and t["rank"] >= 60][:12]
    stream = [l for l in m["externalLinks"] or [] if l["type"] == "STREAMING"]
    lang = ("F" if any(l["language"] == "French" for l in stream) else "") + \
           ("E" if any(l["language"] == "English" or (not l["language"] and l["site"] in EN_SITES) for l in stream) else "")
    plats = [[idx("platforms", l["site"]), l["url"]] for l in stream]
    desc = clean(m["description"])
    sd = m["startDate"] or {}
    row = [m["id"], m["idMal"] or 0, m["title"]["romaji"] or "", m["title"]["english"] or "", m["title"]["native"] or "",
           [s for s in m["synonyms"] or [] if s][:8], idx("format", m["format"] or "TV"), idx("status", m["status"] or "NOT_YET_RELEASED"),
           m["episodes"] or 0, m["duration"] or 0, idx("season", m["season"]) if m["season"] else -1, m["seasonYear"] or sd.get("year") or 0,
           genres, tag_ix, [idx("studios", s["name"]) for s in (m["studios"] or {}).get("nodes", [])], m["averageScore"] or 0,
           m["popularity"] or 0, idx("country", m["countryOfOrigin"]), idx("source", m["source"] or "OTHER"), 1 if desc else 0,
           len(plats), lang, 1 if m["isAdult"] else 0, -1]
    cov = (m["coverImage"] or {}).get("extraLarge") or ""
    hd = ""
    if cov.startswith(COVER_ROOT) and "default" not in cov:
        size, file = cov[len(COVER_ROOT):].split("/", 1)
        if size in ("large", "medium", "extraLarge"):
            hd = ("*" if size == "medium" else "") + re.sub(rf"^([a-z]*){m['id']}-", r"\1~", file)
            if size == "extraLarge": hd = ""      # pas de taille « large » connue : on garde l'affiche par défaut
            col = (m["coverImage"] or {}).get("color")
            if hd and col: hd += "|" + col.lstrip("#")
    new_rows.append(row)
    rel = [(e["relationType"], e["node"]["id"]) for e in (m["relations"] or {}).get("edges", [])]
    extra_info[m["id"]] = {"desc": desc, "plats": plats, "hd": hd, "rel": rel, "chars": (m["characters"] or {}).get("edges", []),
                           "date": (sd.get("year") or 9999, sd.get("month") or 12, sd.get("day") or 31)}

# ---------- 3. tri par popularité et réindexation ----------
old_items = items
all_items = old_items + new_rows
order = sorted(range(len(all_items)), key=lambda i: (-all_items[i][16], i))
new_index = {old: new for new, old in enumerate(order)}          # ancien index (ou index provisoire des nouveaux) → nouvel index
items = [all_items[i] for i in order]
if len(items) < n_before: raise SystemExit("le catalogue rétrécit : abandon")
pos_of_id = {x[0]: i for i, x in enumerate(items)}
remap = lambda i: new_index[i]

# affiches HD
hd = json.load(open(P("covers-hd.json")))
c = [""] * len(items)
for i, f in enumerate(hd["c"]): c[remap(i)] = f
for m_id, info in extra_info.items(): c[pos_of_id[m_id]] = info["hd"]
hd["c"] = c

# personnages par animé (recherche du catalogue)
C = json.load(open(P("chars.json")))
cc = [[] for _ in items]
for i, x in enumerate(C): cc[remap(i)] = x
R1 = {"MAIN": "M", "SUPPORTING": "S", "BACKGROUND": "B"}
for m_id, info in extra_info.items():
    cc[pos_of_id[m_id]] = [[e["node"]["name"]["full"] or "", e["node"]["name"]["native"] or "", R1.get(e["role"], "B")] for e in info["chars"]]

# synopsis et plateformes
SH = 64
dsh_old = [json.load(open(P(f"dshards/{s}.json"))) for s in range(SH)]
dsh = [dict() for _ in range(SH)]
for s in range(SH):
    for k, v in dsh_old[s].items():
        j = remap(int(k)); dsh[j % SH][str(j)] = v
for m_id, info in extra_info.items():
    j = pos_of_id[m_id]
    if info["desc"] or info["plats"]: dsh[j % SH][str(j)] = [info["desc"], info["plats"]]

# franchises : une suite ou un préquel d'un titre connu rejoint sa franchise
fr = json.load(open(P("franchises.json")))
fr["f"] = [[[remap(i), k] for i, k in f] for f in fr["f"]]
fr_of = {}
for fi, f in enumerate(fr["f"]):
    for i, k in f: fr_of[items[i][0]] = fi
MAINF = {T["format"].index(f) for f in ("TV", "TV_SHORT", "MOVIE", "ONA") if f in T["format"]}
KIND = {"SIDE_STORY": 1, "SPIN_OFF": 2, "SUMMARY": 3, "ALTERNATIVE": 4, "COMPILATION": 3}
date_of = lambda aid: extra_info[aid]["date"] if aid in extra_info else (items[pos_of_id[aid]][11] or 9999, 12, 31)
for m_id, info in sorted(extra_info.items(), key=lambda kv: kv[1]["date"]):
    links = [(t, o) for t, o in info["rel"] if o in pos_of_id and t in ("SEQUEL", "PREQUEL", "SIDE_STORY", "SPIN_OFF", "SUMMARY", "ALTERNATIVE", "COMPILATION", "PARENT")]
    if not links or m_id in fr_of: continue
    t, other = next(((t, o) for t, o in links if t in ("SEQUEL", "PREQUEL")), links[0])
    kind = 0 if t in ("SEQUEL", "PREQUEL", "PARENT") and items[pos_of_id[m_id]][6] in MAINF else KIND.get(t, 5)
    if other in fr_of: fi = fr_of[other]
    else: fr["f"].append([[pos_of_id[other], 0]]); fi = len(fr["f"]) - 1; fr_of[other] = fi
    fr["f"][fi].append([pos_of_id[m_id], kind]); fr_of[m_id] = fi
    fr["f"][fi].sort(key=lambda e: date_of(items[e[0]][0]))

# personnages : apparitions décalées, nouveaux titres ajoutés, nouveaux personnages avec leurs étiquettes
CH = json.load(open(P("characters.json"))); MORE = json.load(open(P("characters-more.json")))
rows = CH["chars"] + MORE["chars"]
tag_index = {(CATS[cat], label): i for i, (cat, label, n) in enumerate(CH["tags"])}
for r in rows: r[6] = sorted(remap(v // 4) * 4 + (v & 3) for v in r[6])
by_cid = {r[0]: r for r in rows}
IMG = CH["img"]
R = {"MAIN": 0, "SUPPORTING": 1, "BACKGROUND": 2}
added_chars = 0
for m_id, info in extra_info.items():
    ai = pos_of_id[m_id]
    for e in info["chars"]:
        c_ = e["node"]; v = ai * 4 + R.get(e["role"], 2)
        if c_["id"] in by_cid:
            r = by_cid[c_["id"]]
            if not any(x // 4 == ai for x in r[6]): r[6] = sorted(r[6] + [v])
            continue
        img = (c_.get("image") or {}).get("medium") or ""
        img = "" if "default" in img else img.replace(IMG, "") if img.startswith(IMG) else img
        img = re.sub(rf"^([a-z]?){c_['id']}-", r"\1~", img)
        ts = tags_for(c_); ts.add(("Rôle dans l'histoire", {"MAIN": "Personnage principal", "SUPPORTING": "Personnage secondaire"}.get(e["role"], "Figurant")))
        alt = [a for a in (c_["name"].get("alternative") or []) if a and len(a) <= 40][:3]
        if not img and not c_.get("favourites") and e["role"] == "BACKGROUND": continue
        r = [c_["id"], c_["name"].get("full") or "", c_["name"].get("native") or "", img, c_.get("favourites") or 0,
             sorted(tag_index[t] for t in ts if t in tag_index), [v], alt]
        rows.append(r); by_cid[r[0]] = r; added_chars += 1
rows.sort(key=lambda r: -r[4])
FIRST = 3000
CH["chars"], MORE["chars"], CH["total"] = rows[:FIRST], rows[FIRST:], len(rows)
by_anime = collections.defaultdict(list)
for r in rows:
    for v in r[6]: by_anime[v // 4].append((v & 3, r[0], r[1] or r[2], r[3]))
cshards = [dict() for _ in range(SH)]
for ai, L in by_anime.items():
    L.sort(key=lambda x: x[0])
    cshards[ai % SH][ai] = [[cid, name, img, role] for role, cid, name, img in L]
top = [[r[0], r[1], r[2], r[3], r[4], [x for x in r[6] if not items[x // 4][22]][:3]] for r in rows if r[3] and any(not items[x // 4][22] for x in r[6])][:40]
print("personnages ajoutés :", added_chars)

if DRY: print("--dry-run : aucun fichier modifié"); sys.exit(0)
data["items"] = items
dump = lambda o, f: json.dump(o, open(P(f), "w"), ensure_ascii=False, separators=(",", ":"))
dump(data, "data.json"); dump(hd, "covers-hd.json"); dump(cc, "chars.json"); dump(fr, "franchises.json")
for s in range(SH): dump(dsh[s], f"dshards/{s}.json"); dump({"img": IMG, "a": cshards[s]}, f"cshards/{s}.json")
dump(CH, "characters.json"); dump(MORE, "characters-more.json"); dump({"img": IMG, "chars": top}, "characters-top.json")
# nouvelle version des données (date et heure) : les navigateurs ne mélangent jamais l'ancien cache et les nouveaux fichiers
src = os.path.join(HERE, "..", "src", "data.js"); s = open(src).read()
s = re.sub(r'export const DATA_V = "[^"]*";', f'export const DATA_V = "{datetime.datetime.utcnow():%Y%m%d%H%M}r";', s); open(src, "w").write(s)
print(f"catalogue : {n_before} → {len(items)} titres")
