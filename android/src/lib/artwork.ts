import type { RemoteTrack } from './types';

// The old cache stored temporary errors and unverified image URLs forever.
const CACHE_PREFIX = 'napstrfy-artwork:v2:';
export const ARTWORK_RETRY_MS = 60_000;
const REQUEST_TIMEOUT = 12_000;
type CacheEntry = { url: string; expires: number };
type Lookup = { priority: boolean; promise: Promise<string> };
type Credit = { name?: string; artist?: { name?: string } };
type Release = {
  id?: string; title?: string; status?: string; date?: string;
  'artist-credit'?: Credit[];
  'release-group'?: { id?: string; 'primary-type'?: string; 'secondary-types'?: string[] };
};
const memory = new Map<string, CacheEntry>();
const pending = new Map<string, Lookup>();
const searches: { priority: () => boolean; run: () => Promise<void> }[] = [];
let searching = false;
let nextLookup = 0;

function normalize(value: string) {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

function keyFor(kind: string, artist: string, name: string) {
  return JSON.stringify([kind, normalize(artist), normalize(name)]);
}

function readCache(key: string): string | null {
  try {
    const entry = memory.get(key) ?? JSON.parse(window.localStorage.getItem(CACHE_PREFIX + key) ?? 'null');
    if (entry && typeof entry.url === 'string' && entry.expires > Date.now()) return entry.url;
  } catch { /* Storage is optional. */ }
  return null;
}

function writeCache(key: string, url: string) {
  const entry = { url, expires: Date.now() + (url ? 30 * 24 * 60 * 60_000 : ARTWORK_RETRY_MS) };
  memory.set(key, entry);
  try { window.localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry)); }
  catch { /* A full or unavailable cache must not affect playback. */ }
}

function cachedLookup(key: string, priority: boolean, find: (priority: () => boolean) => Promise<string>): Promise<string> {
  const cached = readCache(key);
  if (cached !== null) return Promise.resolve(cached);
  const existing = pending.get(key);
  if (existing) {
    existing.priority ||= priority;
    return existing.promise;
  }
  const lookup: Lookup = { priority, promise: Promise.resolve('') };
  lookup.promise = Promise.resolve().then(() => find(() => lookup.priority))
    .catch(() => '').then((url) => { writeCache(key, url); return url; })
    .finally(() => pending.delete(key));
  pending.set(key, lookup);
  return lookup.promise;
}

async function drainSearches() {
  if (searching) return;
  searching = true;
  try {
    while (searches.length) {
      const wait = Math.max(0, nextLookup - Date.now());
      if (wait) await new Promise((resolve) => window.setTimeout(resolve, wait));
      // Choose after waiting, so the current song can overtake queued thumbnails.
      const index = searches.findIndex((job) => job.priority());
      const job = searches.splice(Math.max(0, index), 1)[0];
      nextLookup = Date.now() + 1100;
      await job.run();
    }
  } finally { searching = false; }
}

function search<T>(entity: string, query: string, priority: () => boolean): Promise<T> {
  return new Promise((resolve, reject) => {
    searches.push({ priority, run: async () => {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
      try {
        const response = await fetch(`https://musicbrainz.org/ws/2/${entity}/?fmt=json&limit=25&query=${encodeURIComponent(query)}`, { signal: controller.signal });
        if (!response.ok) {
          if (response.status === 429 || response.status === 503) {
            const retry = Number(response.headers.get('Retry-After')) || 60;
            nextLookup = Math.max(nextLookup, Date.now() + Math.max(1, retry) * 1000);
          }
          throw new Error('artwork lookup failed');
        }
        resolve(await response.json() as T);
      } catch (error) { reject(error); }
      finally { window.clearTimeout(timer); }
    } });
    void drainSearches();
  });
}

function loadCover(url: string) {
  return cachedLookup(url, false, () => new Promise<string>((resolve) => {
    const image = new Image();
    const finish = (loaded: boolean) => {
      window.clearTimeout(timer);
      image.onload = image.onerror = null;
      if (!loaded) image.src = '';
      resolve(loaded ? url : '');
    };
    const timer = window.setTimeout(() => finish(false), REQUEST_TIMEOUT);
    image.onload = () => finish(true);
    image.onerror = () => finish(false);
    image.src = url;
  }));
}

function sameArtist(credits: Credit[] = [], artist: string) {
  return credits.some((credit) => normalize(credit.name ?? '') === normalize(artist)
    || normalize(credit.artist?.name ?? '') === normalize(artist));
}

async function coverForReleases(releases: Release[]) {
  const urls = new Set<string>();
  const mbid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  // An album group can have a cover even when the first regional edition does not.
  for (const kind of ['release-group', 'release'] as const) {
    for (const release of releases) {
      const id = kind === 'release' ? release.id : release['release-group']?.id;
      if (id && mbid.test(id)) urls.add(`https://coverartarchive.org/${kind}/${id}/front-250`);
      if (urls.size >= (kind === 'release-group' ? 3 : 6)) break;
    }
  }
  for (const url of urls) {
    const cover = await loadCover(url);
    if (cover) return cover;
  }
  return '';
}

export async function artworkFor(track: RemoteTrack, priority = false): Promise<string> {
  const artist = track.artist.trim();
  if (!artist) return '';
  if (track.album.trim()) {
    const album = await cachedLookup(keyFor('album', artist, track.album), priority, async (urgent) => {
      const data = await search<{ releases?: Release[] }>('release',
        `release:${JSON.stringify(track.album.trim())} AND artist:${JSON.stringify(artist)}`, urgent);
      return coverForReleases((data.releases ?? []).filter((release) =>
        normalize(release.title ?? '') === normalize(track.album) && sameArtist(release['artist-credit'], artist)));
    });
    if (album) return album;
  }
  // Missing or folder-derived album tags (e.g. "Desktop") need the song identity.
  // Cache this separately: different tracks with the same bad album tag are not an album.
  if (!track.title.trim()) return '';
  return cachedLookup(keyFor('track', artist, track.title), priority, async (urgent) => {
    const data = await search<{ recordings?: { title?: string; 'artist-credit'?: Credit[]; releases?: Release[] }[] }>('recording',
      `recording:${JSON.stringify(track.title.trim())} AND artist:${JSON.stringify(artist)}`, urgent);
    const releases = (data.recordings ?? []).filter((recording) =>
      normalize(recording.title ?? '') === normalize(track.title) && sameArtist(recording['artist-credit'], artist))
      .flatMap((recording) => recording.releases ?? [])
      .filter((release) => release.status === 'Official' && sameArtist(release['artist-credit'], artist));
    const rank = (release: Release) => (release['release-group']?.['secondary-types']?.length ? 2 : 0)
      + (release['release-group']?.['primary-type'] === 'Album' ? 0 : 1);
    releases.sort((a, b) => rank(a) - rank(b) || (a.date || '9999').localeCompare(b.date || '9999'));
    return coverForReleases(releases);
  });
}

export function invalidateArtwork(track: RemoteTrack, url: string) {
  for (const key of [keyFor('album', track.artist, track.album), keyFor('track', track.artist, track.title), url]) {
    memory.delete(key);
    try { window.localStorage.removeItem(CACHE_PREFIX + key); } catch { /* Storage is optional. */ }
  }
}

export function artworkHue(fileId: string) {
  return Number.parseInt(fileId.slice(0, 6) || '5632aa', 16) % 360;
}
