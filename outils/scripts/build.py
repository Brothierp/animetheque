# Construit data.json (compact, pour la page), anime.sqlite et anime.csv depuis raw.jsonl
import json, sys, re, sqlite3, csv, os, html, collections
# Usage : build.py SORTIE [--chars chars.jsonl] [--covers dossier] raw.jsonl [raw_adult.jsonl ...]
args = sys.argv[1:]; OUT = args.pop(0); CHARS_F = COVERS = None; RAWS = []
while args:
    a = args.pop(0)
    if a == '--chars': CHARS_F = args.pop(0)
    elif a == '--covers': COVERS = args.pop(0)
    else: RAWS.append(a)
ROLE = {'MAIN': 'M', 'SUPPORTING': 'S', 'BACKGROUND': 'B'}
CHARS = {}
if CHARS_F:
    for l in open(CHARS_F):
        m = json.loads(l)
        CHARS[m['id']] = [[e['node']['name'].get('full') or '', e['node']['name'].get('native') or '', ROLE.get(e['role'], 'B')]
                          for e in (m.get('characters') or {}).get('edges') or [] if e.get('node')]
os.makedirs(OUT, exist_ok=True)
# Langues probables par plateforme (sous-titres et/ou doublage). Déduction, pas une garantie.
PLAT_LANG = {
 'Crunchyroll':'EN FR','Netflix':'EN FR','Amazon Prime Video':'EN FR','Disney Plus':'EN FR','ADN':'FR',
 'Animation Digital Network':'FR','Wakanim':'FR','Anime Digital Network':'FR','Crunchyroll FR':'FR',
 'Hulu':'EN','HIDIVE':'EN','Funimation':'EN','RetroCrush':'EN','Tubi TV':'EN','Adult Swim':'EN','Max':'EN','HBO Max':'EN',
 'Hoopla':'EN','Crackle':'EN','Criterion Channel':'EN','Star+':'EN','Pluto TV':'EN','Peacock':'EN','Paramount+':'EN',
 'Bilibili TV':'EN','iQ':'EN','WeTV':'EN','YouTube':'EN','OceanVeil':'EN','Muse Asia':'EN','Ani-One Asia':'EN',
 'Ani-One':'EN','VRV':'EN','Viki':'EN','Tencent Video':'EN','Youku':'EN','Aniplus TV':'EN','Laftel':'',
 'Bandai Channel':'','Abema':'','U-NEXT':'','Niconico':'','Niconico Video':'','dAnime Store':'','Bilibili':'',
 'Kanopy':'EN','Shout! Factory TV':'EN','Midnight Pulp':'EN','Plex':'EN','The Roku Channel':'EN','Rakuten Viki':'EN',
 'Apple TV':'EN FR','Apple TV+':'EN FR','Molotov TV':'FR','France.tv':'FR','Okoo':'FR','Arte':'FR','TF1+':'FR','Mubi':'EN FR',
 'Toonami Jetstream':'EN','Prime Video':'EN FR','iQIYI':'EN','Youku TV':'EN','Coolmic':'EN','AsianCrush':'EN','Cineverse':'EN','Vimeo':'EN','Japanese Film Archives':'','Netflix Japan':'',
}
LANGMAP = {'English':'EN','French':'FR'}
# Thèmes AniList promus au rang de genre (filtrables comme les genres officiels)
PROMOTED = ['Isekai','Shounen','Shoujo','Seinen','Josei','Martial Arts','School','Historical','Military','Harem','Reverse Harem',
 'Iyashikei','Super Power','Magic','Cyberpunk','Post-Apocalyptic','Reincarnation','Survival','Space','Vampire','Samurai',
 'Video Games','Cooking','Idol','Boys\' Love','Yuri','Detective','Zombie','Demons','Mythology']

