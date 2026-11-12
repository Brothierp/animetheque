# Construit public/covers-hd.json : pour chaque animé (même ordre que data.json), le nom du fichier d'affiche AniList
# sans le préfixe répété (« bx16498-xx.jpg » → « bx~xx.jpg »), ou "" s'il n'y en a pas.
# Usage : python3 covers_build.py public/data.json covers_raw.json public/covers-hd.json
import json, re, sys
items = json.load(open(sys.argv[1]))["items"]; raw = json.load(open(sys.argv[2]))
BASE = "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/"
# + couleur dominante (« e49335 ») affichée le temps que l'image arrive
out, n = [], 0
for x in items:
    url, color = (raw.get(str(x[0])) or ["", ""])[:2]
    url = url or ""
    if not url.startswith(BASE) or "default" in url: out.append(""); continue
    out.append(re.sub(rf"^([a-z]*){x[0]}-", r"\1~", url[len(BASE):]) + ("|" + color.lstrip("#") if color else "")); n += 1
json.dump({"base": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/", "c": out}, open(sys.argv[3], "w"), separators=(",", ":"))
print(n, "affiches HD sur", len(items))
