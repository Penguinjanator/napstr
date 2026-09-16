package net.napstr.nostrfy

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.os.PowerManager
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.core.app.NotificationCompat
import androidx.media.app.NotificationCompat.MediaStyle

class MediaNotificationService : Service() {
  private lateinit var mediaSession: MediaSessionCompat
  private var title = "Napstrfy"
  private var artist = ""
  private var previousLabel = "Previous"
  private var playLabel = "Play"
  private var pauseLabel = "Pause"
  private var nextLabel = "Next"
  private var rewindLabel = "Back 15 seconds"
  private var forwardLabel = "Forward 15 seconds"
  private var channelLabel = "Media playback"
  private var playing = false
  private var position = 0L
  private var duration = 0L
  private var canPrevious = false
  private var canNext = false
  private var canSeek = false
  private var foregroundStarted = false
  private var screenWakeLock: PowerManager.WakeLock? = null

  override fun onCreate() {
    super.onCreate()
    createChannel()
    mediaSession = MediaSessionCompat(this, "NapstrfyPlayback").apply {
      setCallback(object : MediaSessionCompat.Callback() {
        override fun onPlay() = dispatch(ACTION_PLAY)
        override fun onPause() = dispatch(ACTION_PAUSE)
        override fun onSkipToPrevious() = dispatch(ACTION_PREVIOUS)
        override fun onSkipToNext() = dispatch(ACTION_NEXT)
        override fun onRewind() = dispatch(ACTION_REWIND)
        override fun onFastForward() = dispatch(ACTION_FORWARD)
        override fun onCustomAction(action: String?, extras: Bundle?) {
          if (action == ACTION_REWIND || action == ACTION_FORWARD) dispatch(action)
        }
        override fun onSeekTo(pos: Long) {
          if (canSeek) MediaControlBridge.dispatch("seek:${pos.coerceAtLeast(0L)}")
        }
      })
      isActive = true
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_UPDATE -> readState(intent)
      ACTION_CLEAR -> {
        stopForeground(STOP_FOREGROUND_REMOVE)
        foregroundStarted = false
        stopSelf()
        return START_NOT_STICKY
      }
      ACTION_PLAY, ACTION_PAUSE, ACTION_PREVIOUS, ACTION_NEXT, ACTION_REWIND, ACTION_FORWARD -> {
        dispatch(intent.action!!)
        return START_NOT_STICKY
      }
      else -> return START_NOT_STICKY
    }

    updateSession()
    val notification = buildNotification()
    startForeground(NOTIFICATION_ID, notification)
    foregroundStarted = true
    return START_NOT_STICKY
  }

  private fun readState(intent: Intent) {
    title = intent.getStringExtra(EXTRA_TITLE)?.ifBlank { "Napstrfy" } ?: "Napstrfy"
    artist = intent.getStringExtra(EXTRA_ARTIST).orEmpty()
    playing = intent.getBooleanExtra(EXTRA_PLAYING, false)
    position = intent.getLongExtra(EXTRA_POSITION, 0L).coerceAtLeast(0L)
    duration = intent.getLongExtra(EXTRA_DURATION, 0L).coerceAtLeast(0L)
    canPrevious = intent.getBooleanExtra(EXTRA_CAN_PREVIOUS, false)
    canNext = intent.getBooleanExtra(EXTRA_CAN_NEXT, false)
    canSeek = intent.getBooleanExtra(EXTRA_CAN_SEEK, false)
    previousLabel = intent.getStringExtra("label_previous")?.ifBlank { "Previous" } ?: "Previous"
    playLabel = intent.getStringExtra("label_play")?.ifBlank { "Play" } ?: "Play"
    pauseLabel = intent.getStringExtra("label_pause")?.ifBlank { "Pause" } ?: "Pause"
    nextLabel = intent.getStringExtra("label_next")?.ifBlank { "Next" } ?: "Next"
    rewindLabel = intent.getStringExtra("label_rewind")?.ifBlank { "Back 15 seconds" } ?: "Back 15 seconds"
    forwardLabel = intent.getStringExtra("label_forward")?.ifBlank { "Forward 15 seconds" } ?: "Forward 15 seconds"
    val nextChannelLabel = intent.getStringExtra("label_channel")?.ifBlank { "Media playback" } ?: "Media playback"
    if (nextChannelLabel != channelLabel) {
      channelLabel = nextChannelLabel
      createChannel()
    }
    updateScreenWakeLock()
  }

  @Suppress("DEPRECATION")
  private fun updateScreenWakeLock() {
    if (playing) {
      if (screenWakeLock == null) {
        val powerManager = getSystemService(POWER_SERVICE) as PowerManager
        screenWakeLock = powerManager.newWakeLock(
          PowerManager.SCREEN_DIM_WAKE_LOCK,
          "$packageName:playback-screen"
        ).apply { setReferenceCounted(false) }
      }
      if (screenWakeLock?.isHeld != true) screenWakeLock?.acquire()
    } else {
      releaseScreenWakeLock()
    }
  }

  private fun releaseScreenWakeLock() {
    screenWakeLock?.takeIf { it.isHeld }?.release()
  }