def clean_desc(s, n=320):
    if not s: return ''
    s = html.unescape(re.sub(r'<[^>]+>', ' ', s)); s = re.sub(r'\(Source:[^)]*\)', '', s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s if len(s) <= n else s[:n].rsplit(' ', 1)[0] + '…'
seen = {}; unknown = collections.Counter()
for RAW in RAWS:
    for l in open(RAW):
        m = json.loads(l); seen[m['id']] = m
rows = []
for m in seen.values():
    plats = {}; langs = set()
    for e in m.get('externalLinks') or []:
        if e['type'] != 'STREAMING': continue
        site = e['site']; lg = LANGMAP.get(e.get('language'))
        pl = PLAT_LANG.get(site)
        if pl is None: unknown[site] += 1; pl = ''
        l2 = set(pl.split()) | ({lg} if lg else set())
        if e.get('language') and e['language'] not in LANGMAP: l2 = set()  # lien régional d'une autre langue
        if l2: langs |= l2
        plats.setdefault(site, e['url'])
    t = m['title']; sd = m.get('startDate') or {}
    tags = [x['name'] for x in (m.get('tags') or []) if x['rank'] >= 60 and not x['isGeneralSpoiler'] and not x['isMediaSpoiler']][:10]
    rows.append(dict(id=m['id'], mal=m.get('idMal'), romaji=t.get('romaji') or '', english=t.get('english') or '', native=t.get('native') or '',
        synonyms=[s for s in (m.get('synonyms') or []) if len(s) < 120][:8], format=m.get('format') or '', status=m.get('status') or '',
        episodes=m.get('episodes'), duration=m.get('duration'), season=m.get('season') or '', year=m.get('seasonYear') or sd.get('year'),
        genres=(m.get('genres') or []) + [x['name'] for x in (m.get('tags') or []) if x['name'] in PROMOTED and x['rank'] >= 50], tags=tags, studios=[s['name'] for s in m['studios']['nodes']][:3],
        score=m.get('averageScore'), popularity=m.get('popularity') or 0, country=m.get('countryOfOrigin') or '', source=m.get('source') or '',
        description=clean_desc(m.get('description')), platforms=plats, langs=sorted(langs), adult=bool(m.get('isAdult'))))
rows.sort(key=lambda r: -r['popularity'])
print('adultes', sum(r['adult'] for r in rows), 'total', len(rows), 'avec FR/EN', sum(1 for r in rows if r['langs']), 'FR', sum('FR' in r['langs'] for r in rows), 'EN', sum('EN' in r['langs'] for r in rows))
print('plateformes non mappées:', unknown.most_common(60))
# --- data.json compact pour la page
def table(key):
    c = collections.Counter(x for r in rows for x in (r[key] if isinstance(r[key], (list, dict)) else [r[key]]) if x)
    return [k for k, _ in c.most_common()]
T = {k: table(k) for k in ['genres','tags','studios','platforms','format','status','season','country','source']}
idx = {k: {v: i for i, v in enumerate(T[k])} for k in T}
def ix(k, v): return idx[k].get(v, -1) if v else -1
items = []
for r in rows:
    items.append([r['id'], r['mal'] or 0, r['romaji'], r['english'], r['native'], r['synonyms'], ix('format', r['format']), ix('status', r['status']),
        r['episodes'] or 0, r['duration'] or 0, ix('season', r['season']), r['year'] or 0, [idx['genres'][g] for g in r['genres']],
        [idx['tags'][g] for g in r['tags']], [idx['studios'][g] for g in r['studios']], r['score'] or 0, r['popularity'],
        ix('country', r['country']), ix('source', r['source']), r['description'],
        [[idx['platforms'][p], u] for p, u in r['platforms'].items()], ('F' if 'FR' in r['langs'] else '') + ('E' if 'EN' in r['langs'] else ''), int(r['adult'])])
# --- Vignettes : planches WebP de 200 couvertures (10 x 20), dans l'ordre de popularité
TW, TH, COLS, PER = 96, 136, 10, 200
if COVERS:
    from PIL import Image, ImageOps
    os.makedirs(f'{OUT}/covers', exist_ok=True)
    k = 0; sheet = None
    def flush(n):
        if sheet is not None: sheet.save(f'{OUT}/covers/s{n}.webp', 'WEBP', quality=58, method=6)
    for it, r in zip(items, rows):
        fp = f"{COVERS}/{r['id']}"
        try:
            im = ImageOps.fit(Image.open(fp).convert('RGB'), (TW, TH), Image.LANCZOS)
        except Exception:
            it.append(-1); continue
        if k % PER == 0:
            flush(k // PER - 1); sheet = Image.new('RGB', (TW * COLS, TH * (PER // COLS)), (28, 22, 48))
        pos = k % PER; sheet.paste(im, ((pos % COLS) * TW, (pos // COLS) * TH)); it.append(k); k += 1
    flush((k - 1) // PER); print('vignettes', k, 'planches', (k + PER - 1) // PER)
else:
    for it in items: it.append(-1)
json.dump({'tables': T, 'items': items}, open(f'{OUT}/data.json', 'w'), ensure_ascii=False, separators=(',', ':'))
json.dump([CHARS.get(r['id'], []) for r in rows], open(f'{OUT}/chars.json', 'w'), ensure_ascii=False, separators=(',', ':'))
# --- SQLite
db = f'{OUT}/anime.sqlite'
if os.path.exists(db): os.remove(db)
c = sqlite3.connect(db)
c.executescript('''CREATE TABLE anime(id INTEGER PRIMARY KEY, mal_id INTEGER, titre_romaji TEXT, titre_anglais TEXT, titre_natif TEXT,
 format TEXT, statut TEXT, episodes INTEGER, duree_min INTEGER, saison TEXT, annee INTEGER, note INTEGER, popularite INTEGER,
 pays TEXT, source TEXT, synopsis TEXT, dispo_fr INTEGER, dispo_en INTEGER, adulte INTEGER, url_anilist TEXT);
CREATE TABLE synonyme(anime_id INTEGER, titre TEXT); CREATE TABLE genre(anime_id INTEGER, nom TEXT); CREATE TABLE tag(anime_id INTEGER, nom TEXT);
CREATE TABLE studio(anime_id INTEGER, nom TEXT); CREATE TABLE personnage(anime_id INTEGER, nom TEXT, nom_natif TEXT, role TEXT); CREATE TABLE plateforme(anime_id INTEGER, nom TEXT, url TEXT);''')
for r in rows:
    c.execute('INSERT INTO anime VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', (r['id'], r['mal'], r['romaji'], r['english'], r['native'], r['format'], r['status'],
        r['episodes'], r['duration'], r['season'], r['year'], r['score'], r['popularity'], r['country'], r['source'], r['description'],
        int('FR' in r['langs']), int('EN' in r['langs']), int(r['adult']), f"https://anilist.co/anime/{r['id']}"))
    c.executemany('INSERT INTO synonyme VALUES(?,?)', [(r['id'], s) for s in r['synonyms']])
    c.executemany('INSERT INTO genre VALUES(?,?)', [(r['id'], s) for s in r['genres']])
    c.executemany('INSERT INTO tag VALUES(?,?)', [(r['id'], s) for s in r['tags']])
    c.executemany('INSERT INTO studio VALUES(?,?)', [(r['id'], s) for s in r['studios']])
    c.executemany('INSERT INTO personnage VALUES(?,?,?,?)', [(r['id'], n, nn, {'M':'principal','S':'secondaire','B':'figurant'}[ro]) for n, nn, ro in CHARS.get(r['id'], [])])
    c.executemany('INSERT INTO plateforme VALUES(?,?,?)', [(r['id'], p, u) for p, u in r['platforms'].items()])
for t in ['synonyme','genre','tag','studio','plateforme','personnage']: c.execute(f'CREATE INDEX i_{t} ON {t}(anime_id)')
c.commit(); c.close()
# --- CSV
with open(f'{OUT}/anime.csv', 'w', newline='', encoding='utf-8-sig') as f:
    w = csv.writer(f, delimiter=';')
    w.writerow(['id_anilist','id_mal','titre_romaji','titre_anglais','titre_natif','format','statut','episodes','duree_min','saison','annee','genres','tags','studios','note','popularite','pays','source','plateformes','dispo_fr','dispo_en','adulte','personnages','synopsis'])
    for r in rows:
        w.writerow([r['id'], r['mal'] or '', r['romaji'], r['english'], r['native'], r['format'], r['status'], r['episodes'] or '', r['duration'] or '', r['season'], r['year'] or '',
            ', '.join(r['genres']), ', '.join(r['tags']), ', '.join(r['studios']), r['score'] or '', r['popularity'], r['country'], r['source'], ', '.join(r['platforms']),
            'oui' if 'FR' in r['langs'] else 'non', 'oui' if 'EN' in r['langs'] else 'non', 'oui' if r['adult'] else 'non', ', '.join(n for n, _, _ in CHARS.get(r['id'], [])), r['description']])
