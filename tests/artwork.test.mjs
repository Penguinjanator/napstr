import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = ts.transpile(readFileSync(new URL('../android/src/lib/artwork.ts', import.meta.url), 'utf8'),
  { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS });
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const cover = (n, kind = 'release-group') => `https://coverartarchive.org/${kind}/${id(n)}/front-250`;
const track = (album = 'Indestructible', title = 'Indestructible') => ({ artist: 'Rancid', album, title });
const credits = [{ name: 'Rancid', artist: { name: 'Rancid' } }];
const release = (n, title = 'Indestructible') => ({ id: id(n + 100), title, status: 'Official',
  'artist-credit': credits, 'release-group': { id: id(n), 'primary-type': 'Album' } });
const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };

function fixture(t, { respond = () => ({ releases: [release(1)] }), images = () => true, storage = new Map() } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100_000 });
  const requests = [], loaded = [];
  const context = vm.createContext({ exports: {}, Date, AbortController,
    window: { setTimeout: (...args) => setTimeout(...args), clearTimeout: (...args) => clearTimeout(...args),
      localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) } },
    fetch: async (url, options) => {
      requests.push({ url, at: Date.now() });
      const data = await respond(new URL(url), options);
      return { ok: true, json: async () => data, ...data };
    },
    Image: class {
      set src(url) {
        if (!url) return;
        loaded.push(url);
        const result = images(url);
        if (result !== null) Promise.resolve().then(() => result ? this.onload?.() : this.onerror?.());
      }
    }
  });
  vm.runInContext(source, context);
  return { ...context.exports, requests, loaded, storage,
    tick: async (ms) => { t.mock.timers.tick(ms); await flush(); } };
}

test('visible rows and the player share one album lookup and verified cover', async (t) => {
  const f = fixture(t);
  const work = Array.from({ length: 24 }, (_, i) => f.artworkFor(track('Indestructible', `Track ${i}`)));
  work.push(f.artworkFor(track(), true));
  assert.deepEqual(await Promise.all(work), Array(25).fill(cover(1)));
  assert.equal(f.requests.length, 1);
  assert.deepEqual(f.loaded, [cover(1)]);
  assert.equal(await f.artworkFor(track()), cover(1));
  assert.equal(f.requests.length, 1);
});

test('old permanent misses are ignored and a temporary failure is retried after expiry', async (t) => {
  let failed = true;
  const storage = new Map([['napstrfy-artwork:rancid\u0000indestructible', '']]);
  const f = fixture(t, { storage, respond: () => { if (failed) throw new Error('offline'); return { releases: [release(1)] }; } });
  const song = track('Indestructible', '');
  assert.equal(await f.artworkFor(song), '');
  failed = false;
  assert.equal(await f.artworkFor(song), '');
  assert.equal(f.requests.length, 1);
  await f.tick(60_001);
  assert.equal(await f.artworkFor(song), cover(1));
  assert.equal(f.requests.length, 2);
});

test('missing artwork on the first edition does not hide another available cover', async (t) => {
  const f = fixture(t, { respond: () => ({ releases: [release(1), release(2)] }), images: (url) => url === cover(2) });
  assert.equal(await f.artworkFor(track()), cover(2));
  assert.deepEqual(f.loaded, [cover(1), cover(2)]);
});

test('bad album tags fall back per song, preferring official studio albums over bootlegs', async (t) => {
  const f = fixture(t, { respond: (url) => url.pathname.includes('/release/') ? { releases: [] } : {
    recordings: [{ title: url.searchParams.get('query').includes('Adina') ? 'Adina' : 'Don Giovanni', 'artist-credit': credits,
      releases: [{ ...release(9), status: 'Bootleg' }, { ...release(8), 'release-group': { id: id(8), 'secondary-types': ['Live'] } },
        release(url.searchParams.get('query').includes('Adina') ? 1 : 2)] }]
  } });
  const a = f.artworkFor(track('Desktop', 'Adina'));
  const b = f.artworkFor(track('Desktop', 'Don Giovanni'));
  await flush();
  await f.tick(1100);
  await f.tick(1100);
  assert.equal(await a, cover(1));
  assert.equal(await b, cover(2));
  assert.equal(f.requests.filter(({ url }) => url.includes('/release/')).length, 1);
  assert.equal(f.requests.filter(({ url }) => url.includes('/recording/')).length, 2);
  assert.deepEqual(f.loaded, [cover(1), cover(2)]);
});

test('missing album tags still use the title; unrelated artists and titles are rejected', async (t) => {
  const f = fixture(t, { respond: () => ({ recordings: [
    { title: 'Adina', 'artist-credit': [{ name: 'Someone else' }], releases: [release(8)] },
    { title: 'Adina Live', 'artist-credit': credits, releases: [release(9)] },
    { title: 'Adina', 'artist-credit': credits, releases: [release(1)] }
  ] }) });
  assert.equal(await f.artworkFor(track('', 'Adina')), cover(1));
  assert.deepEqual(f.loaded, [cover(1)]);
});

test('now-playing lookup overtakes queued rows while keeping the MusicBrainz rate limit', async (t) => {
  const f = fixture(t, { respond: (url) => ({ releases: [release(1, /release:"(.*?)"/.exec(url.searchParams.get('query'))[1])] }) });
  const a = f.artworkFor(track('First'));
  const b = f.artworkFor(track('Second'));
  const c = f.artworkFor(track('Current'));
  await flush();
  const player = f.artworkFor(track('Current'), true);
  await f.tick(1099);
  assert.equal(f.requests.length, 1);
  await f.tick(1);
  assert.match(f.requests[1].url, /Current/);
  await f.tick(1100);
  await Promise.all([a, b, c, player]);
  assert.match(f.requests[2].url, /Second/);
  assert.deepEqual(f.requests.map((request) => request.at), [100_000, 101_100, 102_200]);
});

test('stalled metadata and images time out without blocking later albums', async (t) => {
  const f = fixture(t, { respond: (url, { signal }) => url.searchParams.get('query').includes('Stalled')
    ? new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('timeout'))))
    : { releases: [release(1)] }, images: () => null });
  const stalled = f.artworkFor(track('Stalled', ''));
  const next = f.artworkFor(track('Indestructible', ''));
  await flush();
  await f.tick(12_000);
  assert.equal(await stalled, '');
  assert.equal(f.requests.length, 2);
  await f.tick(12_000);
  await f.tick(12_000);
  assert.equal(await next, '');
});

test('a rate-limited service backs off instead of burning through the whole list', async (t) => {
  let first = true;
  const f = fixture(t, { respond: () => {
    if (first) { first = false; return { ok: false, status: 429, headers: { get: () => '30' } }; }
    return { releases: [release(1)] };
  } });
  const a = f.artworkFor(track('Busy', ''));
  const b = f.artworkFor(track('Indestructible', ''));
  await flush();
  assert.equal(await a, '');
  await f.tick(29_999);
  assert.equal(f.requests.length, 1);
  await f.tick(1);
  assert.equal(await b, cover(1));
});
