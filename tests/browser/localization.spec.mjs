import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { languages, direction } from '../../shared/i18n/core.js';
const catalogs = Object.fromEntries(await Promise.all(languages.map(async ({ code }) => [code, JSON.parse(await readFile(new URL(`../../shared/i18n/locales/${code}.json`, import.meta.url)))])));

async function mockNative(page, { app = 'napstrfy', nativeLocale = 'en-GB', saved, paired = true, blockedStorage = false, platform = 'linux', remote = false } = {}) {
  await page.route('https://**', (route) => route.fulfill({ contentType: 'application/json', body: '{"results":[]}' }));
  await page.addInitScript(({ app, nativeLocale, saved, paired, blockedStorage, platform, remote }) => {
    if (saved) localStorage.setItem('napstr-language', saved);
    if (blockedStorage) {
      Storage.prototype.getItem = () => { throw new DOMException('Disabled', 'SecurityError'); };
      Storage.prototype.setItem = () => { throw new DOMException('Disabled', 'SecurityError'); };
    }
    window.calls = [];
    window.nativeLocale = nativeLocale;
    const track = { fileId: 'a'.repeat(64), filename: 'Search.wav', title: 'Search', artist: 'Settings', album: 'User album', folder: '', path: '/music/Search.wav', format: 'WAV', mime: 'audio/wav', size: 1234567, tags: 'Rock', local: !remote, sources: [], license: '', description: '', status: 'Shared' };
    const episode = { id: 'episode', title: 'Original episode', feedTitle: 'Original podcast', audioUrl: 'https://example.com/episode.mp3', datePublished: 1700000000, duration: 100, description: '', image: '', mime: 'audio/mpeg' };
    const status = () => ({ paired, connected: paired, desktopName: 'Music computer', streamOnly: false, endpointId: 'endpoint', libraryRevision: 1, error: '' });
    const transfers = [{ id: 1, fileId: track.fileId, filename: track.filename, size: track.size, progress: 100, status: 'Verified · Complete', speed: '', destination: '/music/Search.wav' }, { id: 2, fileId: 'b'.repeat(64), filename: 'Downloading.wav', size: 100, progress: 12, status: 'Downloading', speed: '', destination: '' }];
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback: () => 1,
      unregisterCallback: () => {},
      invoke: async (cmd, args = {}) => {
        window.calls.push({ cmd, args });
        switch (cmd) {
          case 'plugin:os|locale': return window.nativeLocale;
          case 'plugin:app|version': return '0.2.2';
          case 'plugin:event|listen': return 1;
          case 'plugin:event|unlisten': return;
          case 'get_snapshot':
          case 'save_settings': return { native: true, indexedBytes: track.size, files: [track], audiobooks: [], transfers, settings: { napstrFolder: '/music', nostrRelays: '', displayName: 'Original user', profileAbout: 'Original profile', profilePicture: '' } };
          case 'get_transfers': return transfers;
          case 'start_network':
          case 'network_status': return { connected: true, pubkey: 'c'.repeat(64), npub: 'npub1test', relayCount: 1, torRunning: true, torStarting: false, torProgress: 100, torError: '', error: '' };
          case 'network_browse': return { results: [track], cursor: null, totalAvailable: 1 };
          case 'network_search':
          case 'search_catalog': return [track];
          case 'network_search_audiobooks': return [];
          case 'get_track_discussion_messages':
          case 'get_trollbox_messages': return [{ eventId: 'event', content: 'Search', displayName: 'Settings', npub: 'npubother', pubkey: 'd'.repeat(64), createdAt: 1700000000 }];
          case 'mobile_status': return { running: true, online: true, endpointId: 'endpoint', error: '', devices: [] };
          case 'play_audio': return { fileId: track.fileId, currentTime: 0, duration: 60, playing: true, ended: false, error: '' };
          case 'client_platform': return platform;
          case 'companion_status': return status();
          case 'cached_library': return { ...status(), tracks: paired ? [track] : [], total: paired ? 1 : 0 };
          case 'remote_library': return { tracks: [track], total: 1 };
          case 'remote_search': if (window.searchError) throw window.searchError; return [track];
          case 'remote_transfers': return [{ ...transfers[1], fileId: track.fileId }];
          case 'reconcile_audio_cache': return true;
          case 'cache_remote_audio': return { url: location.origin + (window.nextMediaSource || '/fixture.wav'), track: args.track };
          case 'podcast_playback_url': return { url: location.origin + '/fixture.wav', downloaded: false };
          case 'prefetch_remote_audio': return;
          case 'remote_audiobook_library': return { audiobooks: [], total: 0 };
          case 'podcast_downloads': return [{ episode, ready: false, status: 'Downloading', progress: 20 }];
          case 'podcast_parse_search': return [{ id: 1, title: 'Original podcast', author: 'Original author', feedUrl: 'https://example.com/feed', image: '', description: '', language: 'en', episodeCount: 1, genres: ['Music'] }];
          case 'podcast_episodes': return [episode];
          case 'pair_desktop': paired = true; return 'Music computer';
          case 'forget_desktop': paired = false; return;
          default: return null;
        }
      }
    };
  }, { app, nativeLocale, saved, paired, blockedStorage, platform, remote });
}

