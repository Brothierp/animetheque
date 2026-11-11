# Récupère les personnages (25 par animé) depuis l'API AniList, par lots de 50 animés, en respectant la limite de débit.
import json, sys, time, gzip, os, urllib.request
# Usage (depuis un dossier de travail) : python3 characters_fetch.py ../public/data.json
# Écrit les réponses brutes dans raw/NNNN.json.gz ; relancer le script reprend là où il s'était arrêté.
ids = [x[0] for x in json.load(open(sys.argv[1]))["items"]]
Q = """query($ids:[Int]){ Page(perPage:50){ media(id_in:$ids, type:ANIME){ id characters(perPage:25, sort:[ROLE,RELEVANCE,ID]){ edges{ role node{ id name{full native alternative} image{medium} gender age bloodType dateOfBirth{month day} favourites description } } } } } }"""
os.makedirs("raw", exist_ok=True)
batches = [ids[i:i+50] for i in range(0, len(ids), 50)]
for bi, b in enumerate(batches):
    out = f"raw/{bi:04d}.json.gz"
    if os.path.exists(out): continue
    for attempt in range(8):
        body = json.dumps({"query": Q, "variables": {"ids": b}}).encode()
        req = urllib.request.Request("https://graphql.anilist.co", data=body, headers={"Content-Type": "application/json", "Accept": "application/json", "User-Agent": "animetheque-catalogue-builder"})
        try:
            r = urllib.request.urlopen(req, timeout=90); d = json.load(r)
            if "errors" in d: raise RuntimeError(str(d["errors"])[:200])
            with gzip.open(out + ".tmp", "wt") as f: json.dump(d["data"]["Page"]["media"], f)
            os.replace(out + ".tmp", out)
            rem = int(r.headers.get("X-RateLimit-Remaining") or 1)
            time.sleep(2.1 if rem > 3 else 20)
            break
        except urllib.error.HTTPError as e:
            wait = int(e.headers.get("Retry-After") or 30) + 2
            print(f"lot {bi}: HTTP {e.code}, attente {wait}s", flush=True); time.sleep(wait)
        except Exception as e:
            print(f"lot {bi}: erreur {e}, nouvel essai", flush=True); time.sleep(10)
    else:
        print(f"lot {bi}: ABANDON", flush=True)
    if bi % 25 == 0: print(f"{bi+1}/{len(batches)} lots", flush=True)
print("TERMINÉ", flush=True)
