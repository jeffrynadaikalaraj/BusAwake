package com.busawake.app

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Binder
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import androidx.core.app.NotificationCompat
import org.json.JSONObject

/**
 * Foreground Service for active transit journey monitoring, background GPS tracking,
 * geofence distance calculation, and native alarm & shake gesture coordination.
 */
class JourneyService : Service(), LocationListener {

    companion object {
        private const val TAG = "JourneyService"
        const val CHANNEL_ID = "busawake_journey_channel"
        const val NOTIFICATION_ID = 1001

        const val ACTION_START = "com.busawake.app.START_JOURNEY"
        const val ACTION_STOP = "com.busawake.app.STOP_JOURNEY"
        const val ACTION_DISMISS_ALARM = "com.busawake.app.DISMISS_ALARM"

        const val EXTRA_TARGET_LAT = "extra_target_lat"
        const val EXTRA_TARGET_LNG = "extra_target_lng"
        const val EXTRA_TARGET_RADIUS = "extra_target_radius"
        const val EXTRA_TARGET_NAME = "extra_target_name"
        const val EXTRA_CONTACT_NAME = "extra_contact_name"
        const val EXTRA_CONTACT_PHONE = "extra_contact_phone"

        var instance: JourneyService? = null
            private set
    }

    inner class LocalBinder : Binder() {
        fun getService(): JourneyService = this@JourneyService
    }

    private val binder = LocalBinder()

    interface JourneyListener {
        fun onLocationUpdate(
            lat: Double,
            lng: Double,
            speedKmh: Float,
            speedAccuracyKmh: Float,
            accuracyMeters: Float,
            bearing: Float,
            ageMs: Long,
            distRemainingMeters: Float
        )
        fun onAlarmTriggered(stopName: String, distRemainingMeters: Float)
        fun onShakeProgress(count: Int, max: Int)
        fun onShakeReset()
        fun onAlarmDismissed(source: String, contactName: String, contactPhone: String)
    }

    var listener: JourneyListener? = null

    // Target journey parameters
    var targetLat: Double = 13.1143
    var targetLng: Double = 80.1548
    var targetRadiusMeters: Float = 400.0f
    var targetStopName: String = "Ambattur OT Bus Stand"
    var contactName: String = "Dad"
    var contactPhone: String = "9444883897"

    var isTripActive: Boolean = false
        private set

    // Single-trip trigger latch to prevent duplicate alarm cycles
    private var hasTriggeredForStop = false

    // Last known metrics for UI restoration
    var lastDistRemainingMeters: Float = -1f
        private set
    var lastSpeedKmh: Float = 0f
        private set

    private var locationManager: LocationManager? = null
    private var wakeLock: PowerManager.WakeLock? = null

    lateinit var alarmController: AlarmController
        private set
    lateinit var shakeDetector: ShakeDetector
        private set

    override fun onCreate() {
        super.onCreate()
        instance = this
        alarmController = AlarmController(this)
        shakeDetector = ShakeDetector(this)

        setupAlarmAndShakeListeners()
        createNotificationChannel()

        locationManager = getSystemService(Context.LOCATION_SERVICE) as? LocationManager
        Log.i(TAG, "JourneyService initialized.")
    }