function silentAudio() {
  const wav = Buffer.alloc(44 + 8000 * 2 * 60);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  return wav;
}

async function serveAudio(route) {
  const wav = silentAudio();
  const range = route.request().headers().range?.match(/^bytes=(\d+)-(\d*)$/);
  const headers = { 'Accept-Ranges': 'bytes' };
  if (range) {
    const start = Number(range[1]);
    const end = range[2] ? Math.min(Number(range[2]), wav.length - 1) : wav.length - 1;
    headers['Content-Range'] = `bytes ${start}-${end}/${wav.length}`;
    await route.fulfill({ status: 206, contentType: 'audio/wav', headers, body: wav.subarray(start, end + 1) });
  } else await route.fulfill({ contentType: 'audio/wav', headers, body: wav });
}

for (const code of ['en', 'zh', 'ar']) {
  test(`Napstr ${code}: search, pagination and Tor-to-Local update without leaving the screen`, async ({ page }) => {
    await mockNative(page, { app: 'napstr', saved: code });
    await page.addInitScript(() => {
      const invoke = window.__TAURI_INTERNALS__.invoke;
      const track = (index, prefix) => ({ fileId: index.toString(16).padStart(64, '0'), filename: `${prefix} ${index}.mp3`,
        title: `${prefix} ${String(index).padStart(3, '0')}`, artist: '', album: '', format: 'MP3', mime: 'audio/mpeg', size: 1000000,
        folder: '', path: `/music/${index}.mp3`, sources: [{ pubkey: 'd'.repeat(64), npub: 'npub1source', displayName: 'Source' }] });
      const callbacks = new Map();
      const handlers = new Map();
      window.__TAURI_INTERNALS__.transformCallback = (callback) => { const id = callbacks.size + 1; callbacks.set(id, callback); return id; };
      window.emitNative = (event) => callbacks.get(handlers.get(event))?.({ event, id: 1, payload: null });
      window.localFiles = [];
      window.downloads = [];
      window.finishDownload = () => {
        window.localFiles = [track(200, 'New')];
        window.downloads = [];
        window.emitNative('napstr-transfers-changed');
      };
      window.addLocalFiles = () => {
        window.localFiles = Array.from({ length: 105 }, (_, index) => track(index, 'Library'));
        window.emitNative('napstr-library-changed');
      };
      window.__TAURI_INTERNALS__.invoke = async (cmd, args = {}) => {
        if (cmd === 'plugin:event|listen') { handlers.set(args.event, args.handler); return 1; }
        if (cmd === 'get_snapshot') return { ...(await invoke(cmd, args)), files: window.localFiles, transfers: window.downloads };
        if (cmd === 'network_browse') return { results: [], cursor: null, totalAvailable: 0 };
        if (cmd === 'network_search') return args.query === 'first'
          ? Array.from({ length: 115 }, (_, index) => track(index, 'First'))
          : [track(200, 'New'), track(201, 'New')];
        if (cmd === 'resolve_catalogue_user' || cmd === 'search_catalog') return [];
        if (cmd === 'get_transfers') return window.downloads;
        if (cmd === 'request_network_download') {
          window.downloads = [{ ...track(200, 'New'), id: -1, progress: 100, status: 'Downloading', speed: '1 MB/s', destination: '' }];
          return 'request';
        }
        return invoke(cmd, args);
      };
    });
    await page.goto('http://127.0.0.1:15173');
    await expect(page.locator('.search-button')).toBeEnabled();
    const rows = page.locator('.search-results-table tbody tr');
    await page.locator('#search-query').fill('first');
    await page.locator('.search-button').click();
    await expect(rows).toHaveCount(100);
    await page.locator('.results-pane .results-pager button').last().click();
    await expect(rows).toHaveCount(15);
    await expect(rows.first()).toContainText('First 100');
    await page.locator('#search-query').fill('second');
    await page.locator('.search-button').click();
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText('New 200');
    await expect(rows.first().locator('td').nth(4)).toHaveText('Tor');
    await page.locator('.detail-actions button.primary').click();
    await expect(page.locator('.mini-row')).toHaveCount(1);
    await page.evaluate(() => window.finishDownload());
    await expect(rows.first().locator('td').nth(4)).toHaveText(catalogs[code].Local);
    await expect(page.locator('.detail-actions button.primary')).toHaveText(catalogs[code]['▶ Play']);
    // The shared library uses the same helper pattern: an event must update it
    // in place, and its pager must actually replace the displayed rows.
    await page.locator('.tool-button').filter({ hasText: catalogs[code].Shared }).click();
    await expect(page.locator('.shared-table tbody tr')).toHaveCount(1);
    await page.evaluate(() => window.addLocalFiles());
    await expect(page.locator('.shared-table tbody tr')).toHaveCount(100);
    await page.locator('.full-panel .results-pager button').last().click();
    await expect(page.locator('.shared-table tbody tr')).toHaveCount(5);
  });

  test(`Napstr ${code}: Surprise me fills 50 unowned tracks across pages and ignores old filters`, async ({ page }) => {
    await mockNative(page, { app: 'napstr', saved: code });
    await page.addInitScript(() => {
      const invoke = window.__TAURI_INTERNALS__.invoke;
      const track = (index) => ({ fileId: index.toString(16).padStart(64, '0'), filename: `Track ${index}.mp3`,
        title: `Track ${index}`, artist: 'Search', album: '', format: 'MP3', mime: 'audio/mpeg', size: 1000000,
        sources: [{ pubkey: 'd'.repeat(64), npub: 'npub1source', displayName: 'Source' }] });
      const owned = Array.from({ length: 80 }, (_, index) => track(index));
      window.surpriseCalls = [];
      window.__TAURI_INTERNALS__.invoke = async (cmd, args = {}) => {
        if (cmd === 'get_snapshot') return { ...(await invoke(cmd, args)), files: owned, transfers: [] };
        if (cmd === 'network_browse' && args.unownedOnly) {
          window.surpriseCalls.push(args);
          const number = Number(args.cursor?.sessionId || 0);
          // Include owned entries and duplicates defensively, and leave an
          // empty middle page to exercise continuation past unavailable metadata.
          const pages = [owned, [], Array.from({ length: 20 }, (_, i) => track(80 + i)),
            Array.from({ length: 40 }, (_, i) => track(90 + i))];
          return { results: pages[number], cursor: number < 3 ? { sessionId: String(number + 1) } : null, totalAvailable: 130 };
        }
        return invoke(cmd, args);
      };
    });
    await page.goto('http://127.0.0.1:15173');
    await expect(page.locator('.surprise-button')).toBeEnabled();
    await page.locator('#format').selectOption('Audiobooks');
    await expect(page.locator('.surprise-button')).toBeEnabled();
    await page.locator('#search-query').fill('An unrelated old search');
    await page.locator('.advanced-toggle').click();
    await page.locator('.advanced-row input[type="number"]').fill('99');
    await page.locator('.advanced-row input:not([type])').fill('1 B');
    await page.locator('.surprise-button').click();
    const rows = page.locator('.results-pane tbody tr');
    await expect(rows).toHaveCount(50);
    await expect(page.locator('.surprise-button')).toBeEnabled();
    expect(await page.locator('#format').inputValue()).toBe('Audio only');
    expect(await page.locator('#search-query').inputValue()).toBe('');
    expect(await page.evaluate(() => window.surpriseCalls.length)).toBe(4);
    const names = await rows.locator('td:first-child').allTextContents();
    expect(new Set(names).size).toBe(50);
    expect(names.every((name) => Number(name.match(/Track (\d+)/)[1]) >= 80)).toBe(true);
    // Selection and Download All must continue to work with translated labels.
    await rows.first().click();
    await rows.nth(4).click({ modifiers: ['Shift'] });
    await expect(page.locator('.detail-actions button.primary')).toHaveText(catalogs[code]['⇩ Download All']);
    await expect(page.locator('.detail-actions button.primary')).toBeEnabled();
  });
}

