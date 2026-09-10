// ==========================================================================
// BusAwake — Live Bus Cockpit & Traffic Radar Engine
// Kalman-filtered GPS Speedometer, Magnetic Compass, Traffic Detector,
// and Real-time Speed Timeline Chart
// ==========================================================================

class CockpitEngine {
  constructor() {
    // --- State ---
    this.isRunning = false;
    this.startTime = null;

    // --- Speed (Kalman-filtered) ---
    this.kalmanSpeed = 0;        // Current fused speed (km/h)
    this.kalmanP = 1;            // Kalman error covariance
    this.kalmanQ = 0.5;          // Process noise (how much speed can change per tick)
    this.kalmanR = 2.5;          // Measurement noise (GPS jitter)
    this.lastGpsSpeed = 0;
    this.lastGpsTime = 0;
    this.maxSpeed = 0;
    this.totalSpeedSamples = 0;
    this.totalSpeedSum = 0;
    this.totalDistanceM = 0;
    this.lastCoords = null;

    // --- Accelerometer ---
    this.accelSpeedDelta = 0;
    this.accelLastTime = 0;
    this.accelListenerActive = false;

    // --- Compass (Magnetometer) ---
    this.compassHeading = 0;         // 0-360 degrees true north
    this.compassSmoothed = 0;
    this.compassAlpha = 0.15;        // EMA smoothing factor
    this.compassListenerActive = false;
    this.lastHeadingChange = 0;
    this.turnDetected = false;
    this.prevSmoothedHeading = 0;

    // --- Traffic Detector ---
    this.speedBuffer = [];           // Rolling speed samples (last 60s)
    this.speedBufferMaxAge = 60000;  // 60 seconds
    this.trafficZone = 'CLEAR';      // CLEAR, MODERATE, HEAVY, STOPPED
    this.trafficZoneStartTime = 0;
    this.trafficLog = [];            // Array of { zone, duration, timestamp, coords }
    this.lastTrafficCheck = 0;
    this.stoppedSince = 0;
    this.heavySince = 0;

    // --- Speed Chart ---
    this.chartData = [];             // Array of { time, speed, zone }
    this.chartMaxPoints = 450;       // 15 minutes at 2s intervals
    this.chartLastSample = 0;
    this.chartCanvas = null;
    this.chartCtx = null;

    // --- UI Elements ---
    this.els = {};

    // --- Callbacks ---
    this.onTrafficUpdate = null;     // Called when traffic zone changes
    this.onSpeedUpdate = null;       // Called with smoothed speed on every tick
  }

  // =========================================================================
  // KALMAN FILTER — Sensor Fusion for Speed
  // =========================================================================
  kalmanUpdate(measurement) {
    // Prediction step (speed doesn't change much between ticks)
    const predicted = this.kalmanSpeed;
    const predictedP = this.kalmanP + this.kalmanQ;

    // Update step
    const K = predictedP / (predictedP + this.kalmanR);
    this.kalmanSpeed = predicted + K * (measurement - predicted);
    this.kalmanP = (1 - K) * predictedP;

    // Clamp to reasonable bus speed
    this.kalmanSpeed = Math.max(0, Math.min(this.kalmanSpeed, 120));
    return this.kalmanSpeed;
  }

  // =========================================================================
  // ACCELEROMETER — Fill speed gaps between GPS ticks
  // =========================================================================
  startAccelerometer() {
    if (this.accelListenerActive) return;

    if (window.DeviceMotionEvent) {
      // Check for permission requirement (iOS 13+)
      if (typeof DeviceMotionEvent.requestPermission === 'function') {
        DeviceMotionEvent.requestPermission()
          .then(state => {
            if (state === 'granted') this._attachAccelListener();
          })
          .catch(err => console.warn('[Cockpit] Accel permission:', err));
      } else {
        this._attachAccelListener();
      }
    }
  }