    private fun setupAlarmAndShakeListeners() {
        shakeDetector.listener = object : ShakeDetector.Listener {
            override fun onShakeProgress(count: Int, max: Int) {
                Log.d(TAG, "Shake progress: $count/$max")
                listener?.onShakeProgress(count, max)
            }

            override fun onShakeCompleted() {
                Log.i(TAG, "3 shakes completed natively. Silencing alarm.")
                alarmController.dismissAlarm("shake")
                shakeDetector.stop()
                updateNotification(
                    title = "✅ Alarm Silenced",
                    text = "Near $targetStopName. Have a safe journey!",
                    isAlert = false
                )
            }

            override fun onShakeReset() {
                Log.d(TAG, "Shake sequence reset")
                listener?.onShakeReset()
            }
        }

        alarmController.listener = object : AlarmController.Listener {
            override fun onAlarmStarted(reason: String) {
                Log.i(TAG, "Alarm started natively: $reason")
                shakeDetector.start()
                updateNotification(
                    title = "🚨 WAKE UP! NEAR STOP!",
                    text = "Near $targetStopName! Shake phone 3 times or tap Silence.",
                    isAlert = true
                )
            }

            override fun onAlarmDismissed(source: String) {
                Log.i(TAG, "Alarm dismissed natively by $source")
                shakeDetector.stop()
                listener?.onAlarmDismissed(source, contactName, contactPhone)
                updateNotification(
                    title = "✅ Alarm Silenced",
                    text = "Near $targetStopName. Silenced via $source.",
                    isAlert = false
                )
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent == null) return START_NOT_STICKY

        when (intent.action) {
            ACTION_START -> {
                targetLat = intent.getDoubleExtra(EXTRA_TARGET_LAT, 13.1143)
                targetLng = intent.getDoubleExtra(EXTRA_TARGET_LNG, 80.1548)
                targetRadiusMeters = intent.getFloatExtra(EXTRA_TARGET_RADIUS, 400f)
                targetStopName = intent.getStringExtra(EXTRA_TARGET_NAME) ?: "Ambattur OT Bus Stand"
                contactName = intent.getStringExtra(EXTRA_CONTACT_NAME) ?: "Dad"
                contactPhone = intent.getStringExtra(EXTRA_CONTACT_PHONE) ?: "9444883897"
                hasTriggeredForStop = false

                startJourney()
            }
            ACTION_STOP -> {
                stopJourney()
                stopSelf()
            }
            ACTION_DISMISS_ALARM -> {
                Log.i(TAG, "Dismiss action received from notification shade")
                alarmController.dismissAlarm("notification_action")
            }
        }

        return START_STICKY
    }

    @SuppressLint("MissingPermission")
    private fun startJourney() {
        if (isTripActive) {
            Log.d(TAG, "Journey already active")
            return
        }
        isTripActive = true
        hasTriggeredForStop = false

        acquireWakeLock()
        startForegroundWithNotification()

        try {
            // Register GPS Provider
            locationManager?.requestLocationUpdates(
                LocationManager.GPS_PROVIDER,
                2000L,
                3.0f,
                this
            )

            // Register Network Provider for quick initial fix
            locationManager?.requestLocationUpdates(
                LocationManager.NETWORK_PROVIDER,
                3000L,
                5.0f,
                this
            )
            Log.i(TAG, "Location listeners registered for $targetStopName")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to register location updates", e)
        }
    }

    fun stopJourney() {
        if (!isTripActive) return
        isTripActive = false
        hasTriggeredForStop = false
        Log.i(TAG, "Stopping active journey")

        try {
            locationManager?.removeUpdates(this)
        } catch (e: Exception) {
            Log.e(TAG, "Error removing location updates", e)
        } finally {
            alarmController.dismissAlarm("trip_stopped")
            shakeDetector.stop()
            releaseWakeLock()
            stopForeground(STOP_FOREGROUND_REMOVE)
        }
    }

    override fun onLocationChanged(location: Location) {
        if (!isTripActive) return

        // 1. Monotonic fix age calculation
        val ageMs = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR1) {
            (SystemClock.elapsedRealtimeNanos() - location.elapsedRealtimeNanos) / 1_000_000L
        } else {
            System.currentTimeMillis() - location.time
        }

        // 2. Safe metric extraction with null/has checks
        val speedKmh = if (location.hasSpeed()) location.speed * 3.6f else 0.0f
        val speedAccuracyKmh = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && location.hasSpeedAccuracy()) {
            location.speedAccuracyMetersPerSecond * 3.6f
        } else {
            -1.0f
        }
        val accuracyMeters = if (location.hasAccuracy()) location.accuracy else -1.0f
        val bearing = if (location.hasBearing()) location.bearing else -1.0f

        lastSpeedKmh = speedKmh

        // 3. Distance calculation
        val results = FloatArray(1)
        Location.distanceBetween(
            location.latitude,
            location.longitude,
            targetLat,
            targetLng,
            results
        )
        val distToTarget = results[0]
        lastDistRemainingMeters = distToTarget

        Log.d(TAG, "GPS fix: dist=${distToTarget.toInt()}m, speed=${speedKmh.toInt()}km/h, acc=${accuracyMeters.toInt()}m, age=${ageMs}ms")

        // 4. Update notification text
        if (!alarmController.isAlarming) {
            val distText = if (distToTarget >= 1000) {
                String.format("%.1f km", distToTarget / 1000.0f)
            } else {
                "${distToTarget.toInt()} m"
            }
            updateNotification(
                title = "🚌 Tracking: Near $targetStopName",
                text = "Distance: $distText • Speed: ${speedKmh.toInt()} km/h",
                isAlert = false
            )
        }

