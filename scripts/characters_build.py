# Construit public/characters.json à partir des réponses AniList (raw/*.json.gz) :
# personnages uniques, image, apparitions (animé + rôle) et étiquettes françaises déduites des données.
import json, gzip, glob, re, sys, collections

# Usage (dans le dossier de travail de characters_fetch.py) :
#   python3 characters_build.py ../public/data.json ../public/characters.json
# Produit aussi public/characters-top.json (accueil) et public/cshards/*.json (visages par animé).
DATA = sys.argv[1]           # public/data.json (pour l'ordre des animés)
OUT = sys.argv[2]            # public/characters.json
items = json.load(open(DATA))["items"]
idx_of = {x[0]: i for i, x in enumerate(items)}

COLORS = {  # anglais → (cheveux, yeux)
  "black": ("Cheveux noirs", "Yeux noirs"), "dark": ("Cheveux noirs", None), "blonde": ("Cheveux blonds", None), "blond": ("Cheveux blonds", None),
  "golden": ("Cheveux blonds", "Yeux dorés"), "gold": ("Cheveux blonds", "Yeux dorés"), "yellow": ("Cheveux blonds", "Yeux dorés"), "amber": (None, "Yeux dorés"),
  "brown": ("Cheveux bruns", "Yeux marron"), "chestnut": ("Cheveux bruns", None), "red": ("Cheveux roux", "Yeux rouges"), "crimson": ("Cheveux roux", "Yeux rouges"),
  "scarlet": ("Cheveux roux", "Yeux rouges"), "ginger": ("Cheveux roux", None), "orange": ("Cheveux orange", "Yeux orange"),
  "white": ("Cheveux blancs", None), "silver": ("Cheveux argentés", "Yeux argentés"), "grey": ("Cheveux gris", "Yeux gris"), "gray": ("Cheveux gris", "Yeux gris"),
  "pink": ("Cheveux roses", "Yeux roses"), "blue": ("Cheveux bleus", "Yeux bleus"), "teal": ("Cheveux bleus", "Yeux bleus"), "cyan": ("Cheveux bleus", "Yeux bleus"),
  "green": ("Cheveux verts", "Yeux verts"), "emerald": (None, "Yeux verts"), "purple": ("Cheveux violets", "Yeux violets"), "violet": ("Cheveux violets", "Yeux violets"),
  "lavender": ("Cheveux violets", "Yeux violets"),
}
COLOR_RE = "|".join(sorted(COLORS, key=len, reverse=True))
HAIR_RE = re.compile(rf"\b(?:light|dark|pale|bright|long|short|messy|spiky|wavy|curly|straight|shoulder-length)?[\s-]*\b({COLOR_RE})(?:ish)?(?:[\s-](?:colou?red))?[\s-]+(?:hair(?:ed)?)\b", re.I)
EYES_RE = re.compile(rf"\b({COLOR_RE})(?:ish)?[\s-]+eyes?\b", re.I)

# Espèces / natures et métiers / rôles : recherchés dans les champs structurés ou dans « is a … X ».
SPECIES = [("Démon", r"demons?|devil|oni|akuma"), ("Vampire", r"vampires?"), ("Elfe", r"(?:dark |high )?elf|elves"), ("Robot / androïde", r"robot|android|cyborg|automaton|artificial human|ai|artificial intelligence"),
  ("Dieu / déesse", r"god|goddess|deity|divine being"), ("Ange", r"angel|archangel"), ("Fantôme / esprit", r"ghost|spirit|phantom|specter|spectre"),
  ("Dragon", r"dragon"), ("Extraterrestre", r"alien|extraterrestrial"), ("Homme-bête / kemonomimi", r"beast ?man|beastkin|beast-man|catgirl|cat girl|cat-girl|fox girl|wolf ?girl|kemonomimi|half-beast|werewolf|werecat"),
  ("Yōkai", r"youkai|yokai|yōkai|ayakashi"), ("Shinigami", r"shinigami|death god|soul reaper|grim reaper"), ("Fée", r"fairy|fairies"), ("Sirène", r"mermaid|siren"),
  ("Zombie", r"zombie|undead|ghoul"), ("Titan", r"titan shifter|titan"), ("Monstre", r"monster|kaiju|beast"), ("Humain artificiel / homonculus", r"homunculus|clone|artificial being"),
  ("Sorcière", r"witch"), ("Slime", r"slime"), ("Animal", r"cat|dog|fox|rabbit|bird|penguin|bear|wolf|hamster|mascot")]