  _attachAccelListener() {
    this._accelHandler = (event) => {
      if (!this.isRunning) return;
      const accel = event.accelerationIncludingGravity || event.acceleration;
      if (!accel) return;

      const now = performance.now();
      if (this.accelLastTime > 0) {
        const dt = (now - this.accelLastTime) / 1000;
        if (dt > 0 && dt < 0.5) {
          // Forward acceleration along travel axis (simplified: use total magnitude)
          const ax = accel.x || 0;
          const ay = accel.y || 0;
          const az = (accel.z || 0) - 9.81; // Remove gravity estimate
          const forwardAccel = Math.sqrt(ax * ax + ay * ay) * Math.sign(ax + ay);

          // Integrate acceleration to get speed delta (m/s -> km/h)
          this.accelSpeedDelta += forwardAccel * dt * 3.6 * 0.3; // Damped integration
          this.accelSpeedDelta *= 0.92; // Decay to prevent drift
        }
      }
      this.accelLastTime = now;
    };
    window.addEventListener('devicemotion', this._accelHandler, { passive: true });
    this.accelListenerActive = true;
    console.log('[Cockpit] Accelerometer active');
  }

  stopAccelerometer() {
    if (this._accelHandler) {
      window.removeEventListener('devicemotion', this._accelHandler);
      this._accelHandler = null;
    }
    this.accelListenerActive = false;
  }