        // 5. Notify UI layer
        listener?.onLocationUpdate(
            location.latitude,
            location.longitude,
            speedKmh,
            speedAccuracyKmh,
            accuracyMeters,
            bearing,
            ageMs,
            distToTarget
        )

        // 6. Geofence Evaluation with single-trip latch and freshness check
        if (!hasTriggeredForStop && distToTarget <= targetRadiusMeters) {
            // Discard fixes older than 10 seconds to prevent triggering on stale cached coordinates
            if (ageMs <= 10_000L) {
                hasTriggeredForStop = true
                Log.i(TAG, "🎯 GEOFENCE TRIGGERED! Distance $distToTarget <= $targetRadiusMeters m (age: ${ageMs}ms)")
                alarmController.triggerAlarm("Near stop: $targetStopName")
                listener?.onAlarmTriggered(targetStopName, distToTarget)
            } else {
                Log.w(TAG, "Ignoring geofence hit from stale GPS fix (age: ${ageMs}ms)")
            }
        }
    }

    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
    override fun onProviderEnabled(provider: String) {}
    override fun onProviderDisabled(provider: String) {}

    private fun startForegroundWithNotification() {
        val notification = buildNotification(
            title = "🚌 BusAwake: Active Commute",
            text = "Tracking to $targetStopName. Alarm triggers near stop (${targetRadiusMeters.toInt()}m).",
            isAlert = false
        )

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun updateNotification(title: String, text: String, isAlert: Boolean = false) {
        val notification = buildNotification(title, text, isAlert)
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
        manager?.notify(NOTIFICATION_ID, notification)
    }

    private fun buildNotification(title: String, text: String, isAlert: Boolean): Notification {
        val launchIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val pendingLaunch = PendingIntent.getActivity(
            this,
            0,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_bus_launcher)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(pendingLaunch)
            .setOngoing(!isAlert)
            .setOnlyAlertOnce(!isAlert)

        if (isAlert) {
            builder.setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_ALARM)

            // Direct Silence Alarm Action in Notification Shade
            val dismissIntent = Intent(this, JourneyService::class.java).apply {
                action = ACTION_DISMISS_ALARM
            }
            val pendingDismiss = PendingIntent.getService(
                this,
                1,
                dismissIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            builder.addAction(R.drawable.ic_bus_launcher, "SILENCE ALARM", pendingDismiss)
        } else {
            builder.setPriority(NotificationCompat.PRIORITY_DEFAULT)

            // Stop Trip Action Button
            val stopIntent = Intent(this, JourneyService::class.java).apply {
                action = ACTION_STOP
            }
            val pendingStop = PendingIntent.getService(
                this,
                2,
                stopIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            builder.addAction(R.drawable.ic_bus_launcher, "Stop Trip", pendingStop)
        }

        return builder.build()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "BusAwake Active Trip",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Shows live transit tracking and geofence wake-up alerts"
            }
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
            manager?.createNotificationChannel(channel)
        }
    }

    private fun acquireWakeLock() {
        try {
            if (wakeLock == null) {
                val pm = getSystemService(Context.POWER_SERVICE) as? PowerManager
                wakeLock = pm?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "BusAwake::JourneyWakeLock")
                wakeLock?.acquire(90 * 60 * 1000L) // Bounded max: 90 minutes
                Log.d(TAG, "WakeLock acquired (bounded 90m)")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error acquiring WakeLock", e)
        }
    }

    private fun releaseWakeLock() {
        try {
            if (wakeLock?.isHeld == true) {
                wakeLock?.release()
                wakeLock = null
                Log.d(TAG, "WakeLock safely released")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error releasing WakeLock", e)
        }
    }

    /**
     * Snapshot of current native trip state for web UI recovery.
     */
    fun getSnapshot(): JSONObject {
        return JSONObject().apply {
            put("isTripActive", isTripActive)
            put("isAlarming", alarmController.isAlarming)
            put("hasTriggered", hasTriggeredForStop)
            put("targetStopName", targetStopName)
            put("contactName", contactName)
            put("contactPhone", contactPhone)
            put("lastDistRemainingMeters", lastDistRemainingMeters)
            put("lastSpeedKmh", lastSpeedKmh)
        }
    }

    override fun onBind(intent: Intent?): IBinder = binder

    override fun onDestroy() {
        super.onDestroy()
        stopJourney()
        alarmController.release()
        shakeDetector.stop()
        instance = null
        Log.i(TAG, "JourneyService destroyed.")
    }
}
