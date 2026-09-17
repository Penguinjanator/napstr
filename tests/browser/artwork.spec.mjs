import { test, expect } from '@playwright/test';
import { mockNative, serveAudio } from './helpers/native.mjs';

test('Napstrfy artwork fills visible rows beyond 24 and the player without changing screens', async ({ page }) => {
  await mockNative(page);
  await page.route('**/fixture.wav', serveAudio);
  await page.addInitScript(() => {
    localStorage.setItem('napstrfy-artwork:rancid\u0000indestructible', '');
    localStorage.setItem('napstrfy-artwork:rancid\u0000desktop', '');
    const invoke = window.__TAURI_INTERNALS__.invoke;
    const tracks = Array.from({ length: 40 }, (_, index) => ({ fileId: index.toString(16).padStart(64, '0'),
      filename: `Song ${index}.wav`, title: index === 30 ? 'Adina' : `Song ${index}`, artist: 'Rancid',
      album: index === 30 ? 'Desktop' : 'Indestructible', format: 'WAV', mime: 'audio/wav',
      size: 1234567, tags: '', local: true, sources: [] }));
    window.__TAURI_INTERNALS__.invoke = async (cmd, args) => {
      if (cmd === 'cached_library') return { paired: true, connected: true, tracks, total: tracks.length };
      if (cmd === 'remote_library') return { tracks, total: tracks.length };
      return invoke(cmd, args);
    };
  });
  const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
  const credits = [{ name: 'Rancid' }];
  const release = (n, title) => ({ id: id(n + 100), title, status: 'Official', 'artist-credit': credits,
    'release-group': { id: id(n), 'primary-type': 'Album' } });
  const queries = [];
  await page.route('https://musicbrainz.org/**', async (route) => {
    const url = new URL(route.request().url());
    const query = url.searchParams.get('query');
    queries.push(query);
    const data = url.pathname.includes('/recording/')
      ? { recordings: [{ title: 'Adina', 'artist-credit': credits, releases: [release(3, 'Rancid')] }] }
      : { releases: query.includes('Desktop') ? [] : [release(1, 'Indestructible'), release(2, 'Indestructible')] };
    await route.fulfill({ json: data });
  });
  const art = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  await page.route('https://coverartarchive.org/**', (route) => route.request().url().includes(id(1))
    ? route.fulfill({ status: 404 }) : route.fulfill({ contentType: 'image/png', body: art }));
  await page.goto('http://127.0.0.1:15174');
  const rows = page.locator('.track-row');
  await expect(rows).toHaveCount(40);
  await expect(rows.first().locator('.artwork img')).not.toHaveClass('fallback');
  expect(queries).toHaveLength(1);
  await rows.nth(30).scrollIntoViewIfNeeded();
  await expect(rows.nth(30).locator('.artwork img')).toHaveAttribute('src', new RegExp(id(3)));
  await rows.nth(30).locator('.track-open').click();
  await expect(page.locator('.now-playing .artwork img')).toHaveAttribute('src', new RegExp(id(3)));
  await expect(page.locator('.player-backdrop span')).toHaveCSS('background-image', new RegExp(id(3)));
  expect(queries).toHaveLength(3);
});

test('Napstrfy artwork recovers from a transient lookup failure while the screen stays open', async ({ page }) => {
  await mockNative(page);
  await page.clock.install();
  let online = false;
  let lookups = 0;
  await page.route('https://musicbrainz.org/**', (route) => {
    lookups++;
    return route.fulfill(online ? { json: { releases: [{ id: '00000000-0000-0000-0000-000000000001',
      title: 'User album', 'artist-credit': [{ name: 'Settings' }] }] } } : { status: 500 });
  });
  await page.route('https://coverartarchive.org/**', (route) => route.fulfill({ contentType: 'image/png',
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') }));
  await page.goto('http://127.0.0.1:15174');
  await expect.poll(() => lookups).toBe(1);
  await page.clock.runFor(1200);
  await expect.poll(() => lookups).toBe(2);
  await expect(page.locator('.track-row .artwork img')).toHaveClass('fallback');
  // Let the failed title request settle before advancing its retry timer.
  await page.waitForTimeout(100);
  online = true;
  await page.clock.runFor(61_000);
  await expect(page.locator('.track-row .artwork img')).not.toHaveClass('fallback');
  expect(lookups).toBe(3);
});

