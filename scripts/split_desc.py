# Sort les synopsis de data.json (≈ la moitié de son poids) dans public/dshards/<n>.json (n = index % 64),
# chargés à la demande à l'ouverture d'une fiche. Dans data.json, le champ 19 devient 1 (synopsis disponible) ou 0.
# Usage : python3 split_desc.py public/data.json   (sans effet si c'est déjà fait)
import json, os, sys
DATA = sys.argv[1]
d = json.load(open(DATA))
if all(isinstance(x[19], int) for x in d["items"]): sys.exit("déjà découpé")
SH = 64; shards = [dict() for _ in range(SH)]
for i, x in enumerate(d["items"]):
    if x[19]: shards[i % SH][i] = x[19]
    x[19] = 1 if x[19] else 0
out = os.path.join(os.path.dirname(DATA), "dshards"); os.makedirs(out, exist_ok=True)
for n, sh in enumerate(shards): json.dump(sh, open(os.path.join(out, f"{n}.json"), "w"), ensure_ascii=False, separators=(",", ":"))
json.dump(d, open(DATA, "w"), ensure_ascii=False, separators=(",", ":"))
print("ok")