  private fun updateSession() {
    mediaSession.setMetadata(
      MediaMetadataCompat.Builder()
        .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
        .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist)
        .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, duration)
        .build()
    )
    var actions = PlaybackStateCompat.ACTION_PLAY or
      PlaybackStateCompat.ACTION_PAUSE or
      PlaybackStateCompat.ACTION_PLAY_PAUSE
    if (canSeek) actions = actions or PlaybackStateCompat.ACTION_SEEK_TO or
      PlaybackStateCompat.ACTION_REWIND or PlaybackStateCompat.ACTION_FAST_FORWARD
    if (canPrevious) actions = actions or PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
    if (canNext) actions = actions or PlaybackStateCompat.ACTION_SKIP_TO_NEXT
    mediaSession.setPlaybackState(
      PlaybackStateCompat.Builder()
        .setActions(actions)
        .apply {
          // Android 13+ derives lock-screen buttons from session custom actions.
          if (canSeek) {
            addCustomAction(ACTION_REWIND, rewindLabel, R.drawable.ic_replay_15)
            addCustomAction(ACTION_FORWARD, forwardLabel, R.drawable.ic_forward_15)
          }
        }
        .setState(
          if (playing) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED,
          position,
          if (playing) 1f else 0f
        )
        .build()
    )
  }

  private fun buildNotification(): Notification {
    val previous = actionPendingIntent(ACTION_PREVIOUS, 1)
    val playPause = actionPendingIntent(if (playing) ACTION_PAUSE else ACTION_PLAY, 2)
    val next = actionPendingIntent(ACTION_NEXT, 3)
    val rewind = if (canSeek) actionPendingIntent(ACTION_REWIND, 4) else null
    val forward = if (canSeek) actionPendingIntent(ACTION_FORWARD, 5) else null
    val launch = packageManager.getLaunchIntentForPackage(packageName)?.let {
      PendingIntent.getActivity(this, 0, it, pendingFlags())
    }
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_stat_napstrfy)
      .setContentTitle(title)
      .setContentText(artist)
      .setContentIntent(launch)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
      .setOngoing(playing)
      .addAction(android.R.drawable.ic_media_previous, previousLabel, previous)
      .addAction(R.drawable.ic_replay_15, rewindLabel, rewind)
      .addAction(
        if (playing) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play,
        if (playing) pauseLabel else playLabel,
        playPause
      )
      .addAction(R.drawable.ic_forward_15, forwardLabel, forward)
      .addAction(android.R.drawable.ic_media_next, nextLabel, next)
      .setStyle(MediaStyle().setMediaSession(mediaSession.sessionToken).setShowActionsInCompactView(1, 2, 3))
      .build()
  }

  private fun actionPendingIntent(action: String, requestCode: Int): PendingIntent =
    PendingIntent.getService(
      this,
      requestCode,
      Intent(this, MediaNotificationService::class.java).setAction(action),
      pendingFlags()
    )

  private fun pendingFlags(): Int =
    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE

  private fun dispatch(action: String) {
    when (action) {
      ACTION_PLAY -> MediaControlBridge.dispatch("play")
      ACTION_PAUSE -> MediaControlBridge.dispatch("pause")
      ACTION_PREVIOUS -> if (canPrevious) MediaControlBridge.dispatch("previous")
      ACTION_NEXT -> if (canNext) MediaControlBridge.dispatch("next")
      ACTION_REWIND -> if (canSeek) MediaControlBridge.dispatch("rewind")
      ACTION_FORWARD -> if (canSeek) MediaControlBridge.dispatch("forward")
    }
  }

  private fun createChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val channel = NotificationChannel(
      CHANNEL_ID,
      channelLabel,
      NotificationManager.IMPORTANCE_LOW
    ).apply {
      description = channelLabel
      setShowBadge(false)
    }
    getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    releaseScreenWakeLock()
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
    super.onTaskRemoved(rootIntent)
  }

  override fun onDestroy() {
    releaseScreenWakeLock()
    mediaSession.isActive = false
    mediaSession.release()
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  companion object {
    const val ACTION_UPDATE = "net.napstr.nostrfy.media.UPDATE"
    const val ACTION_CLEAR = "net.napstr.nostrfy.media.CLEAR"
    const val ACTION_PLAY = "net.napstr.nostrfy.media.PLAY"
    const val ACTION_PAUSE = "net.napstr.nostrfy.media.PAUSE"
    const val ACTION_PREVIOUS = "net.napstr.nostrfy.media.PREVIOUS"
    const val ACTION_NEXT = "net.napstr.nostrfy.media.NEXT"
    const val ACTION_REWIND = "net.napstr.nostrfy.media.REWIND"
    const val ACTION_FORWARD = "net.napstr.nostrfy.media.FORWARD"
    const val EXTRA_TITLE = "title"
    const val EXTRA_ARTIST = "artist"
    const val EXTRA_PLAYING = "playing"
    const val EXTRA_POSITION = "position"
    const val EXTRA_DURATION = "duration"
    const val EXTRA_CAN_PREVIOUS = "canPrevious"
    const val EXTRA_CAN_NEXT = "canNext"
    const val EXTRA_CAN_SEEK = "canSeek"
    private const val CHANNEL_ID = "napstrfy_playback"
    private const val NOTIFICATION_ID = 7302
  }
}