JOBS = [("Lycéen·ne", r"high[- ]school (?:student|girl|boy)|(?:first|second|third)[- ]year (?:high[- ]school )?student"), ("Élève", r"student|pupil|schoolgirl|schoolboy"),
  ("Collégien·ne", r"middle[- ]school (?:student|girl|boy)"), ("Étudiant·e", r"university student|college student"),
  ("Professeur·e", r"teacher|professor|instructor|homeroom teacher|sensei"), ("Samouraï", r"samurai|ronin|rōnin"), ("Ninja", r"ninja|shinobi|kunoichi"),
  ("Épéiste", r"swordsman|swordswoman|swordsmen|swordmaster|sword master|fencer|kendoka"), ("Mage", r"(?:arch)?mage|magician|(?:arch)?wizard|sorcerer|sorceress|magus|warlock|spellcaster|magical girl|witch"),
  ("Chevalier", r"knight|paladin"), ("Pirate", r"pirate"), ("Détective", r"detective|investigator"), ("Idol", r"idol"), ("Princesse / prince", r"princess|prince"),
  ("Roi / reine", r"king|queen|emperor|empress|monarch"), ("Soldat", r"soldier|lieutenant|sergeant|military officer|army officer|private first class"), ("Assassin", r"assassin|hitman|killer"),
  ("Médecin", r"doctor|physician|surgeon|nurse|medic"), ("Scientifique", r"scientist|researcher|inventor|engineer"), ("Hacker", r"hacker"), ("Chasseur", r"hunter"),
  ("Héros", r"hero|heroine"), ("Domestique", r"maid|butler|servant"), ("Pilote", r"pilot"), ("Cuisinier·ère", r"chef|cook"), ("Policier·ère", r"police officer|policeman|policewoman|cop"),
  ("Musicien·ne", r"musician|guitarist|bassist|drummer|pianist|vocalist|singer|violinist"), ("Aventurier·ère", r"adventurer"), ("Délinquant·e", r"delinquent|yankee|thug|gang member"),
  ("Yakuza", r"yakuza"), ("Mangaka / artiste", r"mangaka|manga artist|artist|painter|illustrator"), ("Sportif·ve", r"athlete|player|swimmer|runner|boxer|wrestler|volleyball|basketball|baseball|soccer|football|tennis"),
  ("Mercenaire", r"mercenary"), ("Prêtre / prêtresse", r"priest|priestess|shrine maiden|miko|nun|monk"), ("Voleur·se", r"thief|bandit|burglar"),
  ("Combattant·e", r"fighter|martial artist|warrior"), ("Président·e du conseil des élèves", r"student council president"), ("Exorciste", r"exorcist"), ("Espion·ne", r"spy|secret agent"),
  ("Chef de clan / leader", r"leader|boss|captain|commander|head of the"), ("Otaku", r"otaku|gamer")]
PERSO = [("Tsundere", r"tsundere"), ("Yandere", r"yandere"), ("Kuudere", r"kuudere"), ("Dandere", r"dandere"), ("Génie", r"genius|prodigy"),
  ("Timide", r"\bshy\b|timid"), ("Joyeux·se", r"cheerful|energetic|bubbly"), ("Paresseux·se", r"\blazy\b"), ("Froid·e / stoïque", r"\bstoic\b|emotionless|cold and|aloof"),
  ("Orphelin·e", r"\borphan"), ("Antagoniste", r"\bantagonist|\bvillain\b"), ("Gourmand·e", r"gluttonous|glutton|loves to eat|big appetite")]
