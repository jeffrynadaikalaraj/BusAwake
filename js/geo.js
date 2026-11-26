// Geolocation & Movement Engine for BusAwake
class GeoTracker {
  constructor() {
    this.watchId = null;
    this.currentPosition = null;
    this.lastPosition = null;
    this.lastTimestamp = null;
    this.currentSpeedKmh = 0;
    this.currentHeading = 0; // 0-360 degrees
    this.compassDirection = 'N';
    this.isTracking = false;
    this.isSimulating = false;
    this.simInterval = null;
    this.alertTriggered = false;

    // Callbacks
    this.onLocationUpdate = null;
    this.onCrossingTriggerStop = null;
    this.onError = null;
  }

  // Haversine formula for distance in meters
  static calculateDistance(lat1, lon1, lat2, lon2) {
    if (lat1 === undefined || lon1 === undefined || lat2 === undefined || lon2 === undefined) return 0;
    const R = 6371e3; // Earth radius in meters
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  // Bearing in degrees (0 to 360)
  static calculateBearing(lat1, lon1, lat2, lon2) {
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    const θ = Math.atan2(y, x);

    return (θ * 180 / Math.PI + 360) % 360;
  }

  static getCardinalDirection(deg) {
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const idx = Math.round(deg / 45) % 8;
    return directions[idx];
  }

  static formatDistance(meters) {
    if (isNaN(meters) || meters === null) return '-- km';
    if (meters >= 1000) {
      return (meters / 1000).toFixed(2) + ' km';
    }
    return Math.round(meters) + ' m';
  }

  // Quick live location retrieval
  static getLiveLocation(onSuccess, onError) {
    if (!navigator.geolocation) {
      if (onError) onError('Geolocation not supported by browser');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => onSuccess(pos),
      (err) => {
        console.warn('[GeoTracker] Live location warning:', err);
        if (onError) onError(err.message);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 3000 }
    );
  }

  startTracking(triggerStop, finalStop, triggerRadius = 400) {
    if (this.isTracking) return;
    if (!navigator.geolocation) {
      if (this.onError) this.onError('GPS not supported on this device.');
      return;
    }

    this.isTracking = true;
    this.alertTriggered = false;
    this.lastPosition = null;
    this.lastTimestamp = null;

    const options = {
      enableHighAccuracy: true,
      timeout: 20000,
      maximumAge: 5000
    };

    this.watchId = navigator.geolocation.watchPosition(
      (pos) => this.handlePosition(pos, triggerStop, finalStop, triggerRadius),
      (err) => {
        console.warn('[GeoTracker] Watch GPS error:', err);
        if (this.onError) this.onError(err.message || 'GPS Signal searching...');
      },
      options
    );
  }

  handlePosition(pos, triggerStop, finalStop, triggerRadius) {
    const { latitude, longitude, speed, heading, accuracy } = pos.coords;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    const now = Date.now();

    this.currentPosition = { lat: latitude, lng: longitude };

    // 1. Calculate Speed in km/h
    if (speed !== null && speed !== undefined && Number.isFinite(speed) && speed >= 0) {
      this.currentSpeedKmh = Math.round(speed * 3.6);
    } else if (this.lastPosition && this.lastTimestamp) {
      const timeElapsedMs = now - this.lastTimestamp;
      if (timeElapsedMs >= 500 && timeElapsedMs < 180000) {
        const distMoved = GeoTracker.calculateDistance(
          this.lastPosition.lat,
          this.lastPosition.lng,
          latitude,
          longitude
        );
        const timeElapsedHours = timeElapsedMs / (1000 * 3600);
        const rawSpeed = distMoved / 1000 / timeElapsedHours;
        // Basic noise filter: ignore non-finite values and jumps > 140km/h
        if (Number.isFinite(rawSpeed) && rawSpeed >= 0 && rawSpeed < 140) {
          this.currentSpeedKmh = Math.round(rawSpeed);
        }
      }
    }

    // 2. Heading
    if (heading !== null && heading !== undefined && !isNaN(heading) && heading >= 0) {
      this.currentHeading = Math.round(heading);
    } else if (this.lastPosition) {
      const distMoved = GeoTracker.calculateDistance(
        this.lastPosition.lat,
        this.lastPosition.lng,
        latitude,
        longitude
      );
      if (distMoved >= 3) {
        this.currentHeading = Math.round(GeoTracker.calculateBearing(
          this.lastPosition.lat,
          this.lastPosition.lng,
          latitude,
          longitude
        ));
      }
    }
    this.compassDirection = GeoTracker.getCardinalDirection(this.currentHeading);

    this.lastPosition = { lat: latitude, lng: longitude };
    this.lastTimestamp = now;

    // Distances with safe fallbacks
    const tLat = triggerStop?.lat !== undefined ? triggerStop.lat : 13.1228;
    const tLng = triggerStop?.lng !== undefined ? triggerStop.lng : 80.1484;
    const fLat = finalStop?.lat !== undefined ? finalStop.lat : 13.1205;
    const fLng = finalStop?.lng !== undefined ? finalStop.lng : 80.1520;

    const distToTrigger = GeoTracker.calculateDistance(latitude, longitude, tLat, tLng);
    const distToFinal = GeoTracker.calculateDistance(latitude, longitude, fLat, fLng);

    // Realistic bus speed for ETA fallback
    const effectiveSpeed = Math.max(this.currentSpeedKmh, 22);
    const etaMinutes = Math.max(1, Math.round((distToTrigger / 1000 / effectiveSpeed) * 60));

    if (this.onLocationUpdate) {
      this.onLocationUpdate({
        coords: this.currentPosition,
        distToTrigger,
        distToFinal,
        formattedDistToTrigger: GeoTracker.formatDistance(distToTrigger),
        formattedDistToFinal: GeoTracker.formatDistance(distToFinal),
        speedKmh: this.currentSpeedKmh,
        heading: this.currentHeading,
        compassDirection: this.compassDirection,
        etaMinutes,
        accuracy: Math.round(accuracy || 10)
      });
    }

    // Check Trigger Zone with accuracy tolerance (e.g. inside bus)
    const accuracyTolerance = Math.min(Math.max(0, (accuracy || 10) / 2), 40);
    const effectiveTriggerRadius = triggerRadius + accuracyTolerance;

    if (distToTrigger <= effectiveTriggerRadius && !this.alertTriggered) {
      this.alertTriggered = true;
      if (this.onCrossingTriggerStop) {
        this.onCrossingTriggerStop(distToTrigger, distToFinal, {
          latitude,
          longitude,
          speedKmh: this.currentSpeedKmh,
          etaMinutes
        });
      }
    }
  }

  stopTracking() {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
    if (this.isSimulating) {
      this.stopSimulation();
    }
    this.isTracking = false;
  }

  // Smooth realistic bus ride simulation for testing
  startSimulation(triggerStop, finalStop, triggerRadius = 400) {
    this.stopTracking();
    this.isSimulating = true;
    this.isTracking = true;
    this.alertTriggered = false;

    let distToTrigger = 1800;
    const simSpeedKmh = 36;
    const simHeading = 210;

    this.simInterval = setInterval(() => {
      distToTrigger = Math.max(0, distToTrigger - 180);

      const targetLat = triggerStop?.lat !== undefined ? triggerStop.lat : 13.1228;
      const targetLng = triggerStop?.lng !== undefined ? triggerStop.lng : 80.1484;
      const offset = distToTrigger / 111000;
      const simLat = targetLat + offset * 0.8;
      const simLng = targetLng + offset * 0.6;

      const distToFinal = distToTrigger + 800;
      const etaMinutes = Math.max(1, Math.round((distToTrigger / 1000 / simSpeedKmh) * 60));

      if (this.onLocationUpdate) {
        this.onLocationUpdate({
          coords: { lat: simLat, lng: simLng },
          distToTrigger,
          distToFinal,
          formattedDistToTrigger: GeoTracker.formatDistance(distToTrigger),
          formattedDistToFinal: GeoTracker.formatDistance(distToFinal),
          speedKmh: simSpeedKmh,
          heading: simHeading,
          compassDirection: GeoTracker.getCardinalDirection(simHeading),
          etaMinutes,
          accuracy: 5,
          isSimulated: true
        });
      }

      if (distToTrigger <= triggerRadius && !this.alertTriggered) {
        this.alertTriggered = true;
        if (this.onCrossingTriggerStop) {
          this.onCrossingTriggerStop(distToTrigger, distToFinal, {
            latitude: simLat,
            longitude: simLng,
            speedKmh: simSpeedKmh,
            etaMinutes
          });
        }
      }

      if (distToTrigger <= 20) {
        this.stopSimulation();
      }
    }, 1100);
  }

  stopSimulation() {
    if (this.simInterval) {
      clearInterval(this.simInterval);
      this.simInterval = null;
    }
    this.isSimulating = false;
    this.isTracking = false;
  }
}

window.geoTracker = new GeoTracker();