  // =========================================================================
  // MAGNETOMETER / COMPASS — True North Heading
  // =========================================================================
  startCompass() {
    if (this.compassListenerActive) return;

    const attachCompass = () => {
      this._compassHandler = (event) => {
        if (!this.isRunning) return;
        let heading = null;

        // Prefer absolute orientation (true north)
        if (event.absolute && event.alpha !== null) {
          heading = 360 - event.alpha; // Convert to clockwise from north
        } else if (event.webkitCompassHeading !== undefined) {
          heading = event.webkitCompassHeading; // Safari/iOS
        } else if (event.alpha !== null) {
          heading = 360 - event.alpha; // Fallback relative
        }

        if (heading !== null && !isNaN(heading)) {
          heading = ((heading % 360) + 360) % 360;

          // EMA smoothing to reduce magnetic jitter from bus engine
          const diff = heading - this.compassSmoothed;
          let delta = ((diff + 540) % 360) - 180; // Shortest angular distance
          this.compassSmoothed = ((this.compassSmoothed + this.compassAlpha * delta) % 360 + 360) % 360;

          // Turn detection: heading change > 30° in 3 seconds
          const headingDiff = Math.abs(((this.compassSmoothed - this.prevSmoothedHeading + 540) % 360) - 180);
          if (headingDiff > 30) {
            this.turnDetected = true;
            this.lastHeadingChange = Date.now();
          } else if (Date.now() - this.lastHeadingChange > 3000) {
            this.turnDetected = false;
          }
          this.prevSmoothedHeading = this.compassSmoothed;
          this.compassHeading = Math.round(this.compassSmoothed);
        }
      };

      // Try absolute first, then fallback
      if ('ondeviceorientationabsolute' in window) {
        window.addEventListener('deviceorientationabsolute', this._compassHandler, { passive: true });
      } else {
        window.addEventListener('deviceorientation', this._compassHandler, { passive: true });
      }
      this.compassListenerActive = true;
      console.log('[Cockpit] Compass/Magnetometer active');
    };

    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      DeviceOrientationEvent.requestPermission()
        .then(state => { if (state === 'granted') attachCompass(); })
        .catch(err => console.warn('[Cockpit] Compass permission:', err));
    } else {
      attachCompass();
    }
  }

  stopCompass() {
    if (this._compassHandler) {
      window.removeEventListener('deviceorientationabsolute', this._compassHandler);
      window.removeEventListener('deviceorientation', this._compassHandler);
      this._compassHandler = null;
    }
    this.compassListenerActive = false;
  }

  // =========================================================================
  // TRAFFIC ZONE DETECTOR — Heuristic Speed Pattern Analysis
  // =========================================================================
  classifyTraffic() {
    const now = Date.now();
    if (now - this.lastTrafficCheck < 3000) return this.trafficZone; // Check every 3s
    this.lastTrafficCheck = now;

    // Purge old samples (keep last 60 seconds)
    this.speedBuffer = this.speedBuffer.filter(s => now - s.time < this.speedBufferMaxAge);

    if (this.speedBuffer.length < 3) return this.trafficZone;

    // Calculate rolling average speed
    const avgSpeed = this.speedBuffer.reduce((sum, s) => sum + s.speed, 0) / this.speedBuffer.length;
    const currentSpeed = this.kalmanSpeed;

    const prevZone = this.trafficZone;

    // Classification
    if (currentSpeed < 3) {
      // STOPPED detection
      if (this.stoppedSince === 0) this.stoppedSince = now;
      const stoppedDuration = (now - this.stoppedSince) / 1000;

      if (stoppedDuration > 15) {
        this.trafficZone = 'STOPPED';
        this.heavySince = 0;
      }
    } else {
      this.stoppedSince = 0;

      if (avgSpeed < 12) {
        // HEAVY traffic check
        if (this.heavySince === 0) this.heavySince = now;
        const heavyDuration = (now - this.heavySince) / 1000;

        if (heavyDuration > 30) {
          this.trafficZone = 'HEAVY';
        } else {
          this.trafficZone = 'MODERATE';
        }
      } else if (avgSpeed < 30) {
        this.trafficZone = 'MODERATE';
        this.heavySince = 0;
      } else {
        this.trafficZone = 'CLEAR';
        this.heavySince = 0;
      }
    }

    // Log zone transitions
    if (prevZone !== this.trafficZone) {
      this.trafficLog.push({
        from: prevZone,
        to: this.trafficZone,
        timestamp: now,
        avgSpeed: Math.round(avgSpeed),
        coords: this.lastCoords ? { ...this.lastCoords } : null
      });

      // Keep last 20 log entries
      if (this.trafficLog.length > 20) this.trafficLog.shift();

      if (this.onTrafficUpdate) {
        this.onTrafficUpdate(this.trafficZone, avgSpeed, this.trafficLog);
      }
    }

    return this.trafficZone;
  }

  getTrafficInfo() {
    const avgSpeed = this.speedBuffer.length > 0
      ? this.speedBuffer.reduce((sum, s) => sum + s.speed, 0) / this.speedBuffer.length
      : 0;

    const labels = {
      CLEAR: { emoji: '🟢', label: 'CLEAR ROAD', color: '#10b981' },
      MODERATE: { emoji: '🟡', label: 'CITY FLOW', color: '#f59e0b' },
      HEAVY: { emoji: '🔴', label: 'HEAVY TRAFFIC', color: '#ef4444' },
      STOPPED: { emoji: '⬛', label: 'BUS STOP / SIGNAL', color: '#64748b' }
    };

    const info = labels[this.trafficZone] || labels.CLEAR;
    return {
      ...info,
      zone: this.trafficZone,
      avgSpeed: Math.round(avgSpeed),
      stoppedSeconds: this.stoppedSince > 0 ? Math.round((Date.now() - this.stoppedSince) / 1000) : 0,
      heavySeconds: this.heavySince > 0 ? Math.round((Date.now() - this.heavySince) / 1000) : 0
    };
  }

  // =========================================================================
  // SPEED TIMELINE CHART — Canvas-based Real-time Graph
  // =========================================================================
  initChart(canvasId) {
    this.chartCanvas = document.getElementById(canvasId);
    if (!this.chartCanvas) return;
    this.chartCtx = this.chartCanvas.getContext('2d');

    // Handle high-DPI displays
    const dpr = window.devicePixelRatio || 1;
    const rect = this.chartCanvas.getBoundingClientRect();
    this.chartCanvas.width = rect.width * dpr;
    this.chartCanvas.height = rect.height * dpr;
    this.chartCtx.scale(dpr, dpr);
    this.chartCanvas.style.width = rect.width + 'px';
    this.chartCanvas.style.height = rect.height + 'px';
  }

  sampleChart() {
    const now = Date.now();
    if (now - this.chartLastSample < 2000) return; // Sample every 2s
    this.chartLastSample = now;

    this.chartData.push({
      time: now,
      speed: Math.round(this.kalmanSpeed),
      zone: this.trafficZone
    });

    if (this.chartData.length > this.chartMaxPoints) {
      this.chartData.shift();
    }
  }

  drawChart() {
    if (!this.chartCtx || !this.chartCanvas) return;
    const ctx = this.chartCtx;
    const rect = this.chartCanvas.getBoundingClientRect();
    const W = rect.width;
    const H = rect.height;

    // Clear
    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = 'rgba(6, 8, 13, 0.9)';
    ctx.fillRect(0, 0, W, H);

    if (this.chartData.length < 2) {
      ctx.fillStyle = '#475569';
      ctx.font = '11px "Plus Jakarta Sans", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Collecting speed data...', W / 2, H / 2);
      return;
    }

    const padding = { top: 10, right: 10, bottom: 20, left: 32 };
    const plotW = W - padding.left - padding.right;
    const plotH = H - padding.top - padding.bottom;

    // Find max speed for scale (min 50 km/h)
    const maxVal = Math.max(50, ...this.chartData.map(d => d.speed));

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 0.5;
    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.fillStyle = '#475569';
    ctx.textAlign = 'right';

    for (let v = 10; v <= maxVal; v += 10) {
      const y = padding.top + plotH - (v / maxVal) * plotH;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(W - padding.right, y);
      ctx.stroke();
      ctx.fillText(v + '', padding.left - 4, y + 3);
    }

    // Speed line with gradient
    const gradient = ctx.createLinearGradient(0, padding.top, 0, padding.top + plotH);
    gradient.addColorStop(0, 'rgba(16, 185, 129, 0.9)');
    gradient.addColorStop(0.5, 'rgba(245, 158, 11, 0.9)');
    gradient.addColorStop(1, 'rgba(239, 68, 68, 0.9)');

    // Area fill
    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top + plotH);
    this.chartData.forEach((d, i) => {
      const x = padding.left + (i / (this.chartData.length - 1)) * plotW;
      const y = padding.top + plotH - (d.speed / maxVal) * plotH;
      ctx.lineTo(x, y);
    });
    ctx.lineTo(padding.left + plotW, padding.top + plotH);
    ctx.closePath();

    const areaGrad = ctx.createLinearGradient(0, padding.top, 0, padding.top + plotH);
    areaGrad.addColorStop(0, 'rgba(99, 102, 241, 0.25)');
    areaGrad.addColorStop(1, 'rgba(99, 102, 241, 0.02)');
    ctx.fillStyle = areaGrad;
    ctx.fill();

    // Speed line stroke
    ctx.beginPath();
    this.chartData.forEach((d, i) => {
      const x = padding.left + (i / (this.chartData.length - 1)) * plotW;
      const y = padding.top + plotH - (d.speed / maxVal) * plotH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Current speed pulse dot
    if (this.chartData.length > 0) {
      const last = this.chartData[this.chartData.length - 1];
      const x = padding.left + plotW;
      const y = padding.top + plotH - (last.speed / maxVal) * plotH;

      // Glow
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(99, 102, 241, 0.4)';
      ctx.fill();

      // Dot
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#818cf8';
      ctx.fill();
    }

    // Time labels
    ctx.fillStyle = '#475569';
    ctx.font = '8px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    const elapsed = (Date.now() - this.startTime) / 1000;
    const mins = Math.floor(elapsed / 60);
    ctx.fillText(`${mins}m ago`, padding.left + 2, H - 3);
    ctx.fillText('now', W - padding.right, H - 3);
    ctx.fillText('km/h', padding.left - 4, padding.top - 1);
  }

  // =========================================================================
  // SPEEDOMETER GAUGE — SVG Arc Rendering
  // =========================================================================
  updateSpeedGauge(speed) {
    const needle = this.els.gaugeNeedle;
    const digitalSpeed = this.els.digitalSpeed;
    const speedUnit = this.els.speedUnit;
    const arcFill = this.els.gaugeArcFill;

    if (digitalSpeed) digitalSpeed.textContent = Math.round(speed);

    if (arcFill) {
      // 240 degree arc, max 80 km/h for bus
      const maxSpeed = 80;
      const ratio = Math.min(speed / maxSpeed, 1);
      const arcLength = 251.2; // Circumference for r=40
      const dashLen = ratio * arcLength * (240 / 360);
      arcFill.style.strokeDasharray = `${dashLen} ${arcLength}`;

      // Color based on speed
      if (speed >= 35) {
        arcFill.style.stroke = '#10b981'; // Green
      } else if (speed >= 10) {
        arcFill.style.stroke = '#f59e0b'; // Amber
      } else {
        arcFill.style.stroke = '#ef4444'; // Red
      }
    }

    if (needle) {
      const maxSpeed = 80;
      const ratio = Math.min(speed / maxSpeed, 1);
      const angle = -120 + (ratio * 240); // -120 to +120 degrees
      needle.style.transform = `rotate(${angle}deg)`;
    }
  }

  // =========================================================================
  // COMPASS RING — Rotation Animation
  // =========================================================================
  updateCompassUI() {
    const ring = this.els.compassRing;
    const headingText = this.els.compassHeadingText;
    const directionText = this.els.compassDirectionText;
    const turnBadge = this.els.compassTurnBadge;

    if (ring) {
      ring.style.transform = `rotate(${-this.compassHeading}deg)`;
    }

    if (headingText) {
      headingText.textContent = `${this.compassHeading}°`;
    }

    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const dirIdx = Math.round(this.compassHeading / 45) % 8;
    if (directionText) {
      directionText.textContent = dirs[dirIdx];
    }

    if (turnBadge) {
      if (this.turnDetected) {
        turnBadge.style.display = 'flex';
        turnBadge.textContent = '↩️ TURNING';
      } else {
        turnBadge.style.display = 'none';
      }
    }
  }

  // =========================================================================
  // TRAFFIC UI UPDATE
  // =========================================================================
  updateTrafficUI() {
    const info = this.getTrafficInfo();
    const badge = this.els.trafficBadge;
    const label = this.els.trafficLabel;
    const avgText = this.els.trafficAvgSpeed;
    const detail = this.els.trafficDetail;

    if (badge) {
      badge.style.borderColor = info.color;
      badge.style.boxShadow = `0 0 20px ${info.color}33`;
    }
    if (label) {
      label.textContent = `${info.emoji} ${info.label}`;
      label.style.color = info.color;
    }
    if (avgText) {
      avgText.textContent = `${info.avgSpeed} km/h avg`;
    }
    if (detail) {
      if (info.zone === 'STOPPED' && info.stoppedSeconds > 0) {
        detail.textContent = `Stationary for ${info.stoppedSeconds}s`;
      } else if (info.zone === 'HEAVY' && info.heavySeconds > 0) {
        detail.textContent = `Slow traffic for ${info.heavySeconds}s`;
      } else {
        detail.textContent = '';
      }
    }
  }

  // =========================================================================
  // TRIP STATS
  // =========================================================================
  updateTripStatsUI() {
    const maxEl = this.els.statMaxSpeed;
    const avgEl = this.els.statAvgSpeed;
    const distEl = this.els.statDistance;
    const timeEl = this.els.statDuration;

    if (maxEl) maxEl.textContent = `${Math.round(this.maxSpeed)} km/h`;

    const avgSpeed = this.totalSpeedSamples > 0
      ? Math.round(this.totalSpeedSum / this.totalSpeedSamples)
      : 0;
    if (avgEl) avgEl.textContent = `${avgSpeed} km/h`;

    if (distEl) {
      if (this.totalDistanceM >= 1000) {
        distEl.textContent = `${(this.totalDistanceM / 1000).toFixed(1)} km`;
      } else {
        distEl.textContent = `${Math.round(this.totalDistanceM)} m`;
      }
    }

    if (timeEl && this.startTime) {
      const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
      const mins = Math.floor(elapsed / 60);
      const secs = elapsed % 60;
      timeEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
    }
  }

  // =========================================================================
  // MASTER GPS FEED — Called from app.js on every location update
  // =========================================================================
  feedGPS(data) {
    if (!this.isRunning) return;

    const now = Date.now();

    // 1. Get raw measured GPS speed directly from location provider
    let gpsSpeed = (data.speedKmh !== undefined && data.speedKmh >= 0) ? data.speedKmh : 0;
    const smoothedSpeed = gpsSpeed;
    this.kalmanSpeed = smoothedSpeed;

    this.lastFixTime = now;
    this.lastSpeedAccuracyKmh = data.speedAccuracyKmh;
    this.lastHorizontalAccuracyM = data.accuracyMeters;
    this.lastGpsBearing = (data.bearing !== undefined && data.bearing >= 0) ? data.bearing : (data.heading !== undefined ? data.heading : -1);

    // 2. Update stats
    if (smoothedSpeed > this.maxSpeed) this.maxSpeed = smoothedSpeed;
    this.totalSpeedSamples++;
    this.totalSpeedSum += smoothedSpeed;

    // 3. Track distance
    if (data.coords && this.lastCoords) {
      const dist = this._haversine(
        this.lastCoords.lat, this.lastCoords.lng,
        data.coords.lat, data.coords.lng
      );
      if (dist < 500) { // Ignore GPS jumps > 500m
        this.totalDistanceM += dist;
      }
    }
    if (data.coords) this.lastCoords = { ...data.coords };

    // 4. Distinguish vehicle travel direction (GPS track) from device orientation (Compass)
    if (smoothedSpeed > 5 && this.lastGpsBearing >= 0) {
      this.compassHeading = Math.round(this.lastGpsBearing);
      if (this.els.headingType) this.els.headingType.textContent = 'Track: GPS Bearing';
    } else {
      if (this.els.headingType) this.els.headingType.textContent = 'Orientation: Compass';
    }

    // 5. Push to traffic speed buffer
    this.speedBuffer.push({ time: now, speed: smoothedSpeed });

    // 6. Classify traffic
    this.classifyTraffic();

    // 7. Sample chart
    this.sampleChart();

    // 8. Update all UI
    this.updateSpeedGauge(smoothedSpeed);
    this.updateCompassUI();
    this.updateTrafficUI();
    this.updateTripStatsUI();
    this.updateSensorAges();
    this.drawChart();

    // 9. Callback
    if (this.onSpeedUpdate) {
      this.onSpeedUpdate(smoothedSpeed, this.compassHeading, this.trafficZone);
    }
  }

  updateSensorAges() {
    if (!this.isRunning) return;
    const now = Date.now();
    const ageSec = this.lastFixTime ? Math.max(0, (now - this.lastFixTime) / 1000) : 0;

    if (this.els.gpsAge) {
      if (!this.lastFixTime || ageSec > 5) {
        this.els.gpsAge.textContent = `⚠️ GPS Stale (${Math.round(ageSec)}s)`;
        this.els.gpsAge.classList.add('stale');
      } else {
        this.els.gpsAge.textContent = `Age: ${ageSec.toFixed(1)}s`;
        this.els.gpsAge.classList.remove('stale');
      }
    }

    if (this.els.speedAccuracy) {
      if (this.lastSpeedAccuracyKmh !== undefined && this.lastSpeedAccuracyKmh > 0) {
        this.els.speedAccuracy.textContent = `Speed ±${this.lastSpeedAccuracyKmh.toFixed(1)} km/h`;
      } else if (this.lastHorizontalAccuracyM !== undefined && this.lastHorizontalAccuracyM > 0) {
        this.els.speedAccuracy.textContent = `GPS ±${Math.round(this.lastHorizontalAccuracyM)}m`;
      } else {
        this.els.speedAccuracy.textContent = 'Speed: GPS';
      }
    }
  }

  // =========================================================================
  // HAVERSINE — Distance between two GPS points (meters)
  // =========================================================================
  _haversine(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const phi1 = lat1 * Math.PI / 180;
    const phi2 = lat2 * Math.PI / 180;
    const dPhi = (lat2 - lat1) * Math.PI / 180;
    const dLam = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLam / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // =========================================================================
  // LIFECYCLE — Start / Stop
  // =========================================================================
  start(canvasId = 'cockpitChart') {
    if (this.isRunning) return;
    this.isRunning = true;
    this.startTime = Date.now();

    // Reset state
    this.kalmanSpeed = 0;
    this.kalmanP = 1;
    this.maxSpeed = 0;
    this.totalSpeedSamples = 0;
    this.totalSpeedSum = 0;
    this.totalDistanceM = 0;
    this.lastCoords = null;
    this.speedBuffer = [];
    this.chartData = [];
    this.trafficLog = [];
    this.trafficZone = 'CLEAR';
    this.stoppedSince = 0;
    this.heavySince = 0;
    this.accelSpeedDelta = 0;

    // Cache UI elements
    this.els = {
      gaugeNeedle: document.getElementById('cockpitNeedle'),
      gaugeArcFill: document.getElementById('cockpitArcFill'),
      digitalSpeed: document.getElementById('cockpitDigitalSpeed'),
      speedUnit: document.getElementById('cockpitSpeedUnit'),
      compassRing: document.getElementById('cockpitCompassRing'),
      compassHeadingText: document.getElementById('cockpitHeadingDeg'),
      compassDirectionText: document.getElementById('cockpitDirection'),
      compassTurnBadge: document.getElementById('cockpitTurnBadge'),
      trafficBadge: document.getElementById('cockpitTrafficBadge'),
      trafficLabel: document.getElementById('cockpitTrafficLabel'),
      trafficAvgSpeed: document.getElementById('cockpitTrafficAvg'),
      trafficDetail: document.getElementById('cockpitTrafficDetail'),
      statMaxSpeed: document.getElementById('cockpitStatMax'),
      statAvgSpeed: document.getElementById('cockpitStatAvg'),
      statDistance: document.getElementById('cockpitStatDist'),
      statDuration: document.getElementById('cockpitStatTime'),
      speedAccuracy: document.getElementById('cockpitSpeedAccuracy'),
      gpsAge: document.getElementById('cockpitGpsAge'),
      headingType: document.getElementById('cockpitHeadingType')
    };

    // Periodic sensor age ticker to detect stale signals
    this.ageCheckTimer = setInterval(() => this.updateSensorAges(), 1000);

    // Start hardware sensors
    this.startAccelerometer();
    this.startCompass();

    // Init chart canvas
    this.initChart(canvasId);

    console.log('[Cockpit] Engine started — all sensors active');
  }

  stop() {
    this.isRunning = false;
    if (this.ageCheckTimer) {
      clearInterval(this.ageCheckTimer);
      this.ageCheckTimer = null;
    }
    this.stopAccelerometer();
    this.stopCompass();
    console.log('[Cockpit] Engine stopped');
  }

  // =========================================================================
  // TRIP SUMMARY — For alarm message enhancement
  // =========================================================================
  getTripSummary() {
    const avgSpeed = this.totalSpeedSamples > 0
      ? Math.round(this.totalSpeedSum / this.totalSpeedSamples)
      : 0;
    const elapsed = this.startTime ? Math.floor((Date.now() - this.startTime) / 1000) : 0;
    const trafficEvents = this.trafficLog.filter(l => l.to === 'HEAVY').length;

    return {
      maxSpeed: Math.round(this.maxSpeed),
      avgSpeed,
      distanceKm: (this.totalDistanceM / 1000).toFixed(1),
      durationMin: Math.floor(elapsed / 60),
      trafficJams: trafficEvents,
      currentZone: this.trafficZone
    };
  }
}

// Global instance
window.cockpitEngine = new CockpitEngine();
