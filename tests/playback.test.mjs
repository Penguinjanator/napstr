import test from 'node:test';
import assert from 'node:assert/strict';
import { playbackTiming, playbackSeekTarget } from '../android/src/lib/playback.ts';

function media(duration, ranges = [], readyState = 1) {
  return { duration, readyState, seekable: {
    length: ranges.length,
    start: (index) => ranges[index][0],
    end: (index) => ranges[index][1]
  } };
}

test('unknown duration uses seekable ranges without pretending they are the total length', () => {
  for (const duration of [NaN, Infinity, 0]) {
    const audio = media(duration, [[0, 48]]);
    assert.deepEqual(playbackTiming(audio), { duration: 0, start: 0, end: 48, canSeek: true });
    assert.equal(playbackSeekTarget(audio, 32), 32);
    assert.equal(playbackSeekTarget(audio, -15), 0);
    assert.equal(playbackSeekTarget(audio, 70), 48);
  }
});

test('known duration survives temporarily missing metadata and yields to a later actual duration', () => {
  assert.equal(playbackTiming(media(NaN), 120).duration, 120);
  assert.equal(playbackTiming(media(Infinity), 120).end, 120);
  assert.equal(playbackTiming(media(65), 120).duration, 65);
  assert.equal(playbackSeekTarget(media(Infinity), 30, 120), 30);
  assert.equal(playbackTiming(media(NaN)).duration, 0);
});

test('seeking waits for usable media information and rejects invalid inputs', () => {
  for (const audio of [media(NaN), media(Infinity), media(60, [], 0), media(NaN, [[0, Infinity], [5, 2]])]) {
    assert.equal(playbackTiming(audio).canSeek, false);
    assert.equal(playbackSeekTarget(audio, 10), null);
  }
  assert.equal(playbackSeekTarget(media(60), Infinity), null);
  assert.equal(playbackSeekTarget(media(60), NaN), null);
  assert.equal(playbackSeekTarget(media(60), 80), 60);
});

test('unknown-length streams clamp seeks to a playable window and avoid gaps', () => {
  const audio = media(Infinity, [[20, 40], [60, 90]]);
  assert.deepEqual(playbackTiming(audio), { duration: 0, start: 20, end: 90, canSeek: true });
  assert.equal(playbackSeekTarget(audio, 0), 20);
  assert.equal(playbackSeekTarget(audio, 48), 40);
  assert.equal(playbackSeekTarget(audio, 54), 60);
  assert.equal(playbackSeekTarget(audio, 100), 90);
});