PHYS = [("Lunettes", r"glasses|spectacles"), ("Cicatrice", r"\bscars?\b"), ("Hétérochromie", r"heterochromi"), ("Oreilles d'animal", r"(?:cat|fox|wolf|dog|rabbit|bunny|animal) ears"),
  ("Cache-œil", r"eye ?patch"), ("Queue", r"\btails?\b(?! of)"), ("Ailes", r"\bwings\b"), ("Cornes", r"\bhorns\b"), ("Tatouage", r"tattoo")]

ZODIAC = [((1, 20), "Capricorne"), ((2, 19), "Verseau"), ((3, 21), "Poissons"), ((4, 20), "Bélier"), ((5, 21), "Taureau"), ((6, 21), "Gémeaux"),
  ((7, 23), "Cancer"), ((8, 23), "Lion"), ((9, 23), "Vierge"), ((10, 23), "Balance"), ((11, 22), "Scorpion"), ((12, 22), "Sagittaire"), ((12, 32), "Capricorne")]
def zodiac(m, d):
    for (mm, dd), name in ZODIAC:
        if (m, d) < (mm, dd): return name
    return "Capricorne"

CATS = ["Genre", "Âge", "Rôle dans l'histoire", "Cheveux", "Yeux", "Physique", "Espèce", "Métier / statut", "Personnalité", "Signe", "Groupe sanguin"]

def strip_md(t):
    t = re.sub(r"~!.*?!~", " ", t or "", flags=re.S)          # spoilers ignorés pour les étiquettes
    t = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", t)              # liens → texte
    return t
def struct_fields(t):
    f = {}
    for k, v in re.findall(r"__([^_\n]{2,40}?):?__:?\s*([^\n]+)", t): f[k.strip(" :").lower()] = v.strip()
    return f
def first_prose(t, n=700):
    lines = [l for l in t.split("\n") if l.strip() and not re.match(r"\s*(__|\*\*|- )", l)]
    return " ".join(lines)[:n]

