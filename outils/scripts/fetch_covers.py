import json, sys, os, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
OUTDIR = sys.argv[1]; jobs = []
for f in sys.argv[2:]:
    for l in open(f):
        m = json.loads(l); u = (m.get('coverImage') or {}).get('medium')
        if u and not os.path.exists(f"{OUTDIR}/{m['id']}"): jobs.append((m['id'], u))
print('to fetch', len(jobs), flush=True)
def get(job):
    i, u = job
    for k in range(4):
        try:
            d = urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent': 'anime-catalog-builder/1.0'}), timeout=30).read()
            open(f"{OUTDIR}/{i}", 'wb').write(d); return 1
        except Exception as e:
            if '404' in str(e): return 0
            time.sleep(2 * (k + 1))
    return 0
ok = 0
with ThreadPoolExecutor(12) as ex:
    for n, r in enumerate(ex.map(get, jobs)):
        ok += r
        if n % 1000 == 0: print(n, ok, flush=True)
print('DONE', ok, flush=True)
