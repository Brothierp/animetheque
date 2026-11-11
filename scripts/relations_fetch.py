# Récupère les liens entre animés (suite, préquelle, film dérivé…) et les dates de début depuis l'API AniList.
# Usage : python3 relations_fetch.py ../public/data.json relations_raw.json   (reprend là où il s'était arrêté)
import json, sys, time, os, urllib.request
ids = [x[0] for x in json.load(open(sys.argv[1]))["items"]]
OUT = sys.argv[2]
out = json.load(open(OUT)) if os.path.exists(OUT) else {}
Q = "query($ids:[Int]){ Page(perPage:50){ media(id_in:$ids, type:ANIME){ id startDate{ year month day } relations{ edges{ relationType node{ id type } } } } } }"
todo = [ids[i:i+50] for i in range(0, len(ids), 50)]
for bi, b in enumerate(todo):
    if all(str(i) in out for i in b): continue
    for attempt in range(8):
        req = urllib.request.Request("https://graphql.anilist.co", data=json.dumps({"query": Q, "variables": {"ids": b}}).encode(),
            headers={"Content-Type": "application/json", "Accept": "application/json", "User-Agent": "animetheque-catalogue-builder"})
        try:
            d = json.load(urllib.request.urlopen(req, timeout=60))
            for m in d["data"]["Page"]["media"]:
                out[str(m["id"])] = {"d": m["startDate"], "r": [[e["relationType"], e["node"]["id"]] for e in m["relations"]["edges"] if e["node"]["type"] == "ANIME"]}
            for i in b: out.setdefault(str(i), {"d": {}, "r": []})
            time.sleep(2.2); break
        except urllib.error.HTTPError as e:
            w = int(e.headers.get("Retry-After") or 30) + 2; print(f"lot {bi}: HTTP {e.code}, pause {w}s", flush=True); time.sleep(w)
        except Exception as e:
            print(f"lot {bi}: {e}", flush=True); time.sleep(10)
    if bi % 20 == 0:
        json.dump(out, open(OUT, "w")); print(f"{bi+1}/{len(todo)}", flush=True)
json.dump(out, open(OUT, "w")); print("TERMINÉ", len(out), flush=True)
