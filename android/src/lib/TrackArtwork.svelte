<script lang="ts">
  import { ARTWORK_RETRY_MS, artworkFor, artworkHue, invalidateArtwork } from './artwork';
  import type { RemoteTrack } from './types';

  let { track, lookup = true, large = false, onartworkchange }: { track: RemoteTrack; lookup?: boolean; large?: boolean; onartworkchange?: (url: string) => void } = $props();
  let image = $state('');
  let failed = $state(false);
  let visible = $state(false);
  let retry = $state(0);
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let hue = $derived(artworkHue(track.fileId));

  function observe(node: HTMLElement) {
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        visible = true;
        observer.disconnect();
      }
    }, { rootMargin: '150px' });
    observer.observe(node);
    return { destroy: () => observer.disconnect() };
  }

  function retryLater() {
    clearTimeout(retryTimer);
    if (retry < 2) retryTimer = setTimeout(() => { retry += 1; }, ARTWORK_RETRY_MS);
  }

  function imageFailed() {
    invalidateArtwork(track, image);
    failed = true;
    retryLater();
  }

  $effect(() => { track; retry = 0; });
  $effect(() => { onartworkchange?.(image && !failed ? image : ''); });

  $effect(() => {
    let alive = true;
    retry;
    image = '';
    failed = false;
    if (lookup && (large || visible)) artworkFor(track, large).then((url) => {
      if (!alive) return;
      image = url;
      if (!url) retryLater();
    });
    return () => { alive = false; clearTimeout(retryTimer); };
  });
</script>

<div use:observe class:large class="artwork" style={`--cover-hue:${hue}`}>
  {#if image && !failed}<img src={image} alt="" onerror={imageFailed} />{:else}<img class="fallback" src="/napstr-logo-small.png" alt="" />{/if}
</div>
