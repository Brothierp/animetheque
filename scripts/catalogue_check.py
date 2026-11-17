# Contrôle après la mise à jour du catalogue : compare, titre par titre (par identifiant), la version publiée (git HEAD)
# et la nouvelle. Le retri par popularité déplace les titres, mais pour chaque titre déjà présent, l'affiche, le synopsis,
# les plateformes, la franchise et les personnages doivent rester exactement les mêmes.
# Usage : python3 scripts/catalogue_check.py   (code de sortie 1 en cas d'écart : la tâche hebdomadaire ne publie rien)
import json, os, subprocess, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
old = lambda f: json.loads(subprocess.check_output(["git", "show", "HEAD:public/" + f], cwd=ROOT))
new = lambda f: json.load(open(os.path.join(ROOT, "public", f)))

O, N = old("data.json")["items"], new("data.json")["items"]
oi = {x[0]: i for i, x in enumerate(O)}; ni = {x[0]: i for i, x in enumerate(N)}
errors = []
def err(msg):
    errors.append(msg)
    if len(errors) <= 20: print("ÉCART :", msg)

lost = set(oi) - set(ni)
if lost: err(f"{len(lost)} titres disparus : {sorted(lost)[:10]}")
STABLE = [0, 1, 2, 3, 4, 5, 6, 9, 12, 13, 14, 17, 18, 19, 20, 21, 22, 23]   # champs que la mise à jour ne change jamais
ohd, nhd = old("covers-hd.json")["c"], new("covers-hd.json")["c"]
oc, nc = old("chars.json"), new("chars.json")
od, nd, ocs, ncs = {}, {}, {}, {}
for s in range(64):
    od.update(old(f"dshards/{s}.json")); nd.update(new(f"dshards/{s}.json"))
    ocs.update(old(f"cshards/{s}.json")["a"]); ncs.update(new(f"cshards/{s}.json")["a"])
for aid, i in oi.items():
    if aid not in ni: continue
    j = ni[aid]
    if [O[i][k] for k in STABLE] != [N[j][k] for k in STABLE]: err(f"fiche {aid}")
    if ohd[i] != nhd[j]: err(f"affiche {aid}")
    if oc[i] != nc[j]: err(f"personnages (recherche) {aid}")
    if od.get(str(i)) != nd.get(str(j)): err(f"synopsis/plateformes {aid}")
    a, b = ocs.get(str(i)) or [], ncs.get(str(j)) or []
    if {r[0] for r in a} != {r[0] for r in b}: err(f"visages {aid}")
ids = lambda F, I: {tuple(sorted(I[i][0] for i, k in f)) for f in F}
fo, fn = ids(old("franchises.json")["f"], O), ids(new("franchises.json")["f"], N)
for f in fo:
    if not any(set(f) <= set(g) for g in fn): err(f"franchise {f[:4]}")
print(f"contrôle : {len(oi)} titres vérifiés, {len(ni) - len(oi)} nouveaux, {len(errors)} écart(s)")
sys.exit(1 if errors else 0)
