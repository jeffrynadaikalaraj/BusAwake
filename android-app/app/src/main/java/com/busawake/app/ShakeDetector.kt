package com.busawake.app

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import java.util.ArrayDeque
import kotlin.math.PI
import kotlin.math.sqrt

/**
 * Native Shake Detector implementing vector-reversal gesture recognition.
 *
 * Mathematical & Algorithmic Principles:
 * - Gravity-compensated linear acceleration via TYPE_LINEAR_ACCELERATION or dynamic RC low-pass filter.
 * - Normalized cosine similarity threshold: cos(θ) = (p1 · p2) / (|p1| |p2|) <= -0.50 (angle >= 120°).
 * - Peak consumption: completed cycles consume both peaks so one oscillation cannot be double-counted.
 * - Sliding window using ArrayDeque<Long> with active timer-based expiration every 250ms.
 * - Reduced haptic cooldown (100ms), synchronized with 900ms vibration pause.
 * - Aims to reject road potholes, bus braking, and walking motion.
 */
class ShakeDetector(private val context: Context) : SensorEventListener {

    companion object {
        private const val TAG = "ShakeDetector"

        // Peak linear acceleration threshold (m/s²)
        private const val ACCEL_PEAK_THRESHOLD = 13.0f

        // Allowed time interval between opposing half-cycle peaks (100ms - 420ms)
        private const val MIN_REVERSAL_INTERVAL_MS = 100L
        private const val MAX_REVERSAL_INTERVAL_MS = 420L

        // Normalized cosine threshold for opposing reversal (cos(θ) <= -0.50 => θ >= 120°)
        private const val COSINE_REVERSAL_THRESHOLD = -0.50f

        // Sliding window duration: 3 completed shakes must fall within 3000ms
        private const val SLIDING_WINDOW_MS = 3000L

        // Active ticker interval for pruning expired timestamps
        private const val PRUNE_INTERVAL_MS = 250L

        // Haptic feedback suppression window (ms)
        private const val HAPTIC_COOLDOWN_MS = 100L

        // Required shake cycles to dismiss
        const val REQUIRED_SHAKES = 3

        // Gravity low-pass cutoff frequency in Hz
        private const val GRAVITY_CUTOFF_HZ = 0.8
        private const val RC = 1.0 / (2.0 * PI * GRAVITY_CUTOFF_HZ)
    }

    interface Listener {
        fun onShakeProgress(count: Int, max: Int)
        fun onShakeCompleted()
        fun onShakeReset()
    }

    var listener: Listener? = null

    private val sensorManager = context.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
    private var linearAccelSensor: Sensor? = null
    private var standardAccelSensor: Sensor? = null
    private var isUsingFallbackGravity = false

    private var isRunning = false
    private var lastHapticTimestamp = 0L

    // Authoritative Sliding-Window Shake Timestamps
    private val completedShakes = ArrayDeque<Long>()
    private val mainHandler = Handler(Looper.getMainLooper())
    private var pruneRunnable: Runnable? = null

    val shakeCount: Int
        get() = completedShakes.size

    // Vector Reversal Peak Tracking
    private data class Peak(
        val x: Float,
        val y: Float,
        val z: Float,
        val magnitude: Float,
        val timestampMs: Long
    )

    private var lastPeak: Peak? = null
    private var pendingHalfCycle: Peak? = null
    private var candidatePeak: Peak? = null

    // Dynamic gravity estimation (RC low-pass filter)
    private val gravity = FloatArray(3) { 0f }
    private var lastFilterTimestampNs = 0L
    private var gravityInitialized = false

    init {
        linearAccelSensor = sensorManager?.getDefaultSensor(Sensor.TYPE_LINEAR_ACCELERATION)
        if (linearAccelSensor == null) {
            standardAccelSensor = sensorManager?.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
            isUsingFallbackGravity = true
            Log.i(TAG, "TYPE_LINEAR_ACCELERATION not present. Using dynamic RC low-pass filter on TYPE_ACCELEROMETER.")
        } else {
            Log.i(TAG, "Acquired hardware/HAL TYPE_LINEAR_ACCELERATION sensor.")
        }
    }

    /**
     * Start detecting shakes.
     */
    fun start() {
        if (isRunning) return
        resetSequence()

        val sensorToRegister = linearAccelSensor ?: standardAccelSensor
        if (sensorToRegister == null) {
            Log.w(TAG, "No motion sensor available on device!")
            return
        }

        val registered = sensorManager?.registerListener(
            this,
            sensorToRegister,
            SensorManager.SENSOR_DELAY_GAME
        ) ?: false

        isRunning = registered
        startPruneTimer()
        Log.i(TAG, "ShakeDetector active. Registered: $registered (fallbackGravity=$isUsingFallbackGravity)")
    }

    /**
     * Stop detector and free sensor listener.
     */
    fun stop() {
        if (!isRunning) return
        stopPruneTimer()
        sensorManager?.unregisterListener(this)
        isRunning = false
        resetSequence()
        Log.i(TAG, "ShakeDetector stopped.")
    }

    /**
     * Notify detector of motor vibration so readings during vibration
     * and for 100ms after are ignored.
     */
    fun notifyHapticActive() {
        lastHapticTimestamp = SystemClock.elapsedRealtime()
    }

    fun resetSequence() {
        completedShakes.clear()
        lastPeak = null
        pendingHalfCycle = null
        candidatePeak = null
        gravityInitialized = false
        lastFilterTimestampNs = 0L
    }

    private fun startPruneTimer() {
        stopPruneTimer()
        pruneRunnable = object : Runnable {
            override fun run() {
                if (!isRunning) return
                pruneExpiredShakes()
                mainHandler.postDelayed(this, PRUNE_INTERVAL_MS)
            }
        }
        mainHandler.postDelayed(pruneRunnable!!, PRUNE_INTERVAL_MS)
    }