for (const platform of ['android', 'linux']) {
  test(`Napstrfy ${platform}: opening screen has a readable language selector without a dialog`, async ({ page }) => {
    await mockNative(page, { paired: false, platform });
    await page.setViewportSize({ width: platform === 'android' ? 360 : 1100, height: 900 });
    await page.goto('http://127.0.0.1:15174');
    const selector = page.locator('.pair-screen [data-language-select]');
    await expect(selector).toBeVisible();
    await expect.poll(() => page.locator('.pair-logo img').evaluate((image) => image.naturalWidth)).toBe(512);
    if (platform === 'linux') await expect(page.locator('.pair-logo img')).toHaveCSS('width', '128px');
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expect(page.locator('.pair-screen button').filter({ hasText: /^Settings$/ })).toHaveCount(0);
    await selector.selectOption('fr');
    await expect(selector).toHaveCSS('color', 'rgb(0, 0, 0)');
    await expect(selector).toHaveCSS('background-color', 'rgb(244, 244, 245)');
    await page.reload();
    await expect(selector).toHaveValue('fr');
    await page.screenshot({ path: test.info().outputPath(`${platform}-opening-language.png`) });
  });

  test(`Napstrfy ${platform}: 15-second controls seek safely and system controls use live playback position`, async ({ page }) => {
    await mockNative(page, { platform });
    await page.addInitScript((platform) => {
      window.mediaUpdates = [];
      window.mediaHandlers = {};
      if (platform === 'android') {
        window.NapstrfyMedia = { update: (payload) => window.mediaUpdates.push(JSON.parse(payload)), clear: () => {} };
      } else {
        navigator.mediaSession.setActionHandler = (action, handler) => { window.mediaHandlers[action] = handler; };
      }
    }, platform);
    await page.route('**/fixture.wav', serveAudio);
    await page.setViewportSize({ width: platform === 'android' ? 320 : 1100, height: 800 });
    await page.goto('http://127.0.0.1:15174');
    const back = page.getByRole('button', { name: 'Back 15 seconds', exact: true });
    const forward = page.getByRole('button', { name: 'Forward 15 seconds', exact: true });
    await expect(back).toBeDisabled();
    await expect(forward).toBeDisabled();
    await page.locator('.track-open').first().click();
    const audio = page.locator('audio');
    await expect.poll(() => audio.evaluate((audio) => audio.paused)).toBe(false);
    await page.locator('.play-main').click();
    await expect.poll(() => audio.evaluate((audio) => audio.paused)).toBe(true);
    await expect(back).toBeEnabled();
    const source = await audio.getAttribute('src');
    await audio.evaluate((audio) => { audio.currentTime = 20; });
    await forward.click();
    await expect.poll(() => audio.evaluate((audio) => audio.currentTime)).toBe(35);
    await back.click();
    await expect.poll(() => audio.evaluate((audio) => audio.currentTime)).toBe(20);
    await audio.evaluate((audio) => { audio.currentTime = 5; });
    await back.click();
    await expect.poll(() => audio.evaluate((audio) => audio.currentTime)).toBe(0);
    await audio.evaluate((audio) => { audio.currentTime = 55; });
    await forward.click();
    await expect.poll(() => audio.evaluate((audio) => audio.currentTime)).toBe(60);
    // Dispatch immediately after changing time: no UI timeupdate can intervene.
    for (const [action, expected] of [['rewind', 15], ['forward', 45]]) {
      const actual = await page.evaluate(({ platform, action }) => {
        const audio = document.querySelector('audio');
        audio.currentTime = 30;
        if (platform === 'android') dispatchEvent(new CustomEvent('napstrfy-media-action', { detail: action }));
        else window.mediaHandlers[action === 'rewind' ? 'seekbackward' : 'seekforward']({});
        return audio.currentTime;
      }, { platform, action });
      expect(actual).toBe(expected);
    }
    expect(await audio.evaluate((audio) => audio.paused)).toBe(true);
    await expect(audio).toHaveAttribute('src', source);
    expect(await page.evaluate(() => window.calls.filter((call) => call.cmd === 'cache_remote_audio').length)).toBe(1);
    if (platform === 'android') {
      await expect.poll(() => page.evaluate(() => window.mediaUpdates.at(-1).canSeek)).toBe(true);
      expect(await page.evaluate(() => window.mediaUpdates.at(-1).labels.rewind)).toBe('Back 15 seconds');
    }
    for (const width of [320, 600, 800, 1100]) {
      await page.setViewportSize({ width, height: 800 });
      const buttons = page.locator('.player-buttons button');
      expect((await buttons.evaluateAll((buttons) => buttons.slice(0, 5).map((button) => button.getAttribute('aria-label')))))
        .toEqual(['Previous track', 'Back 15 seconds', 'Play', 'Forward 15 seconds', 'Next track']);
      let right = 0;
      for (const button of (await buttons.all()).slice(0, 5)) {
        await expect(button).toBeInViewport();
        const box = await button.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(right);
        right = box.x + box.width;
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (width === 320) await page.screenshot({ path: test.info().outputPath(`${platform}-mobile-seek-controls.png`) });
    }
    await page.screenshot({ path: test.info().outputPath(`${platform}-seek-controls.png`) });
  });
}

async function instrumentTiming(page) {
  await page.addInitScript(() => {
    window.timingStats = { reads: 0, ranges: 0, positions: [], metadata: 0 };
    window.reportedDuration = NaN;
    const descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'duration');
    Object.defineProperty(HTMLMediaElement.prototype, 'duration', {
      configurable: true,
      get() {
        window.timingStats.reads++;
        return window.reportedDuration === 'actual' ? descriptor.get.call(this) : window.reportedDuration;
      }
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'seekable', {
      configurable: true,
      get() { window.timingStats.ranges++; throw new Error('Do not query native seekable ranges'); }
    });
    Object.defineProperty(navigator.mediaSession, 'metadata', {
      configurable: true,
      set() { window.timingStats.metadata++; }
    });
    navigator.mediaSession.setPositionState = (state) => window.timingStats.positions.push({ at: Date.now(), state });
  });
}

for (const platform of ['android', 'linux']) {
  test(`Napstrfy ${platform}: late duration recovers without range queries or playback changes`, async ({ page }) => {
    await mockNative(page, { platform });
    await instrumentTiming(page);
    await page.route('**/fixture.wav', serveAudio);
    await page.goto('http://127.0.0.1:15174');
    await page.locator('.track-open').first().click();
    const audio = page.locator('audio');
    const timeline = page.getByRole('slider', { name: 'Playback position' });
    await expect.poll(() => audio.evaluate((a) => a.paused)).toBe(false);
    await page.locator('.play-main').click();
    await expect(timeline).toBeDisabled();
    await expect(page.locator('.timeline span')).toContainText('/ —');
    expect(await page.evaluate(() => window.timingStats.positions.length)).toBe(0);
    // Duration becomes available without any new metadata event.
    await page.evaluate(() => { window.reportedDuration = 'actual'; });
    await expect(timeline).toBeEnabled();
    await expect(timeline).toHaveAttribute('max', '60');
    await timeline.fill('30');
    await page.getByRole('button', { name: 'Forward 15 seconds', exact: true }).click();
    await expect.poll(() => audio.evaluate((a) => a.currentTime)).toBe(45);
    expect(await audio.evaluate((a) => a.paused)).toBe(true);
    await expect.poll(() => page.evaluate(() => window.timingStats.metadata)).toBe(1);
    const before = await page.evaluate(() => ({ reads: window.timingStats.reads, positions: window.timingStats.positions.length }));
    const immediate = await page.evaluate(() => {
      for (let i = 0; i < 10000; i++) {
        document.querySelector('audio').dispatchEvent(new Event('durationchange'));
        document.querySelector('audio').dispatchEvent(new Event('loadedmetadata'));
      }
      return { reads: window.timingStats.reads, positions: window.timingStats.positions.length };
    });
    expect(immediate).toEqual(before);
    await expect.poll(() => page.evaluate(() => window.timingStats.reads)).toBeGreaterThan(before.reads);
    const stats = await page.evaluate(() => window.timingStats);
    expect(stats.reads - before.reads).toBe(1);
    expect(stats.ranges).toBe(0);
    expect(stats.metadata).toBe(1);
    for (let i = 1; i < stats.positions.length; i++) expect(stats.positions[i].at - stats.positions[i - 1].at).toBeGreaterThanOrEqual(990);
    expect(await page.evaluate(() => window.calls.filter((c) => c.cmd === 'cache_remote_audio').length)).toBe(1);
  });
}

test('Napstrfy podcast duration hints stay estimates and cannot enable seeking or reach system controls', async ({ page }) => {
  await mockNative(page);
  await instrumentTiming(page);
  await page.route('**/fixture.wav', serveAudio);
  await page.goto('http://127.0.0.1:15174');
  await page.locator('.app-nav button').nth(1).click();
  await page.locator('.podcast-open').first().click();
  await page.locator('.episode-copy').first().click();
  const timeline = page.getByRole('slider', { name: 'Playback position' });
  await expect.poll(() => page.locator('audio').evaluate((a) => a.paused)).toBe(false);
  await page.locator('.play-main').click();
  await expect(timeline).toBeDisabled();
  await expect(page.locator('.timeline span')).toContainText('/ ≈ 1:40');
  expect(await page.evaluate(() => window.timingStats.positions.length)).toBe(0);
  await page.evaluate(() => { window.reportedDuration = Number.MAX_VALUE; document.querySelector('audio').dispatchEvent(new Event('durationchange')); });
  await expect.poll(() => page.evaluate(() => window.timingStats.reads)).toBeGreaterThan(1);
  await expect(timeline).toBeDisabled();
  expect(await page.evaluate(() => window.timingStats.positions.length)).toBe(0);
  await page.evaluate(() => { window.reportedDuration = 'actual'; document.querySelector('audio').dispatchEvent(new Event('loadedmetadata')); });
  await expect(timeline).toBeEnabled();
  await expect(page.locator('.timeline span')).toContainText('/ 1:00');
  // The next source must not inherit either the estimate or verified length.
  await page.evaluate(() => { window.reportedDuration = NaN; });
  await page.locator('.app-nav button').first().click();
  await page.locator('.track-open').first().click();
  await expect(timeline).toBeDisabled();
  await expect(page.locator('.timeline span')).toContainText('/ —');
  expect(await page.evaluate(() => window.timingStats.ranges)).toBe(0);
});

test('Napstrfy banners expire after ten seconds and replacement errors get a fresh timer', async ({ page }) => {
  await mockNative(page, { remote: true });
  await page.clock.install();
  await page.goto('http://127.0.0.1:15174');
  await page.locator('.track-open').first().click();
  await expect(page.locator('.notice-banner')).toContainText('Napstr is downloading');
  await page.clock.fastForward(9000);
  await expect(page.locator('.notice-banner')).toBeVisible();
  await page.clock.fastForward(1100);
  await expect(page.locator('.notice-banner')).toHaveCount(0);
  const search = page.getByRole('textbox', { name: 'Search tracks', exact: true });
  for (const message of ['First search failed', 'Second search failed']) {
    await page.evaluate((message) => { window.searchError = message; }, message);
    await search.fill(message);
    await search.press('Enter');
    await expect(page.locator('.error-banner')).toContainText(message);
    if (message.startsWith('First')) await page.clock.fastForward(9000);
  }
  await page.clock.fastForward(2000);
  await expect(page.locator('.error-banner')).toContainText('Second search failed');
  await page.clock.fastForward(8100);
  await expect(page.locator('.error-banner')).toHaveCount(0);
  await search.press('Enter');
  await expect(page.locator('.error-banner')).toBeVisible();
  await page.locator('.error-banner').click();
  await expect(page.locator('.error-banner')).toHaveCount(0);
});

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

test('Napstrfy desktop player occupies its own column with artwork, likes and playback modes', async ({ page }) => {
  await mockNative(page);
  await page.addInitScript(() => {
    localStorage.setItem('napstrfy-artwork:v2:' + JSON.stringify(['album', 'settings', 'useralbum']), JSON.stringify({ url: '/napstr-logo-small.png', expires: Date.now() + 86400000 }));
  });
  await page.route('**/fixture.wav', serveAudio);
  await page.goto('http://127.0.0.1:15174');
  await page.locator('.track-open').first().click();
  await expect.poll(() => page.locator('audio').evaluate((audio) => audio.paused)).toBe(false);
  await page.locator('.play-main').click();
  const cover = page.locator('.now-playing .artwork img');
  await expect(cover).toHaveAttribute('src', '/napstr-logo-small.png');
  await expect(page.locator('.player-backdrop span')).toHaveCSS('background-image', /napstr-logo-small\.png/);
  await expect(page.locator('.player-backdrop span')).toHaveCSS('filter', 'blur(20px)');
  const like = page.locator('.player-like');
  await like.click();
  await expect(like).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.track-row .like-button')).toHaveAccessibleName('Unlike Search');
  await page.locator('.mode-button').click();
  await expect(page.locator('.mode-label')).toHaveText('Play random');
  expect(await page.evaluate(() => localStorage.getItem('napstrfy-play-mode'))).toBe('random');
  for (const width of [800, 1100, 1600]) {
    await page.setViewportSize({ width, height: 900 });
    const nav = await page.locator('.app-nav').boundingBox();
    const content = await page.locator('.app-content').boundingBox();
    const player = await page.locator('.now-playing').boundingBox();
    const art = await page.locator('.now-playing .artwork').boundingBox();
    expect(player.width).toBeCloseTo(nav.width * 1.5);
    expect(content.x).toBeGreaterThanOrEqual(nav.x + nav.width);
    expect(content.x + content.width).toBeLessThanOrEqual(player.x);
    expect(player.x + player.width).toBe(width);
    expect(art.width).toBeGreaterThan(200);
    expect(art.width).toBeCloseTo(art.height);
    expect(art.x).toBeGreaterThan(player.x);
    await expect(page.locator('.now-playing')).toHaveCSS('position', 'relative');
    await expect(page.locator('.mode-button')).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`desktop-player-${width}.png`) });
  }
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(like).toBeHidden();
  await expect(page.locator('.player-backdrop')).toBeHidden();
  await expect(page.locator('.now-playing')).toHaveCSS('position', 'fixed');
  await expect(page.locator('audio')).toHaveCount(1);
  expect(await page.evaluate(() => window.calls.filter((call) => call.cmd === 'cache_remote_audio').length)).toBe(1);
});

