package com.busawake.app

import android.content.Context
import android.content.Intent
import android.hardware.Sensor
import android.hardware.SensorManager
import android.location.LocationManager
import android.net.Uri
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log
import android.webkit.JavascriptInterface
import android.widget.Toast
import androidx.core.content.ContextCompat
import org.json.JSONObject

/**
 * JavaScript to Native Android Bridge.
 * Exposes methods to web UI and provides state forwarding from native services.
 */
class AndroidBridge(
    private val activity: MainActivity
) {
    companion object {
        private const val TAG = "AndroidBridge"
    }

    private var testShakeDetector: ShakeDetector? = null

    /**
     * Checks if running inside native Android App environment.
     */
    @JavascriptInterface
    fun isNativeApp(): Boolean {
        return true
    }

    /**
     * Opens Android's system dialer with the phone number pre-filled.
     * Uses Uri.fromParts to safely preserve '+' for country codes without percent-encoding issues.
     */
    @JavascriptInterface
    fun openDialer(phoneNumber: String) {
        val cleanNumber = phoneNumber.trim().replace(" ", "").replace("-", "")
        Log.i(TAG, "openDialer called: raw='$phoneNumber', clean='$cleanNumber'")
        if (cleanNumber.isEmpty()) {
            activity.runOnUiThread {
                Toast.makeText(activity, "⚠️ Phone number is empty", Toast.LENGTH_SHORT).show()
            }
            return
        }

        activity.runOnUiThread {
            try {
                // Uri.fromParts creates RFC 3966 'tel:+91...' without percent-encoding '+'
                val phoneUri = Uri.fromParts("tel", cleanNumber, null)
                val dialIntent = Intent(Intent.ACTION_DIAL, phoneUri).apply {
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK
                }
                activity.startActivity(dialIntent)
                Log.i(TAG, "Successfully started ACTION_DIAL for: $phoneUri")
            } catch (e: Exception) {
                Log.e(TAG, "Failed to launch dialer with Uri.fromParts, trying fallback", e)
                try {
                    val fallbackIntent = Intent(Intent.ACTION_DIAL, Uri.parse("tel:$cleanNumber")).apply {
                        flags = Intent.FLAG_ACTIVITY_NEW_TASK
                    }
                    activity.startActivity(fallbackIntent)
                } catch (e2: Exception) {
                    Log.e(TAG, "Fallback dialer intent failed", e2)
                    Toast.makeText(activity, "⚠️ Unable to open phone dialer", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    /**
     * Starts native alarm sound, vibration, and shake detection.
     * Works both during active background trip and during manual/simulator tests.
     */
    @JavascriptInterface
    fun startAlarmAndShake(reason: String) {
        Log.i(TAG, "startAlarmAndShake requested: $reason")
        activity.runOnUiThread {
            val service = JourneyService.instance
            if (service != null && service.isTripActive) {
                service.alarmController.triggerAlarm(reason)
            } else {
                activity.startStandaloneAlarmAndShake(reason)
            }
        }
    }

    /**
     * Starts the native background Journey Foreground Service.
     */
    @JavascriptInterface
    fun startNativeJourney(
        lat: Double,
        lng: Double,
        radiusMeters: Float,
        contactName: String,
        contactPhone: String,
        stopName: String
    ) {
        Log.i(TAG, "Starting native journey to $stopName ($lat, $lng, r=${radiusMeters}m)")
        activity.runOnUiThread {
            try {
                val intent = Intent(activity, JourneyService::class.java).apply {
                    action = JourneyService.ACTION_START
                    putExtra(JourneyService.EXTRA_TARGET_LAT, lat)
                    putExtra(JourneyService.EXTRA_TARGET_LNG, lng)
                    putExtra(JourneyService.EXTRA_TARGET_RADIUS, radiusMeters)
                    putExtra(JourneyService.EXTRA_TARGET_NAME, stopName)
                    putExtra(JourneyService.EXTRA_CONTACT_NAME, contactName)
                    putExtra(JourneyService.EXTRA_CONTACT_PHONE, contactPhone)
                }
                ContextCompat.startForegroundService(activity, intent)
                Toast.makeText(activity, "🚌 Native GPS commute tracking started", Toast.LENGTH_SHORT).show()
            } catch (e: Exception) {
                Log.e(TAG, "Error starting JourneyService", e)
                Toast.makeText(activity, "⚠️ Failed to start background tracking: ${e.message}", Toast.LENGTH_LONG).show()
            }
        }
    }

    /**
     * Stops the native Journey Foreground Service and any active alarms.
     */
    @JavascriptInterface
    fun stopNativeJourney() {
        Log.i(TAG, "Stopping native journey")
        activity.runOnUiThread {
            try {
                val intent = Intent(activity, JourneyService::class.java).apply {
                    action = JourneyService.ACTION_STOP
                }
                activity.startService(intent)
            } catch (e: Exception) {
                Log.e(TAG, "Error stopping JourneyService", e)
            }
            activity.dismissStandaloneAlarm()
        }
    }

    /**
     * Manually dismisses the native alarm from the UI button.
     */
    @JavascriptInterface
    fun dismissNativeAlarm() {
        Log.i(TAG, "Manual alarm dismiss requested via bridge")
        activity.runOnUiThread {
            JourneyService.instance?.alarmController?.dismissAlarm("manual_button")
            activity.dismissStandaloneAlarm()
        }
    }

    /**
     * Queries device alarm stream volume and DND policies.
     */
    @JavascriptInterface
    fun getAlarmVolumeInfo(): String {
        val tempController = JourneyService.instance?.alarmController ?: AlarmController(activity)
        val status = tempController.getVolumeStatus()
        val json = JSONObject().apply {
            put("currentVolume", status.currentVolume)
            put("maxVolume", status.maxVolume)
            put("percentage", status.percentage)
            put("isMuted", status.isMuted)
            put("isTotalSilence", status.isTotalSilence)
        }
        return json.toString()
    }

    /**
     * Pre-trip test for alarm audio and vibration.
     */
    @JavascriptInterface
    fun testAlarmPlayback(durationMs: Int) {
        activity.runOnUiThread {
            val controller = JourneyService.instance?.alarmController ?: AlarmController(activity)
            controller.testAlarmPlayback(durationMs.toLong()) {
                sendToWeb("if(window.onAlarmTestCompleted) window.onAlarmTestCompleted();")
            }
        }
    }

    /**
     * Recovers active native journey state when web UI reloads or app reopens.
     */
    @JavascriptInterface
    fun getNativeTripState(): String {
        val service = JourneyService.instance
        return if (service != null) {
            service.getSnapshot().toString()
        } else {
            JSONObject().apply {
                put("isTripActive", false)
                put("isAlarming", false)
            }.toString()
        }
    }

    /**
     * Explicit Test Shake Mode for the Settings tab.
     */
    @JavascriptInterface
    fun setShakeTestMode(enabled: Boolean) {
        activity.runOnUiThread {
            if (enabled) {
                if (testShakeDetector == null) {
                    testShakeDetector = ShakeDetector(activity).apply {
                        listener = object : ShakeDetector.Listener {
                            override fun onShakeProgress(count: Int, max: Int) {
                                sendToWeb("if(window.onShakeTestProgress) window.onShakeTestProgress($count, $max);")
                            }

                            override fun onShakeCompleted() {
                                triggerTestHaptic()
                                sendToWeb("if(window.onShakeTestCompleted) window.onShakeTestCompleted();")
                            }

                            override fun onShakeReset() {
                                sendToWeb("if(window.onShakeTestReset) window.onShakeTestReset();")
                            }
                        }
                    }
                }
                testShakeDetector?.start()
                Toast.makeText(activity, "👋 Shake phone 3 times to test", Toast.LENGTH_SHORT).show()
            } else {
                testShakeDetector?.stop()
                testShakeDetector = null
            }
        }
    }

    private fun triggerTestHaptic() {
        try {
            val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val vm = activity.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager
                vm?.defaultVibrator
            } else {
                @Suppress("DEPRECATION")
                activity.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator?.vibrate(VibrationEffect.createOneShot(150, VibrationEffect.DEFAULT_AMPLITUDE))
            } else {
                @Suppress("DEPRECATION")
                vibrator?.vibrate(150)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Haptic error", e)
        }
    }

    /**
     * Queries physical device sensor availability.
     */
    @JavascriptInterface
    fun getNativeSensorCapabilities(): String {
        val sm = activity.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
        val lm = activity.getSystemService(Context.LOCATION_SERVICE) as? LocationManager

        val hasLinearAccel = sm?.getDefaultSensor(Sensor.TYPE_LINEAR_ACCELERATION) != null
        val hasStandardAccel = sm?.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) != null
        val hasMagnetometer = sm?.getDefaultSensor(Sensor.TYPE_MAGNETIC_FIELD) != null
        val hasGps = lm?.isProviderEnabled(LocationManager.GPS_PROVIDER) ?: false

        val json = JSONObject().apply {
            put("hasLinearAccel", hasLinearAccel)
            put("hasStandardAccel", hasStandardAccel)
            put("hasMagnetometer", hasMagnetometer)
            put("hasGps", hasGps)
        }
        return json.toString()
    }

    @JavascriptInterface
    fun showToast(message: String) {
        activity.runOnUiThread {
            Toast.makeText(activity, message, Toast.LENGTH_SHORT).show()
        }
    }

    fun sendToWeb(javascript: String) {
        activity.runOnUiThread {
            activity.evalJs(javascript)
        }
    }
}
