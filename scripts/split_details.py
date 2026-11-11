# Sort les liens des plateformes (champ 20 de data.json) dans public/dshards/<n>.json, à côté du synopsis :
# chaque entrée devient [synopsis, plateformes]. Dans data.json, le champ 20 devient le nombre de plateformes.
# À lancer après split_desc.py. Usage : python3 split_details.py public/data.json
import json, os, sys
DATA = sys.argv[1]; d = json.load(open(DATA)); SH = 64
if all(isinstance(x[20], int) for x in d["items"]): sys.exit("déjà fait")
dirn = os.path.join(os.path.dirname(DATA), "dshards")
old = [json.load(open(os.path.join(dirn, f"{n}.json"))) for n in range(SH)]
new = [dict() for _ in range(SH)]
for i, x in enumerate(d["items"]):
    desc = old[i % SH].get(str(i), "")
    if isinstance(desc, list): desc = desc[0]
    if desc or x[20]: new[i % SH][i] = [desc, x[20]]
    x[20] = len(x[20])
for n, sh in enumerate(new): json.dump(sh, open(os.path.join(dirn, f"{n}.json"), "w"), ensure_ascii=False, separators=(",", ":"))
json.dump(d, open(DATA, "w"), ensure_ascii=False, separators=(",", ":"))
print("ok")