for (const app of ['napstr', 'napstrfy']) {
  test(`${app}: all ten languages, saved preference, user content and status behavior`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await mockNative(page, { app });
    await page.goto(`http://127.0.0.1:${app === 'napstr' ? 15173 : 15174}`);
    if (app === 'napstr') await page.locator('.tool-button').filter({ hasText: /Settings$/ }).click();
    else await page.locator('.app-nav button').last().click();
    const selector = page.locator('[data-language-select]');
    await expect(selector).toBeVisible();
    for (const { code } of languages) {
      await selector.selectOption(code);
      await expect(page.locator('html')).toHaveAttribute('lang', code);
      await expect(page.locator('html')).toHaveAttribute('dir', direction(code));
      await expect(page.locator('.language-select > span')).toHaveText(catalogs[code].Language);
      if (['ar', 'ur', 'hi', 'bn', 'zh'].includes(code)) {
        await page.evaluate(() => document.fonts.ready);
        expect(await page.evaluate(() => [...document.fonts].some((font) => font.family.startsWith('Noto Sans') && font.status === 'loaded'))).toBe(true);
      }
      expect(await page.evaluate(() => localStorage.getItem('napstr-language'))).toBe(code);
    }
    await page.screenshot({ path: test.info().outputPath(`${app}-urdu-settings.png`) });
    if (app === 'napstr') {
      await page.locator('.tool-button').filter({ hasText: catalogs.ur.Downloads }).click();
      await expect(page.locator('.downloads-view .transfer-play')).toBeEnabled();
      await expect(page.locator('.downloads-view')).toContainText('Downloading');
      await expect(page.locator('.downloads-view')).toContainText('Search.wav');
      await page.locator('.tool-button').filter({ hasText: catalogs.ur.Search }).click();
      await page.locator('#format').selectOption('Audiobooks');
      expect(await page.locator('#format').inputValue()).toBe('Audiobooks');
      await expect.poll(() => page.evaluate(() => window.calls.some((call) => call.cmd === 'network_search_audiobooks'))).toBeTruthy();
    } else {
      await page.keyboard.press('Escape');
      await expect(page.locator('.track-copy strong').first()).toHaveText('Search');
      await page.locator('.app-nav button').nth(1).click();
      await page.locator('.podcast-open').first().click();
      await expect(page.locator('.episode-download')).toBeDisabled();
      await expect(page.locator('.episode-download')).toHaveAttribute('title', 'Downloading');
    }
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'ur');
    expect(errors).toEqual([]);
  });
}

