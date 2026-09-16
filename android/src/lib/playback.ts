type PlaybackMedia = Pick<HTMLMediaElement, 'duration' | 'readyState' | 'seekable'>;

function positiveDuration(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function seekRanges(ranges: TimeRanges) {
  const result = [];
  for (let index = 0; index < ranges.length; index += 1) {
    const start = ranges.start(index);
    const end = ranges.end(index);
    if (Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start) {
      result.push({ start, end });
    }
  }
  return result;
}

/**
 * A seekable window is useful even when a stream's total length is unknown.
 * Keep it separate from duration so a growing window isn't labelled as the end.
 * knownDuration is a previous duration or feed hint for this source only.
 */
export function playbackTiming(media: PlaybackMedia, knownDuration = 0) {
  const duration = positiveDuration(media.duration) || positiveDuration(knownDuration);
  const ranges = seekRanges(media.seekable);
  const start = duration ? 0 : ranges[0]?.start ?? 0;
  const end = duration || ranges.at(-1)?.end || 0;
  return { duration, start, end, canSeek: media.readyState >= 1 && end > start };
}

export function playbackSeekTarget(media: PlaybackMedia, value: number, knownDuration = 0) {
  const timing = playbackTiming(media, knownDuration);
  if (!Number.isFinite(value) || !timing.canSeek) return null;
  if (timing.duration) return Math.max(0, Math.min(timing.duration, value));
  // Streams can have gaps or a sliding seek window. Pick the closest playable
  // point rather than requesting a position the browser cannot reach.
  let target = timing.start;
  for (const { start, end } of seekRanges(media.seekable)) {
    const candidate = Math.max(start, Math.min(end, value));
    if (Math.abs(candidate - value) < Math.abs(target - value)) target = candidate;
  }
  return target;
}
