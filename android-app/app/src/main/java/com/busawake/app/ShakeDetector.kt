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
import kotlin.math.sqrt

/**
 * Native Shake Detector implementing responsive vector-reversal gesture recognition.
 * Optimized for natural wrist shaking on real Android phones.
 */
class ShakeDetector(private val context: Context) : SensorEventListener {

    companion object {
        private const val TAG = "ShakeDetector"

        // Peak linear acceleration threshold (m/s²) - comfortable wrist shake
        private const val ACCEL_PEAK_THRESHOLD = 5.5f

        // Allowed time interval between opposing reversal peaks (80ms - 750ms)
        private const val MIN_REVERSAL_INTERVAL_MS = 80L
        private const val MAX_REVERSAL_INTERVAL_MS = 750L

        // Normalized cosine threshold for opposing reversal (cos(θ) <= -0.25 => θ >= 105°)
        private const val COSINE_REVERSAL_THRESHOLD = -0.25f

        // Sliding window duration: 3 shakes within 4000ms
        private const val SLIDING_WINDOW_MS = 4000L

        // Active ticker interval for pruning expired timestamps
        private const val PRUNE_INTERVAL_MS = 250L

        // Required shake cycles to dismiss
        const val REQUIRED_SHAKES = 3
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

    // Sliding-Window Shake Timestamps
    private val completedShakes = ArrayDeque<Long>()
    private val mainHandler = Handler(Looper.getMainLooper())
    private var pruneRunnable: Runnable? = null

    val shakeCount: Int
        get() = completedShakes.size

    // Peak Tracking
    private data class Peak(
        val x: Float,
        val y: Float,
        val z: Float,
        val magnitude: Float,
        val timestampMs: Long
    )

    private var lastPeak: Peak? = null
    private var candidatePeak: Peak? = null

    // Gravity estimation for standard accelerometer
    private val gravity = FloatArray(3) { 0f }
    private var gravityInitialized = false

    init {
        linearAccelSensor = sensorManager?.getDefaultSensor(Sensor.TYPE_LINEAR_ACCELERATION)
        standardAccelSensor = sensorManager?.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
        if (linearAccelSensor == null) {
            isUsingFallbackGravity = true
            Log.i(TAG, "TYPE_LINEAR_ACCELERATION not present, using standard accelerometer with gravity filter.")
        } else {
            Log.i(TAG, "Acquired hardware TYPE_LINEAR_ACCELERATION sensor.")
        }
    }

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
            SensorManager.SENSOR_DELAY_UI
        ) ?: false

        isRunning = registered
        startPruneTimer()
        Log.i(TAG, "ShakeDetector active: registered=$registered (sensor=${sensorToRegister.name})")
    }

    fun stop() {
        if (!isRunning) return
        stopPruneTimer()
        sensorManager?.unregisterListener(this)
        isRunning = false
        resetSequence()
        Log.i(TAG, "ShakeDetector stopped.")
    }

    fun resetSequence() {
        completedShakes.clear()
        lastPeak = null
        candidatePeak = null
        gravityInitialized = false
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
            Log.d(TAG, "Pruned expired shakes. Active: $currentCount")
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

        val lx: Float
        val ly: Float
        val lz: Float

        if (isUsingFallbackGravity || linearAccelSensor == null) {
            if (!gravityInitialized) {
                gravity[0] = event.values[0]
                gravity[1] = event.values[1]
                gravity[2] = event.values[2]
                gravityInitialized = true
            } else {
                // Alpha = 0.8 / 0.2 gives smooth orientation tracking without lagging
                gravity[0] = 0.8f * gravity[0] + 0.2f * event.values[0]
                gravity[1] = 0.8f * gravity[1] + 0.2f * event.values[1]
                gravity[2] = 0.8f * gravity[2] + 0.2f * event.values[2]
            }
            lx = event.values[0] - gravity[0]
            ly = event.values[1] - gravity[1]
            lz = event.values[2] - gravity[2]
        } else {
            lx = event.values[0]
            ly = event.values[1]
            lz = event.values[2]
        }

        val magnitude = sqrt((lx * lx + ly * ly + lz * lz).toDouble()).toFloat()

        if (magnitude >= ACCEL_PEAK_THRESHOLD) {
            val current = candidatePeak
            if (current == null || magnitude > current.magnitude) {
                candidatePeak = Peak(lx, ly, lz, magnitude, now)
            }
        } else {
            candidatePeak?.let { committed ->
                processPeak(committed)
                candidatePeak = null
            }
        }
    }

    private fun processPeak(newPeak: Peak) {
        val prev = lastPeak

        if (prev == null) {
            lastPeak = newPeak
            return
        }

        val deltaT = newPeak.timestampMs - prev.timestampMs

        // Debounce high frequency noise (< 80ms)
        if (deltaT < MIN_REVERSAL_INTERVAL_MS) {
            return
        }

        // Timeout between peaks (> 750ms)
        if (deltaT > MAX_REVERSAL_INTERVAL_MS) {
            lastPeak = newPeak
            return
        }

        // Cosine similarity between peaks
        val dot = (prev.x * newPeak.x) + (prev.y * newPeak.y) + (prev.z * newPeak.z)
        val denom = prev.magnitude * newPeak.magnitude
        val cos = if (denom > 0.001f) dot / denom else 0f

        if (cos <= COSINE_REVERSAL_THRESHOLD) {
            // Valid opposing reversal (one full shake back-and-forth)
            Log.i(TAG, "Shake reversal confirmed: cos=$cos, dt=${deltaT}ms")
            lastPeak = null // Consume peak
            onSingleShakeCycleCompleted(newPeak.timestampMs)
        } else if (newPeak.magnitude > prev.magnitude) {
            lastPeak = newPeak
        }
    }

    private fun onSingleShakeCycleCompleted(now: Long) {
        pruneExpiredShakes()
        completedShakes.addLast(now)
        val count = completedShakes.size
        Log.i(TAG, ">>> Verified Shake Count: $count / $REQUIRED_SHAKES <<<")
        listener?.onShakeProgress(count, REQUIRED_SHAKES)

        if (count >= REQUIRED_SHAKES) {
            Log.i(TAG, "🎉 3 shakes completed! Triggering dismissal.")
            listener?.onShakeCompleted()
            completedShakes.clear()
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
}
