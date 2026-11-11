# Récupère les étiquettes AniList (avec leur score de pertinence) pour une liste d'animés.
import json, sys, time, urllib.request
ids = json.load(open(sys.argv[1])); out = {}
Q = "query($ids:[Int]){ Page(perPage:50){ media(id_in:$ids, type:ANIME){ id genres tags{ name rank isMediaSpoiler isGeneralSpoiler } } } }"
for i in range(0, len(ids), 50):
    for attempt in range(6):
        req = urllib.request.Request("https://graphql.anilist.co", data=json.dumps({"query": Q, "variables": {"ids": ids[i:i+50]}}).encode(),
            headers={"Content-Type": "application/json", "Accept": "application/json", "User-Agent": "animetheque-catalogue-builder"})
        try:
            d = json.load(urllib.request.urlopen(req, timeout=60))
            for m in d["data"]["Page"]["media"]: out[m["id"]] = {"genres": m["genres"], "tags": m["tags"]}
            time.sleep(3); break
        except urllib.error.HTTPError as e:
            time.sleep(int(e.headers.get("Retry-After") or 30) + 2)
json.dump(out, open(sys.argv[2], "w"))
print(len(out), "animés")
