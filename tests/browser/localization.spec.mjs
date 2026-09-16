import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { languages, direction } from '../../shared/i18n/core.js';
const catalogs = Object.fromEntries(await Promise.all(languages.map(async ({ code }) => [code, JSON.parse(await readFile(new URL(`../../shared/i18n/locales/${code}.json`, import.meta.url)))])));

async function mockNative(page, { app = 'napstrfy', nativeLocale = 'en-GB', saved, paired = true, blockedStorage = false } = {}) {
  await page.route('https://**', (route) => route.fulfill({ contentType: 'application/json', body: '{"results":[]}' }));
  await page.addInitScript(({ app, nativeLocale, saved, paired, blockedStorage }) => {
    if (saved) localStorage.setItem('napstr-language', saved);
    if (blockedStorage) {
      Storage.prototype.getItem = () => { throw new DOMException('Disabled', 'SecurityError'); };
      Storage.prototype.setItem = () => { throw new DOMException('Disabled', 'SecurityError'); };
    }
    window.calls = [];
    window.nativeLocale = nativeLocale;
    const track = { fileId: 'a'.repeat(64), filename: 'Search.wav', title: 'Search', artist: 'Settings', album: 'User album', folder: '', path: '/music/Search.wav', format: 'WAV', mime: 'audio/wav', size: 1234567, tags: 'Rock', local: true, sources: [], license: '', description: '', status: 'Shared' };
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
          case 'client_platform': return 'linux';
          case 'companion_status': return status();
          case 'cached_library': return { ...status(), tracks: paired ? [track] : [], total: paired ? 1 : 0 };
          case 'remote_library': return { tracks: [track], total: 1 };
          case 'remote_search': return [track];
          case 'reconcile_audio_cache': return true;
          case 'cache_remote_audio': return { url: location.origin + '/fixture.wav', track: args.track };
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
  }, { app, nativeLocale, saved, paired, blockedStorage });
}

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
  await page.locator('.pair-screen button').filter({ hasText: catalogs.ar.Settings }).click();
  await page.locator('[data-language-select]').selectOption('es');
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
  await page.locator('.pair-screen button').filter({ hasText: catalogs.pt.Settings }).click();
  await page.locator('[data-language-select]').selectOption('hi');
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
  await page.locator('[data-language-select]').selectOption('ur');
  await expect(page).toHaveURL(/\/preview\/ur\/index.html\?from=shared#how-it-works$/);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await page.goto('http://127.0.0.1:15175/preview/tor.html');
  await expect(page.locator('[data-suggested-language]')).toHaveText('اردو');
  await expect(page).toHaveURL(/\/preview\/tor.html$/);
  await page.locator('[data-suggested-language]').click();
  await expect(page).toHaveURL(/\/preview\/ur\/tor.html$/);
  await page.locator('[data-language-select]').selectOption('en');
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
  const wav = Buffer.alloc(44 + 8000 * 2 * 60);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
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