def tags_for(c):
    out = set()
    g = (c.get("gender") or "").lower()
    if g.startswith("male") and "female" not in g: out.add(("Genre", "Homme"))
    elif g.startswith("female"): out.add(("Genre", "Femme"))
    elif g: out.add(("Genre", "Non-binaire / autre"))
    a = re.search(r"\d+", c.get("age") or "")
    if a:
        n = int(a.group())
        out.add(("Âge", "Enfant (moins de 13 ans)" if n < 13 else "Ado (13-17 ans)" if n < 18 else "Jeune adulte (18-25 ans)" if n < 26
                 else "Adulte (26-59 ans)" if n < 60 else "Senior (60 ans et +)" if n < 100 else "Centenaire / immortel"))
    dob = c.get("dateOfBirth") or {}
    if dob.get("month") and dob.get("day"): out.add(("Signe", zodiac(dob["month"], dob["day"])))
    bt = (c.get("bloodType") or "").upper().replace(" ", "")
    if bt in ("A", "B", "AB", "O"): out.add(("Groupe sanguin", "Groupe " + bt))
    raw = c.get("description") or ""
    t = strip_md(raw); f = struct_fields(t); prose = first_prose(t)
    h = f.get("height", "")
    hs = [float(x) for x in re.findall(r"\d{2,3}(?:\.\d)?", h) if 60 <= float(x) <= 300] if "cm" in h else []
    if hs:
        if min(hs) >= 180: out.add(("Physique", "Grand·e (1,80 m et +)"))
        elif max(hs) <= 155: out.add(("Physique", "Petit·e (1,55 m et -)"))
    # cheveux / yeux : champs dédiés, sinon première mention dans le texte
    for key, rx, slot, cat in (("hair", HAIR_RE, 0, "Cheveux"), ("eye", EYES_RE, 1, "Yeux")):
        src = next((v for k, v in f.items() if key in k and "colo" in k), None)
        mm = re.search(rf"\b({COLOR_RE})\b", src, re.I) if src else rx.search(t)
        if mm:
            lab = COLORS[mm.group(1).lower()][slot]
            if lab: out.add((cat, lab))
    # espèce : champ « race / species », sinon « is a … X » au début du texte
    sp_src = " ".join(v for k, v in f.items() if k in ("race", "species", "classification", "type", "kind"))
    for lab, rx in SPECIES:
        if (sp_src and re.search(rf"\b(?:{rx})s?\b", sp_src, re.I)) or re.search(rf"\b(?:is|was) (?:an?|a former) (?:[\w'-]+ ){{0,2}}(?:{rx})\b(?!['-]| (?:slayer|hunter|king|lord|fox|beast|army|world|realm|tribe|clan|lord|god|summoner|tamer|race))", prose, re.I):
            if lab == "Animal" and re.search(r"\b(?:human|girl|boy|man|woman)\b", sp_src, re.I): continue
            out.add(("Espèce", lab))
    job_src = " ".join(v for k, v in f.items() if k in ("occupation", "occupations", "position", "class", "job", "profession", "title", "rank"))
    for lab, rx in JOBS:
        if (job_src and re.search(rf"\b(?:{rx})s?\b", job_src, re.I)) or re.search(rf"\b(?:is|was|becomes|became) (?:an?|the|a former|one of the) (?:[\w'-]+ ){{0,4}}(?:{rx})s?\b(?!['’]s| party| club| team| association)", prose, re.I):
            out.add(("Métier / statut", lab))
    if ("Métier / statut", "Lycéen·ne") in out or ("Métier / statut", "Collégien·ne") in out or ("Métier / statut", "Étudiant·e") in out: out.discard(("Métier / statut", "Élève"))
    if ("Espèce", "Sorcière") in out: out.add(("Métier / statut", "Mage"))
    # appartenance à un groupe : « captain / member of the … Pirates », village ninja, etc.
    for lab, rx in (("Pirate", r"\bof the (?:[\w'-]+ ){0,3}pirates\b|\bpirate (?:crew|captain)\b"), ("Ninja", r"\bninja (?:village|academy)\b|\bshinobi of\b"),
                    ("Chevalier", r"\bknights? of the\b"), ("Soldat", r"\bmember of the (?:[\w'-]+ ){0,3}(?:army|military|corps|regiment)\b")):
        if re.search(rx, prose, re.I): out.add(("Métier / statut", lab))
    for lab, rx in PERSO:
        if re.search(rx, prose, re.I): out.add(("Personnalité", lab))
    for lab, rx in PHYS:
        if re.search(rf"(?:wears?|wearing|has|having|with|sports?) (?:[\w'-]+ ){{0,3}}(?:{rx})", t, re.I): out.add(("Physique", lab))
    return out

chars = {}                    # id → données
apps = collections.defaultdict(list)
for fn in sorted(glob.glob("raw/*.json.gz")):
    for m in json.load(gzip.open(fn)):
        ai = idx_of.get(m["id"])
        if ai is None: continue
        for e in m["characters"]["edges"]:
            c = e["node"]
            if c["id"] not in chars: chars[c["id"]] = c
            role = {"MAIN": "M", "SUPPORTING": "S", "BACKGROUND": "B"}.get(e["role"], "B")
            if not any(x[0] == ai for x in apps[c["id"]]): apps[c["id"]].append([ai, role])

