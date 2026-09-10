package com.busawake.app

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log

/**
 * Native Alarm Controller responsible for audio playback, tactile bursts, and volume verification.
 * Uses AudioAttributes.USAGE_ALARM to categorize stream as alarm audio.
 * Note: Actual audibility is subject to device alarm volume, OEM policies, and DND settings.
 */
class AlarmController(private val context: Context) {

    companion object {
        private const val TAG = "AlarmController"

        // Intermittent tactile burst pattern:
        // 0ms delay, 200ms vibrate, 150ms pause, 200ms vibrate, 900ms SILENCE.
        // Provides a generous 800ms clean sensing window during each pause!
        val VIBRATION_PATTERN = longArrayOf(0, 200, 150, 200, 900)
        val VIBRATION_AMPLITUDES = intArrayOf(0, 255, 0, 255, 0)
    }

    interface Listener {
        fun onAlarmStarted(reason: String)
        fun onAlarmDismissed(source: String)
    }

    var listener: Listener? = null
    var isAlarming: Boolean = false
        private set

    private var mediaPlayer: MediaPlayer? = null
    private var isVibrating = false
    private val mainHandler = Handler(Looper.getMainLooper())
    private var testStopRunnable: Runnable? = null

    private val vibrator: Vibrator? by lazy {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val vibratorManager = context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager
            vibratorManager?.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
        }
    }

    data class VolumeStatus(
        val currentVolume: Int,
        val maxVolume: Int,
        val percentage: Int,
        val isMuted: Boolean,
        val isTotalSilence: Boolean
    )

    /**
     * Inspects system alarm stream volume and ringer policies.
     */
    fun getVolumeStatus(): VolumeStatus {
        val am = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
        val current = am?.getStreamVolume(AudioManager.STREAM_ALARM) ?: 0
        val max = am?.getStreamMaxVolume(AudioManager.STREAM_ALARM) ?: 7
        val ringerMode = am?.ringerMode ?: AudioManager.RINGER_MODE_NORMAL
        val pct = if (max > 0) (current * 100) / max else 0
        val isMuted = current == 0
        val isTotalSilence = ringerMode == AudioManager.RINGER_MODE_SILENT

        return VolumeStatus(current, max, pct, isMuted, isTotalSilence)
    }

    /**
     * Pre-trip alarm test allowing passenger to verify audibility under current device settings.
     */
    @Synchronized
    fun testAlarmPlayback(durationMs: Long = 3000L, onComplete: () -> Unit = {}) {
        if (isAlarming) return
        Log.i(TAG, "Starting pre-trip alarm audio/vibration test ($durationMs ms)")

        startAudio()
        startVibration()

        testStopRunnable?.let { mainHandler.removeCallbacks(it) }
        testStopRunnable = Runnable {
            stopAudio()
            stopVibration()
            confirmHapticPulse()
            onComplete()
            Log.i(TAG, "Pre-trip alarm test completed")
        }
        mainHandler.postDelayed(testStopRunnable!!, durationMs)
    }

    /**
     * Triggers the native alarm: plays alarm ringtone in a loop and bursts vibration.
     */
    @Synchronized
    fun triggerAlarm(reason: String) {
        if (isAlarming) {
            Log.d(TAG, "Alarm already active, ignoring duplicate trigger: $reason")
            return
        }
        isAlarming = true
        testStopRunnable?.let { mainHandler.removeCallbacks(it) }

        Log.i(TAG, "Triggering native alarm. Reason: $reason")

        startAudio()
        startVibration()

        listener?.onAlarmStarted(reason)
    }

    /**
     * Authoritative dismissal of native alarm.
     * @param source e.g. "shake", "manual_button", "notification_action", "timeout"
     */
    @Synchronized
    fun dismissAlarm(source: String) {
        if (!isAlarming) {
            Log.d(TAG, "Alarm not active, dismissal ignored")
            return
        }
        isAlarming = false
        testStopRunnable?.let { mainHandler.removeCallbacks(it) }

        Log.i(TAG, "Dismissing native alarm from source: $source")

        stopAudio()
        stopVibration()

        // Provide a distinct single confirmation haptic pulse (150ms)
        confirmHapticPulse()

        listener?.onAlarmDismissed(source)
    }

    private fun startAudio() {
        try {
            stopAudio()

            var alertUri: Uri? = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
            if (alertUri == null) {
                alertUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
            }
            if (alertUri == null) {
                alertUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
            }

            if (alertUri != null) {
                mediaPlayer = MediaPlayer().apply {
                    setDataSource(context, alertUri)
                    setAudioAttributes(
                        AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_ALARM)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                            .build()
                    )
                    isLooping = true
                    prepare()
                    start()
                }
                Log.d(TAG, "MediaPlayer started on USAGE_ALARM stream")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start alarm audio", e)
        }
    }

    private fun stopAudio() {
        try {
            mediaPlayer?.let {
                if (it.isPlaying) {
                    it.stop()
                }
                it.reset()
                it.release()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error stopping audio", e)
        } finally {
            mediaPlayer = null
        }
    }

    private fun startVibration() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val effect = VibrationEffect.createWaveform(VIBRATION_PATTERN, VIBRATION_AMPLITUDES, 0)
                vibrator?.vibrate(effect)
            } else {
                @Suppress("DEPRECATION")
                vibrator?.vibrate(VIBRATION_PATTERN, 0)
            }
            isVibrating = true
        } catch (e: Exception) {
            Log.e(TAG, "Error starting vibration", e)
        }
    }

    private fun stopVibration() {
        try {
            vibrator?.cancel()
            isVibrating = false
        } catch (e: Exception) {
            Log.e(TAG, "Error canceling vibration", e)
        }
    }

    private fun confirmHapticPulse() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator?.vibrate(VibrationEffect.createOneShot(150, VibrationEffect.DEFAULT_AMPLITUDE))
            } else {
                @Suppress("DEPRECATION")
                vibrator?.vibrate(150)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error triggering confirmation haptic", e)
        }
    }

    fun release() {
        testStopRunnable?.let { mainHandler.removeCallbacks(it) }
        stopAudio()
        stopVibration()
        listener = null
    }
}
