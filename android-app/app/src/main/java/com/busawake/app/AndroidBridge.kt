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
     * Directly places a cellular phone call automatically without requiring the user
     * to tap the green dialer button. Falls back to ACTION_DIAL if permission not granted.
     */
    @JavascriptInterface
    fun makeDirectCall(phoneNumber: String) {
        val cleanNumber = phoneNumber.trim().replace(" ", "").replace("-", "")
        Log.i(TAG, "makeDirectCall called with: $phoneNumber (clean: $cleanNumber)")
        if (cleanNumber.isEmpty()) {
            activity.runOnUiThread {
                Toast.makeText(activity, "⚠️ Phone number is empty", Toast.LENGTH_SHORT).show()
            }
            return
        }

        activity.runOnUiThread {
            try {
                val hasCallPermission = ContextCompat.checkSelfPermission(
                    activity,
                    android.Manifest.permission.CALL_PHONE
                ) == android.content.pm.PackageManager.PERMISSION_GRANTED

                val phoneUri = Uri.fromParts("tel", cleanNumber, null)
                val intent = if (hasCallPermission) {
                    Intent(Intent.ACTION_CALL, phoneUri).apply {
                        flags = Intent.FLAG_ACTIVITY_NEW_TASK
                    }
                } else {
                    Intent(Intent.ACTION_DIAL, phoneUri).apply {
                        flags = Intent.FLAG_ACTIVITY_NEW_TASK
                    }
                }
                activity.startActivity(intent)
                Log.i(TAG, "Successfully initiated ${if (hasCallPermission) "ACTION_CALL (automatic direct call)" else "ACTION_DIAL"} for: $phoneUri")
            } catch (e: Exception) {
                Log.e(TAG, "makeDirectCall failed, falling back to dialer", e)
                openDialer(cleanNumber)
            }
        }
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
     * Dispatches WhatsApp message and arms the Accessibility Auto-Sender Service
     * to automatically tap Send if enabled in system settings.
     */
    @JavascriptInterface
    fun sendWhatsAppAuto(phoneNumber: String, message: String) {
        val cleanDigits = phoneNumber.trim().replace("+", "").replace(" ", "").replace("-", "")
        Log.i(TAG, "sendWhatsAppAuto called: digits='$cleanDigits'")
        if (cleanDigits.isEmpty()) {
            activity.runOnUiThread {
                Toast.makeText(activity, "⚠️ WhatsApp contact number is empty", Toast.LENGTH_SHORT).show()
            }
            return
        }

        activity.runOnUiThread {
            try {
                // Check if Accessibility Service is active; if so, arm it
                val isServiceActive = WhatsAppAutoSenderService.isServiceActive || isAccessibilityServiceEnabled()
                if (isServiceActive) {
                    WhatsAppAutoSenderService.arm()
                    Log.i(TAG, "WhatsApp Auto-Clicker armed for automated send!")
                } else {
                    Toast.makeText(activity, "ℹ️ Enable BusAwake in Accessibility Settings to auto-send without tapping!", Toast.LENGTH_LONG).show()
                }

                val waUri = Uri.parse("https://api.whatsapp.com/send?phone=$cleanDigits&text=${Uri.encode(message)}")
                val intent = Intent(Intent.ACTION_VIEW, waUri).apply {
                    setPackage("com.whatsapp")
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK
                }
                try {
                    activity.startActivity(intent)
                } catch (pkgErr: Exception) {
                    // Try WhatsApp Business or default handler
                    val fallbackIntent = Intent(Intent.ACTION_VIEW, waUri).apply {
                        flags = Intent.FLAG_ACTIVITY_NEW_TASK
                    }
                    activity.startActivity(fallbackIntent)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to launch WhatsApp intent", e)
                Toast.makeText(activity, "⚠️ Unable to open WhatsApp: ${e.message}", Toast.LENGTH_SHORT).show()
            }
        }
    }

    /**
     * Checks if WhatsAppAutoSenderService is enabled in Android system settings.
     */
    @JavascriptInterface
    fun isAccessibilityServiceEnabled(): Boolean {
        return try {
            val expectedComponentName = "${activity.packageName}/${WhatsAppAutoSenderService::class.java.canonicalName}"
            val enabledServices = android.provider.Settings.Secure.getString(
                activity.contentResolver,
                android.provider.Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
            ) ?: ""
            enabledServices.contains(activity.packageName) || WhatsAppAutoSenderService.isServiceActive
        } catch (e: Exception) {
            WhatsAppAutoSenderService.isServiceActive
        }
    }

    /**
     * Opens Android's system Accessibility Settings page so user can toggle BusAwake ON.
     */
    @JavascriptInterface
    fun openAccessibilitySettings() {
        activity.runOnUiThread {
            try {
                val intent = Intent(android.provider.Settings.ACTION_ACCESSIBILITY_SETTINGS).apply {
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK
                }
                activity.startActivity(intent)
                Toast.makeText(activity, "👉 Turn ON 'BusAwake' under Installed / Downloaded Apps", Toast.LENGTH_LONG).show()
            } catch (e: Exception) {
                Log.e(TAG, "Failed to open Accessibility Settings", e)
                Toast.makeText(activity, "⚠️ Please open Settings -> Accessibility manually", Toast.LENGTH_SHORT).show()
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