test('native language wins in automatic mode; later native responses cannot overwrite a manual choice', async ({ page }) => {
  await mockNative(page, { nativeLocale: 'ar-SA', paired: false });
  await page.goto('http://127.0.0.1:15174');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await page.locator('.pair-screen [data-language-select]').selectOption('es');
  await page.evaluate(() => { window.nativeLocale = 'fr-FR'; dispatchEvent(new Event('focus')); });
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await page.locator('[data-language-select]').selectOption('auto');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await page.keyboard.press('Escape');
  await page.locator('textarea').fill('napstrfy://pair/test');
  await page.locator('.manual-pair button[type="submit"]').click();
  await expect(page.locator('.track-row')).toBeVisible();
});

test('browser fallback works without native locale and language selection survives blocked storage', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'pt-BR' });
  const page = await context.newPage();
  await mockNative(page, { nativeLocale: null, paired: false, blockedStorage: true });
  await page.goto('http://127.0.0.1:15174');
  await expect(page.locator('html')).toHaveAttribute('lang', 'pt');
  await page.locator('.pair-screen [data-language-select]').selectOption('hi');
  await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
  await context.close();
});

for (const code of ['ar', 'ur', 'fr', 'bn']) {
  test(`Napstrfy ${code}: mobile and desktop layouts fit without duplicating navigation`, async ({ page }) => {
    await mockNative(page, { saved: code });
    await page.goto('http://127.0.0.1:15174');
    await expect(page.locator('.track-row')).toBeVisible();
    for (const width of [360, 430, 800, 1180]) {
      await page.setViewportSize({ width, height: 810 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
      await expect(page.locator('.app-nav')).toHaveCount(1);
      const nav = await page.locator('.app-nav').boundingBox();
      if (width >= 800 && ['ar', 'ur'].includes(code)) expect(Math.round(nav.x + nav.width)).toBe(width);
      await page.locator('.app-nav button').last().click();
      await expect(page.locator('[data-language-select]')).toBeInViewport();
      await page.keyboard.press('Escape');
    }
  });
}

test('website suggests language without redirecting; explicit changes preserve project paths, query and anchors', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'es-MX' });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:15175/preview/index.html?from=shared#how-it-works');
  await expect(page.locator('[data-language-suggestion]')).toBeVisible();
  await expect(page).toHaveURL(/\/preview\/index.html\?from=shared#how-it-works$/);
  await expect(page.locator('[data-suggested-language]')).toHaveText('Español');
  await page.locator('[data-suggested-language]').click();
  await expect(page).toHaveURL(/\/preview\/es\/index.html\?from=shared#how-it-works$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await expect(page.locator('[data-language-select]')).toHaveCount(0);
  await page.locator('.language-links summary').click();
  await page.locator('.language-links a[lang="ur"]').click();
  await expect(page).toHaveURL(/\/preview\/ur\/index.html\?from=shared#how-it-works$/);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await page.goto('http://127.0.0.1:15175/preview/tor.html');
  await expect(page.locator('[data-suggested-language]')).toHaveText('اردو');
  await expect(page).toHaveURL(/\/preview\/tor.html$/);
  await page.locator('[data-suggested-language]').click();
  await expect(page).toHaveURL(/\/preview\/ur\/tor.html$/);
  await page.locator('.language-links summary').click();
  await page.locator('.language-links a[lang="en"]').click();
  await expect(page).toHaveURL(/\/preview\/tor.html$/);
  await context.close();
});

test('website language links and sharing metadata work without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, locale: 'fr-FR' });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:15175/preview/napstrfy.html');
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', 'https://napstr.net/assets/napstrfy-share.png');
  await page.locator('.language-links summary').click();
  await expect(page.locator('.language-links a')).toHaveCount(10);
  await page.locator('.language-links a[lang="fr"]').click();
  await expect(page).toHaveURL(/\/preview\/fr\/napstrfy.html$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await context.close();
});

test('website downloads select the right product and display translated release status', async ({ page }) => {
  await page.route('https://api.github.com/**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ tag_name: 'v0.2.2', html_url: 'https://github.com/lnbits/napstr/releases/tag/v0.2.2', assets: ['Napstrfy_0.2.2_x64.exe', 'Napstr_0.2.2_x64.exe', 'Napstrfy_0.2.2_amd64.AppImage', 'Napstr_0.2.2_amd64.AppImage'].map((name) => ({ name, size: 1234567, browser_download_url: `https://github.com/lnbits/napstr/releases/download/v0.2.2/${name}` })) }) }));
  await page.goto('http://127.0.0.1:15175/es/download.html');
  await expect(page.locator('[data-release-platform="windows"]').first()).toHaveAttribute('href', /Napstr_0.2.2_x64.exe$/);
  await expect(page.locator('#release-status')).toContainText('0.2.2');
  await page.goto('http://127.0.0.1:15175/es/napstrfy.html');
  await expect(page.locator('[data-release-platform="windows"]')).toHaveAttribute('href', /Napstrfy_0.2.2_x64.exe$/);
});


test('switching language during playback preserves audio and updates Android media labels', async ({ page }) => {
  const wav = silentAudio();
  await mockNative(page);
  await page.addInitScript(() => {
    window.mediaUpdates = [];
    window.NapstrfyMedia = { update: (payload) => window.mediaUpdates.push(JSON.parse(payload)), clear: () => {} };
  });
  await page.route('**/fixture.wav', (route) => route.fulfill({ contentType: 'audio/wav', body: wav }));
  await page.goto('http://127.0.0.1:15174');
  await page.locator('.track-open').first().click();
  await expect.poll(() => page.locator('audio').evaluate((audio) => audio.paused)).toBe(false);
  const source = await page.locator('audio').getAttribute('src');
  await page.locator('.app-nav button').last().click();
  await page.locator('[data-language-select]').selectOption('fr');
  await expect.poll(() => page.evaluate(() => window.mediaUpdates.at(-1)?.labels.play)).toBe(catalogs.fr.Play);
  expect(await page.locator('audio').evaluate((audio) => audio.paused)).toBe(false);
  await expect(page.locator('audio')).toHaveAttribute('src', source);
  expect(await page.evaluate(() => window.calls.filter((call) => call.cmd === 'cache_remote_audio').length)).toBe(1);
});
