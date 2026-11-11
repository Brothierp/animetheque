# Regroupe les animés en franchises et calcule l'ordre de visionnage à partir des liens AniList.
# Usage : python3 franchises_build.py public/data.json relations_raw.json public/franchises.json
#
# - Franchise = animés reliés par suite / préquelle / histoire parallèle / récapitulatif / version alternative /
#   œuvre mère / spin-off (les liens « personnage commun » et « autre » sont ignorés : ils relient des univers sans rapport).
# - Ligne principale = la chaîne suite/préquelle qui contient le titre le plus populaire, triée par date.
# - Le reste est classé : histoire parallèle, spin-off, récapitulatif, version alternative, bonus.
import json, sys, collections
DATA, REL, OUT = sys.argv[1:4]
items = json.load(open(DATA))["items"]
rel = json.load(open(REL))
idx = {x[0]: i for i, x in enumerate(items)}
FMT = json.load(open(DATA))["tables"]["format"]

GROUP = {"SEQUEL", "PREQUEL", "PARENT", "SIDE_STORY", "SUMMARY", "ALTERNATIVE", "SPIN_OFF", "COMPILATION", "CONTAINS"}
MAIN = {"SEQUEL", "PREQUEL"}
adj = collections.defaultdict(set); main_adj = collections.defaultdict(set); kind_hint = {}
for sid, info in rel.items():
    a = idx.get(int(sid))
    if a is None: continue
    for t, oid in info["r"]:
        b = idx.get(oid)
        if b is None or b == a or t not in GROUP: continue
        adj[a].add(b); adj[b].add(a)
        if t in MAIN: main_adj[a].add(b); main_adj[b].add(a)
        # nature de b vue depuis a
        k = {"SIDE_STORY": 1, "SPIN_OFF": 2, "SUMMARY": 3, "ALTERNATIVE": 4, "COMPILATION": 3}.get(t)
        if k: kind_hint.setdefault(b, k)

def date(i):
    d = rel.get(str(items[i][0]), {}).get("d") or {}
    y = d.get("year") or items[i][11] or 9999
    return (y, d.get("month") or 13, d.get("day") or 32, i)

seen = set(); franchises = []
for start in range(len(items)):
    if start in seen or start not in adj: continue
    comp, stack = [], [start]; seen.add(start)
    while stack:
        n = stack.pop(); comp.append(n)
        for m in adj[n]:
            if m not in seen: seen.add(m); stack.append(m)
    if len(comp) < 2: continue
    # ligne principale : chaîne suite/préquelle autour du titre (série ou film) le plus populaire
    root = min(comp, key=lambda i: (FMT[items[i][6]] not in ("TV", "TV_SHORT", "ONA", "MOVIE") if items[i][6] >= 0 else True, i))
    main, st = {root}, [root]
    while st:
        n = st.pop()
        for m in main_adj[n]:
            if m in comp and m not in main: main.add(m); st.append(m)
    order = sorted(comp, key=date)
    # les autres chaînes suite/préquelle héritent de la nature de leur premier membre classé (ex. série alternative + son film)
    chain_kind, done = {}, set(main)
    for i in order:
        if i in done: continue
        ch, st2 = [i], [i]; done.add(i)
        while st2:
            n = st2.pop()
            for m in main_adj[n]:
                if m in comp and m not in done: done.add(m); ch.append(m); st2.append(m)
        k = next((kind_hint[m] for m in sorted(ch, key=date) if m in kind_hint), None)
        if k: 
            for m in ch: chain_kind[m] = k
    kinds = {}
    for i in order:
        f = FMT[items[i][6]] if items[i][6] >= 0 else ""
        if i in main and f not in ("SPECIAL", "MUSIC") and kind_hint.get(i) not in (3,): kinds[i] = 0
        elif f in ("SPECIAL", "MUSIC") and kind_hint.get(i) not in (3,): kinds[i] = 5 if i in main else kind_hint.get(i, chain_kind.get(i, 5))
        else: kinds[i] = kind_hint.get(i, chain_kind.get(i, 5))
    franchises.append([[i, kinds[i]] for i in order])

franchises.sort(key=lambda f: min(i for i, _ in f))
json.dump({"f": franchises}, open(OUT, "w"), separators=(",", ":"))
sizes = collections.Counter(len(f) for f in franchises)
print(len(franchises), "franchises ;", sum(len(f) for f in franchises), "titres groupés ; plus grande :", max(len(f) for f in franchises))
def show(title):
    for f in franchises:
        names = [(items[i][3] or items[i][2]) for i, _ in f]
        if any(title.lower() == n.lower() for n in names):
            print("\n==", title)
            for i, k in f: print("  ", "★" if k == 0 else ["", "parallèle", "spin-off", "récap", "alternative", "bonus"][k], "|", items[i][11], FMT[items[i][6]] if items[i][6] >= 0 else "", "|", items[i][3] or items[i][2])
            return
for t in sys.argv[4:]: show(t)
