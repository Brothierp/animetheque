# Construit public/covers-hd.json : pour chaque animé (même ordre que data.json), le nom du fichier d'affiche AniList
# sans le préfixe répété (« bx16498-xx.jpg » → « bx~xx.jpg »), ou "" s'il n'y en a pas.
# Usage : python3 covers_build.py public/data.json covers_raw.json public/covers-hd.json
import json, re, sys
items = json.load(open(sys.argv[1]))["items"]; raw = json.load(open(sys.argv[2]))
ROOT = "https://s4.anilist.co/file/anilistcdn/media/anime/cover/"
# Les affiches récentes existent en « large » (≈ 460 px) ; les plus anciennes au mieux en « medium » (≈ 230 px) :
# celles-ci sont marquées d'un « * » en tête.
# + couleur dominante (« e49335 ») affichée le temps que l'image arrive
out, n = [], 0
for x in items:
    url, color = (raw.get(str(x[0])) or ["", ""])[:2]
    url = url or ""
    if "default" in url or not url.startswith(ROOT): out.append(""); continue
    size, file = url[len(ROOT):].split("/", 1)
    if size not in ("large", "medium"): out.append(""); continue
    out.append(("*" if size == "medium" else "") + re.sub(rf"^([a-z]*){x[0]}-", r"\1~", file) + ("|" + color.lstrip("#") if color else "")); n += 1
json.dump({"base": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/", "c": out}, open(sys.argv[3], "w"), separators=(",", ":"))
print(n, "affiches HD sur", len(items))
