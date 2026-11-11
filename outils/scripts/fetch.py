import json, sys, time, urllib.request, urllib.error, os
OUT, MAXID = sys.argv[1], int(sys.argv[2])
W = 1000
Q = """query($ids:[Int],$p:Int){Page(page:$p,perPage:50){pageInfo{hasNextPage}
media(type:ANIME,id_in:$ids,isAdult:false,sort:ID){
 id idMal title{romaji english native} synonyms format status episodes duration season seasonYear
 startDate{year month} genres tags{name rank isGeneralSpoiler isMediaSpoiler} studios(isMain:true){nodes{name}}
 averageScore popularity countryOfOrigin source description(asHtml:false) coverImage{medium}
 externalLinks{site type language url}}}}"""
done = set()
if os.path.exists(OUT + '.windows'): done = set(int(x) for x in open(OUT + '.windows').read().split())
f = open(OUT, 'a'); wf = open(OUT + '.windows', 'a')
def call(ids, p):
    while True:
        body = json.dumps({"query": Q, "variables": {"ids": ids, "p": p}}).encode()
        req = urllib.request.Request("https://graphql.anilist.co", body, {"Content-Type": "application/json", "Accept": "application/json", "User-Agent": "anime-catalog-builder/1.0"})
        try:
            d = json.load(urllib.request.urlopen(req, timeout=60))
            if d.get('data'): return d['data']['Page']
            print('gqlerr', d.get('errors'), flush=True)
        except urllib.error.HTTPError as e:
            wait = int(e.headers.get('Retry-After') or 30); print('HTTP', e.code, e.read()[:200], 'wait', wait, flush=True); time.sleep(wait + 1); continue
        except Exception as e:
            print('err', e, flush=True)
        time.sleep(15)
for start in range(1, MAXID + 1, W):
    if start in done: continue
    ids = list(range(start, start + W)); p = 1; n = 0
    while True:
        pg = call(ids, p); time.sleep(1.4)
        for m in pg['media']: f.write(json.dumps(m, ensure_ascii=False) + '\n')
        n += len(pg['media'])
        if not pg['pageInfo']['hasNextPage']: break
        p += 1
    f.flush(); wf.write(f"{start}\n"); wf.flush(); print('window', start, n, flush=True)
print('DONE', flush=True)
