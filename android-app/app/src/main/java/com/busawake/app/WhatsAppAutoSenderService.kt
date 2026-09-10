package com.busawake.app

import android.accessibilityservice.AccessibilityService
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

/**
 * Accessibility Service that automatically clicks "Send" inside WhatsApp
 * when BusAwake dispatches an automated commute alert to a designated contact.
 *
 * Designed to only operate when explicitly armed by BusAwake, automatically
 * disarming after sending to prevent unintended clicks.
 */
class WhatsAppAutoSenderService : AccessibilityService() {

    companion object {
        private const val TAG = "WhatsAppAutoSender"

        @Volatile
        var isArmed: Boolean = false
            private set

        private var armedTimestamp: Long = 0L
        private const val ARM_TIMEOUT_MS: Long = 12_000L // 12 seconds max window

        var isServiceActive: Boolean = false
            private set

        /**
         * Arms the auto-sender just before launching WhatsApp intent.
         */
        fun arm() {
            isArmed = true
            armedTimestamp = SystemClock.elapsedRealtime()
            Log.i(TAG, "WhatsApp Auto-Sender ARMED for dispatch.")
        }

        /**
         * Disarms the auto-sender.
         */
        fun disarm() {
            isArmed = false
            Log.i(TAG, "WhatsApp Auto-Sender DISARMED.")
        }
    }

    private val mainHandler = Handler(Looper.getMainLooper())

    override fun onServiceConnected() {
        super.onServiceConnected()
        isServiceActive = true
        Log.i(TAG, "WhatsAppAutoSenderService connected and active.")
    }

    override fun onDestroy() {
        super.onDestroy()
        isServiceActive = false
        disarm()
        Log.i(TAG, "WhatsAppAutoSenderService destroyed.")
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (!isArmed || event == null) return

        // Auto-disarm if window expired
        val elapsed = SystemClock.elapsedRealtime() - armedTimestamp
        if (elapsed > ARM_TIMEOUT_MS) {
            disarm()
            return
        }

        val pkgName = event.packageName?.toString() ?: ""
        if (pkgName != "com.whatsapp" && pkgName != "com.whatsapp.w4b") {
            return
        }

        val rootNode = rootInActiveWindow ?: return

        // Attempt to find and click the WhatsApp Send button
        val clicked = findAndClickSendButton(rootNode)
        if (clicked) {
            Log.i(TAG, "Successfully auto-clicked WhatsApp Send button!")
            disarm()

            // Wait 350ms for WhatsApp message to transmit, then return to BusAwake
            mainHandler.postDelayed({
                try {
                    performGlobalAction(GLOBAL_ACTION_BACK)
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to perform back action", e)
                }
            }, 350L)
        }
    }

    private fun findAndClickSendButton(root: AccessibilityNodeInfo): Boolean {
        // Strategy 1: Direct Resource ID lookup (Standard WhatsApp & WhatsApp Business)
        val targetIds = listOf(
            "com.whatsapp:id/send",
            "com.whatsapp.w4b:id/send"
        )
        for (id in targetIds) {
            val nodes = root.findAccessibilityNodeInfosByViewId(id)
            for (node in nodes) {
                if (performClickOnNode(node)) {
                    return true
                }
            }
        }

        // Strategy 2: Content Description lookup ("Send" in English / common locales)
        val textMatches = root.findAccessibilityNodeInfosByText("Send")
        for (node in textMatches) {
            if (node.isClickable || node.parent?.isClickable == true) {
                if (performClickOnNode(node)) {
                    return true
                }
            }
        }

        // Strategy 3: Recursive scan for ImageButton with Send contentDescription
        return scanForSendNode(root)
    }

    private fun scanForSendNode(node: AccessibilityNodeInfo?): Boolean {
        if (node == null) return false

        val desc = node.contentDescription?.toString()?.lowercase() ?: ""
        if (desc == "send" || desc.contains("send") || desc == "sent") {
            if (performClickOnNode(node)) {
                return true
            }
        }

        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            if (scanForSendNode(child)) {
                return true
            }
        }
        return false
    }

    private fun performClickOnNode(node: AccessibilityNodeInfo): Boolean {
        var current: AccessibilityNodeInfo? = node
        while (current != null) {
            if (current.isClickable) {
                val success = current.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                if (success) return true
            }
            current = current.parent
        }
        return false
    }

    override fun onInterrupt() {
        Log.w(TAG, "WhatsAppAutoSenderService interrupted.")
        disarm()
    }
}