tagset = collections.Counter(); per = {}
for cid, c in chars.items():
    ts = tags_for(c)
    roles = {r for _, r in apps[cid]}
    ts.add(("Rôle dans l'histoire", "Personnage principal" if "M" in roles else "Personnage secondaire" if "S" in roles else "Figurant"))
    per[cid] = ts
    for t in ts: tagset[t] += 1
# n'indexe que les étiquettes portées par au moins 5 personnages
tags = sorted([t for t, n in tagset.items() if n >= 5], key=lambda t: (CATS.index(t[0]), -tagset[t]))
tix = {t: i for i, t in enumerate(tags)}
IMG = "https://s4.anilist.co/file/anilistcdn/character/medium/"
rows = []
for cid, c in sorted(chars.items(), key=lambda kv: -(kv[1].get("favourites") or 0)):
    img = c["image"]["medium"] or ""
    img = "" if "default" in img else img.replace(IMG, "") if img.startswith(IMG) else img
    img = re.sub(rf"^([a-z]?){cid}-", r"\1~", img)        # l'identifiant est déjà connu : « b40882-xx.jpg » → « b~xx.jpg »
    nm = c["name"]
    alt = [a for a in (nm.get("alternative") or []) if a and len(a) <= 40][:3]
    fav = c.get("favourites") or 0
    if not img and not fav and all(r == "B" for _, r in apps[cid]): continue     # figurant sans image ni fan : inutile
    R = {"M": 0, "S": 1, "B": 2}
    rows.append([cid, nm.get("full") or "", nm.get("native") or "", img, fav,
                 sorted(tix[t] for t in per[cid] if t in tix), [ai * 4 + R[r] for ai, r in sorted(apps[cid], key=lambda x: x[0])], alt])
# Deux fichiers : les 3 000 plus aimés (affichage immédiat), puis tous les autres (chargés en arrière-plan).
FIRST = 3000
out = {"img": IMG, "cats": CATS, "tags": [[CATS.index(t[0]), t[1], tagset[t]] for t in tags], "total": len(rows), "chars": rows[:FIRST]}
json.dump(out, open(OUT, "w"), ensure_ascii=False, separators=(",", ":"))
json.dump({"chars": rows[FIRST:]}, open(OUT.replace(".json", "-more.json"), "w"), ensure_ascii=False, separators=(",", ":"))
# visages par animé, découpés en 64 fichiers (fiche d'un animé sans charger l'index complet)
import os
SH = 64
shard_dir = os.path.join(os.path.dirname(OUT), "cshards"); os.makedirs(shard_dir, exist_ok=True)
by_anime = collections.defaultdict(list)
for r in rows:
    for v in r[6]: by_anime[v // 4].append((v & 3, r[0], r[1] or r[2], r[3]))
shards = [dict() for _ in range(SH)]
for ai, L in by_anime.items():
    L.sort(key=lambda x: x[0])      # principaux d'abord (l'ordre de popularité est conservé à rôle égal)
    shards[ai % SH][ai] = [[cid, name, img, role] for role, cid, name, img in L]
for i, sh in enumerate(shards):
    json.dump({"img": IMG, "a": sh}, open(os.path.join(shard_dir, f"{i}.json"), "w"), ensure_ascii=False, separators=(",", ":"))
# petit fichier pour l'accueil : les 40 personnages les plus aimés (avec image), apparition principale
top = [[r[0], r[1], r[2], r[3], r[4], [x for x in r[6] if not items[x // 4][22]][:3]] for r in rows if r[3] and any(not items[x // 4][22] for x in r[6])][:40]
json.dump({"img": IMG, "chars": top}, open(OUT.replace(".json", "-top.json"), "w"), ensure_ascii=False, separators=(",", ":"))
print(len(rows), "personnages,", len(tags), "étiquettes")
by = collections.Counter()
for r in rows:
    for c in {tags[i][0] for i in r[5]}: by[c] += 1
print("couverture par catégorie :", {k: f"{v*100//len(rows)}%" for k, v in by.most_common()})
