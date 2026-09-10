# 🚌 BusAwake — Transit GPS Wake-Up Alarm & Commute Telemetry

**BusAwake** is a reliable transit wake-up alarm and commute cockpit designed for daily bus passengers. It monitors your commute via GPS and sounds an alert before you reach your designated checkpoint, helping you avoid missing your bus stop.

---

## ✨ Features

- **📍 Native Background GPS Tracking**: Powered by an Android Foreground Service (`FOREGROUND_SERVICE_LOCATION`) that runs while your device is locked in your pocket.
- **👋 Vector-Reversal Shake Detector**: Dismiss the alarm by firmly shaking your phone 3 times. Implements normalized cosine similarity ($\cos(\theta) \le -0.50$) with time-dependent gravity filtering ($\vec{a}_{\text{linear}} = \vec{a} - \vec{g}$) and strict peak consumption to reject road bumps, sustained braking, and walking motion.
- **🔊 Alarm Audio & Tactile Burst Vibration**: Loops alarm audio on `AudioAttributes.USAGE_ALARM` paired with an intermittent tactile burst pattern (`200ms ON, 150ms OFF, 200ms ON, 900ms SILENCE`), providing an $800\text{ ms}$ clean sensing window every cycle.
- **📞 One-Tap Contact Dialer**: Uses Android `Intent.ACTION_DIAL` (zero dangerous `CALL_PHONE` permissions). Prompts you with a single tap to open the dialer pre-populated with your pickup contact (e.g., Dad).
- **🏎️ Live Bus Cockpit**: Real-time instruments displaying measured location-provider ground speed, speed accuracy ($\pm X\text{ km/h}$), position accuracy ($\pm X\text{ m}$), fix age, stale signal warnings, and orientation compass.
- **🧪 Pre-Trip Audio & Hardware Tests**: Dedicated testing modes for checking alarm volume, DND policies, and wrist-shake calibration before boarding the bus.
- **🔔 Persistent Lock-Screen Silence Action**: Direct notification action button to silence the alarm with one tap on crowded buses where shaking is impractical.

---

## 🏗️ Architecture

```mermaid
graph TD
    subgraph Native Android Layer (Kotlin)
        JS[JourneyService - Foreground Service] -->|Location Updates| GF[Native Geofence Evaluator]
        GF -->|Within Stop Radius| AC[AlarmController]
        
        HW[Linear Acceleration / Accelerometer] --> SD[ShakeDetector - Vector Reversal]
        SD -->|Authoritative Count: 3/3| AC
        AC -->|USAGE_ALARM Audio + Tactile Bursts| SPK[Speaker & Haptics]
    end

    subgraph Presentation Layer (WebView)
        JS -->|Speed, Accuracy, Fix Age| AB[AndroidBridge.kt]
        SD -->|Shake Progress 1/3, 2/3, 3/3| AB
        AC -->|Alarm State Updates| AB
        AB -->|evaluateJavascript| WEB[app.js, cockpit.js, index.html]
    end
```

---

## 🚀 Getting Started

### 1. Web Application (Local Server)
Run the lightweight local HTTP server:
```powershell
.\start_server.ps1
```
- Open [http://localhost:8080](http://localhost:8080) on your desktop browser.
- Open `http://<your-lan-ip>:8080` from your mobile browser on the same Wi-Fi.

### 2. Native Android App
Compile the debug APK using Gradle and Java 21:
```powershell
.\build_apk.ps1
```
The output APK is generated at:
- `BusAwake.apk` (Workspace root)
- `C:\Users\hp\OneDrive\Desktop\BusAwake.apk` (Desktop)

---

## 🔒 Permissions & Privacy
- `ACCESS_FINE_LOCATION` & `ACCESS_COARSE_LOCATION`: Required for GPS geofencing and stop proximity detection.
- `FOREGROUND_SERVICE` & `FOREGROUND_SERVICE_LOCATION`: Required for background tracking while the screen is off.
- `POST_NOTIFICATIONS`: Displays persistent commute status and quick silence actions (Android 13+).
- **Zero Dangerous Telephony Permissions**: Uses standard Android intents (`ACTION_DIAL`) to protect privacy and avoid heuristic security warnings.