    private fun stopPruneTimer() {
        pruneRunnable?.let { mainHandler.removeCallbacks(it) }
        pruneRunnable = null
    }

    /**
     * Actively discards timestamps older than 3000ms.
     * Updates displayed count even when the device is completely still.
     */
    private fun pruneExpiredShakes() {
        if (completedShakes.isEmpty()) return

        val now = SystemClock.elapsedRealtime()
        var changed = false

        while (completedShakes.isNotEmpty() && (now - completedShakes.peekFirst()!! > SLIDING_WINDOW_MS)) {
            completedShakes.removeFirst()
            changed = true
        }

        if (changed) {
            val currentCount = completedShakes.size
            Log.d(TAG, "Pruned expired shakes. Active remaining: $currentCount")
            if (currentCount > 0) {
                listener?.onShakeProgress(currentCount, REQUIRED_SHAKES)
            } else {
                listener?.onShakeReset()
            }
        }
    }

    override fun onSensorChanged(event: SensorEvent?) {
        if (!isRunning || event == null) return

        val now = SystemClock.elapsedRealtime()

        // 1. Ignore if in haptic vibration suppression window
        if (now - lastHapticTimestamp < HAPTIC_COOLDOWN_MS) {
            return
        }

        // 2. Compute gravity-compensated linear acceleration
        val lx: Float
        val ly: Float
        val lz: Float

        if (isUsingFallbackGravity) {
            val eventTimestampNs = event.timestamp
            if (!gravityInitialized || lastFilterTimestampNs == 0L) {
                gravity[0] = event.values[0]
                gravity[1] = event.values[1]
                gravity[2] = event.values[2]
                gravityInitialized = true
            } else {
                val dtSec = (eventTimestampNs - lastFilterTimestampNs) / 1_000_000_000.0
                if (dtSec in 0.001..0.2) {
                    val alpha = (RC / (RC + dtSec)).toFloat()
                    gravity[0] = alpha * gravity[0] + (1 - alpha) * event.values[0]
                    gravity[1] = alpha * gravity[1] + (1 - alpha) * event.values[1]
                    gravity[2] = alpha * gravity[2] + (1 - alpha) * event.values[2]
                }
            }
            lastFilterTimestampNs = eventTimestampNs

            lx = event.values[0] - gravity[0]
            ly = event.values[1] - gravity[1]
            lz = event.values[2] - gravity[2]
        } else {
            lx = event.values[0]
            ly = event.values[1]
            lz = event.values[2]
        }

        val magnitude = sqrt((lx * lx + ly * ly + lz * lz).toDouble()).toFloat()

        // 3. Peak Identification & Tracking
        if (magnitude >= ACCEL_PEAK_THRESHOLD) {
            val currentCandidate = candidatePeak
            if (currentCandidate == null || magnitude > currentCandidate.magnitude) {
                candidatePeak = Peak(lx, ly, lz, magnitude, now)
            }
        } else {
            candidatePeak?.let { committedPeak ->
                processPeak(committedPeak)
                candidatePeak = null
            }
        }
    }

    /**
     * Evaluates peak for normalized vector reversal.
     */
    private fun processPeak(newPeak: Peak) {
        val prev = lastPeak

        if (prev == null) {
            lastPeak = newPeak
            return
        }

        val deltaT = newPeak.timestampMs - prev.timestampMs

        // Reject high-frequency vibrations / pothole chatter (< 100ms)
        if (deltaT < MIN_REVERSAL_INTERVAL_MS) {
            return
        }

        // Sequence broke (> 420ms)
        if (deltaT > MAX_REVERSAL_INTERVAL_MS) {
            lastPeak = newPeak
            pendingHalfCycle = null
            return
        }

        // Normalized Cosine Similarity: (p_prev · p_new) / (|p_prev| * |p_new|)
        val dotProduct = (prev.x * newPeak.x) + (prev.y * newPeak.y) + (prev.z * newPeak.z)
        val denominator = prev.magnitude * newPeak.magnitude
        val cosineSimilarity = if (denominator > 0.0001f) dotProduct / denominator else 0f

        if (cosineSimilarity <= COSINE_REVERSAL_THRESHOLD) {
            // STRONG OPPOSING REVERSAL (angle >= 120°)
            Log.d(TAG, "Reversal verified: cos=$cosineSimilarity (θ >= 120°), dt=${deltaT}ms")

            if (pendingHalfCycle == null) {
                // First reversal completes the 1st half-cycle
                pendingHalfCycle = newPeak
                lastPeak = newPeak
            } else {
                // Second opposing reversal completes ONE FULL BACK-AND-FORTH SHAKE CYCLE!
                // Strict peak consumption: clear both peaks so neither can be reused
                onSingleShakeCycleCompleted(newPeak.timestampMs)
                pendingHalfCycle = null
                lastPeak = null
            }
        } else {
            // Unidirectional force (e.g. bus braking, continuous bump)
            if (newPeak.magnitude > prev.magnitude) {
                lastPeak = newPeak
            }
        }
    }

    private fun onSingleShakeCycleCompleted(now: Long) {
        // Prune older shakes before adding new
        pruneExpiredShakes()

        completedShakes.addLast(now)
        val count = completedShakes.size
        Log.i(TAG, ">>> Verified Shake Count: $count / $REQUIRED_SHAKES <<<")
        listener?.onShakeProgress(count, REQUIRED_SHAKES)

        if (count >= REQUIRED_SHAKES) {
            Log.i(TAG, "🎉 3 verified shakes completed within sliding window!")
            listener?.onShakeCompleted()
            completedShakes.clear()
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
}
