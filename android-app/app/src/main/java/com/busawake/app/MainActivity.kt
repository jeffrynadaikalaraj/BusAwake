package com.busawake.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.util.Log
import android.view.View
import android.webkit.GeolocationPermissions
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.ProgressBar
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat

class MainActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "MainActivity"
    }

    lateinit var webView: WebView
        private set
    private lateinit var progressBar: ProgressBar
    lateinit var bridge: AndroidBridge
        private set

    private var journeyService: JourneyService? = null
    private var isBound = false

    private var standaloneAlarmController: AlarmController? = null
    private var standaloneShakeDetector: ShakeDetector? = null

    private val serviceConnection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
            val binder = service as? JourneyService.LocalBinder
            journeyService = binder?.getService()
            isBound = true
            setupServiceCallbacks()
            Log.i(TAG, "Connected to JourneyService")

            // If service was already active in background, push state to UI
            journeyService?.getSnapshot()?.let { snapshot ->
                if (snapshot.optBoolean("isTripActive", false)) {
                    evalJs("if(window.onNativeStateRestored) window.onNativeStateRestored($snapshot);")
                }
            }
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            journeyService = null
            isBound = false
            Log.i(TAG, "Disconnected from JourneyService")
        }
    }

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        val fineLocation = permissions[Manifest.permission.ACCESS_FINE_LOCATION] ?: false
        if (!fineLocation) {
            Toast.makeText(
                this,
                "⚠️ Precise location is required to alert you before your stop.",
                Toast.LENGTH_LONG
            ).show()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webView)
        progressBar = findViewById(R.id.progressBar)
        bridge = AndroidBridge(this)

        checkAndRequestPermissions()
        setupWebView()
        setupBackNavigation()
        bindJourneyService()

        // Load BusAwake bundled offline app
        webView.loadUrl("file:///android_asset/index.html")
    }

    private fun checkAndRequestPermissions() {
        val permissions = mutableListOf(
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            permissions.add(Manifest.permission.POST_NOTIFICATIONS)
        }

        val missing = permissions.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        if (missing.isNotEmpty()) {
            permissionLauncher.launch(missing.toTypedArray())
        }
    }

    private fun bindJourneyService() {
        val intent = Intent(this, JourneyService::class.java)
        bindService(intent, serviceConnection, Context.BIND_AUTO_CREATE)
    }

    private fun setupServiceCallbacks() {
        journeyService?.listener = object : JourneyService.JourneyListener {
            override fun onLocationUpdate(
                lat: Double,
                lng: Double,
                speedKmh: Float,
                speedAccuracyKmh: Float,
                accuracyMeters: Float,
                bearing: Float,
                ageMs: Long,
                distRemainingMeters: Float
            ) {
                evalJs("if(window.onNativeLocationUpdate) window.onNativeLocationUpdate($lat, $lng, $speedKmh, $speedAccuracyKmh, $accuracyMeters, $bearing, $ageMs, $distRemainingMeters);")
            }

            override fun onAlarmTriggered(stopName: String, distRemainingMeters: Float) {
                evalJs("if(window.onNativeAlarmTriggered) window.onNativeAlarmTriggered('$stopName', $distRemainingMeters);")
            }

            override fun onShakeProgress(count: Int, max: Int) {
                evalJs("if(window.onNativeShakeProgress) window.onNativeShakeProgress($count, $max);")
            }

            override fun onShakeReset() {
                evalJs("if(window.onNativeShakeReset) window.onNativeShakeReset();")
            }

            override fun onAlarmDismissed(source: String, contactName: String, contactPhone: String) {
                evalJs("if(window.onNativeAlarmDismissed) window.onNativeAlarmDismissed('$source', '$contactName', '$contactPhone');")
            }
        }
    }

    fun startStandaloneAlarmAndShake(reason: String) {
        Log.i(TAG, "Starting standalone alarm and shake: $reason")
        if (standaloneAlarmController == null) {
            standaloneAlarmController = AlarmController(this).apply {
                listener = object : AlarmController.Listener {
                    override fun onAlarmStarted(reason: String) {
                        standaloneShakeDetector?.start()
                    }
                    override fun onAlarmDismissed(source: String) {
                        standaloneShakeDetector?.stop()
                        evalJs("if(window.onNativeAlarmDismissed) window.onNativeAlarmDismissed('$source', 'Dad', '9444883897');")
                    }
                }
            }
        }
        if (standaloneShakeDetector == null) {
            standaloneShakeDetector = ShakeDetector(this).apply {
                listener = object : ShakeDetector.Listener {
                    override fun onShakeProgress(count: Int, max: Int) {
                        evalJs("if(window.onNativeShakeProgress) window.onNativeShakeProgress($count, $max);")
                    }
                    override fun onShakeCompleted() {
                        standaloneAlarmController?.dismissAlarm("shake")
                    }
                    override fun onShakeReset() {
                        evalJs("if(window.onNativeShakeReset) window.onNativeShakeReset();")
                    }
                }
            }
        }
        standaloneAlarmController?.triggerAlarm(reason)
        standaloneShakeDetector?.start()
    }

    fun dismissStandaloneAlarm() {
        standaloneAlarmController?.dismissAlarm("manual_button")
        standaloneShakeDetector?.stop()
    }

    fun evalJs(javascript: String) {
        runOnUiThread {
            webView.evaluateJavascript(javascript, null)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        val settings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.setGeolocationEnabled(true)
        settings.mediaPlaybackRequiresUserGesture = false
        settings.cacheMode = WebSettings.LOAD_DEFAULT
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        settings.allowFileAccess = true
        settings.allowContentAccess = true

        webView.addJavascriptInterface(bridge, "AndroidBridge")

        webView.webChromeClient = object : WebChromeClient() {
            override fun onGeolocationPermissionsShowPrompt(
                origin: String?,
                callback: GeolocationPermissions.Callback?
            ) {
                callback?.invoke(origin, true, false)
            }

            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                if (newProgress < 100) {
                    progressBar.visibility = View.VISIBLE
                    progressBar.progress = newProgress
                } else {
                    progressBar.visibility = View.GONE
                }
            }
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
                view: WebView?,
                request: WebResourceRequest?
            ): Boolean {
                val url = request?.url?.toString() ?: return false
                return handleUrl(url)
            }

            @Deprecated("Deprecated in Java")
            override fun shouldOverrideUrlLoading(
                view: WebView?,
                url: String?
            ): Boolean {
                if (url == null) return false
                return handleUrl(url)
            }

            private fun handleUrl(url: String): Boolean {
                if (url.startsWith("tel:")) {
                    val phone = url.substringAfter("tel:")
                    bridge.openDialer(phone)
                    return true
                }
                if (url.startsWith("sms:")) {
                    try {
                        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
                            flags = Intent.FLAG_ACTIVITY_NEW_TASK
                        }
                        startActivity(intent)
                    } catch (e: Exception) {
                        e.printStackTrace()
                    }
                    return true
                }
                if (url.startsWith("whatsapp:") || url.contains("api.whatsapp.com") || url.contains("wa.me")) {
                    try {
                        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
                            flags = Intent.FLAG_ACTIVITY_NEW_TASK
                        }
                        startActivity(intent)
                    } catch (e: Exception) {
                        e.printStackTrace()
                    }
                    return true
                }
                if (url.startsWith("intent:")) {
                    try {
                        val intent = Intent.parseUri(url, Intent.URI_INTENT_SCHEME)
                        startActivity(intent)
                    } catch (e: Exception) {
                        e.printStackTrace()
                    }
                    return true
                }
                return false
            }

            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                super.onPageStarted(view, url, favicon)
                progressBar.visibility = View.VISIBLE
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                progressBar.visibility = View.GONE
                Log.i(TAG, "BusAwake page loaded successfully: $url")
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
            ) {
                super.onReceivedError(view, request, error)
                Log.e(TAG, "WebView error: ${error?.description} (${error?.errorCode})")
            }
        }
    }

    private fun setupBackNavigation() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) {
                    webView.goBack()
                } else {
                    // Minimize to background instead of destroying so active journeys continue
                    moveTaskToBack(true)
                }
            }
        })
    }

    override fun onDestroy() {
        super.onDestroy()
        dismissStandaloneAlarm()
        if (isBound) {
            unbindService(serviceConnection)
            isBound = false
        }
    }
}
