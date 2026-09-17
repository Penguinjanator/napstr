<script lang="ts">
  export let forward = false;
</script>

<svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true" focusable="false">
  <g transform={forward ? 'translate(32 0) scale(-1 1)' : undefined}>
    <path d="M9 9a11 11 0 1 1-3 8M9 3v6H3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
  </g>
  <text x="16" y="22" fill="currentColor" text-anchor="middle" font-family="Arial, sans-serif" font-size="12" font-weight="700">15</text>
</svg>
