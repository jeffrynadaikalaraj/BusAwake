// Application Controller for BusAwake

// Globally accessible tab switcher with auto map invalidation
window.switchTab = function(targetTabId) {
  if (!targetTabId) return;
  const navButtons = document.querySelectorAll('.nav-item');
  const panes = document.querySelectorAll('.tab-pane');

  navButtons.forEach(btn => {
    if (btn.getAttribute('data-tab') === targetTabId) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  panes.forEach(pane => {
    if (pane.id === targetTabId) {
      pane.classList.add('active');
    } else {
      pane.classList.remove('active');
    }
  });

  // Automatically refresh Leaflet map viewport when navigating to Map tab
  if (targetTabId === 'tabMap') {
    setTimeout(() => {
      try {
        if (window.mapUnified) {
          window.mapUnified.invalidateSize();
          if (typeof window.refreshMapVisualPins === 'function') {
            window.refreshMapVisualPins();
          }
        }
      } catch (err) {
        console.warn('[Map resize notice]:', err);
      }
    }, 150);
  }

  // Refresh Cockpit chart canvas when navigating to Cockpit tab
  if (targetTabId === 'tabCockpit') {
    setTimeout(() => {
      try {
        if (window.cockpitEngine) {
          window.cockpitEngine.initChart('cockpitChart');
          window.cockpitEngine.drawChart();
        }
      } catch (err) {
        console.warn('[Cockpit resize notice]:', err);
      }
    }, 150);
  }
};

document.addEventListener('DOMContentLoaded', () => {
  const STATES = {
    IDLE: 'IDLE',
    TRACKING: 'TRACKING',
    ALERTING: 'ALERTING',
    ENDED: 'ENDED'
  };

  let currentState = STATES.IDLE;
  let currentSettings = window.StorageManager.getSettings();
  let savedRoutes = window.StorageManager.getSavedRoutes();
  let savedContacts = window.StorageManager.getSavedContacts();
  let wakeLock = null;

  // Unified Single Map State
  let mapUnified = null;
  let markerTrigger = null;
  let markerFinal = null;
  let circleTrigger = null;
  let userMarker = null;
  let routePolyline = null;
  let activeTileLayer = null;

  // Active Map Edit Mode: 'trigger' or 'final'
  let activeEditMode = 'trigger';

  // Live Tracking Cache
  let userLiveCoords = null;
  let currentBusSpeedKmh = 0;
  let currentEtaMins = 5;
  let searchDebounceTimer = null;

  // Cache DOM Elements
  const els = {
    statusBadge: document.getElementById('statusBadge'),
    statusText: document.getElementById('statusText'),
    visibilityWarning: document.getElementById('visibilityWarning'),
    headerRouteSub: document.getElementById('headerRouteSub'),

    // Tracker Tab
    routeChipsContainer: document.getElementById('routeChipsContainer'),
    contactChipsContainer: document.getElementById('contactChipsContainer'),
    liveDirectionBadge: document.getElementById('liveDirectionBadge'),
    directionArrowIcon: document.getElementById('directionArrowIcon'),
    directionText: document.getElementById('directionText'),
    heroTriggerName: document.getElementById('heroTriggerName'),
    heroDestName: document.getElementById('heroDestName'),
    heroAutoActionLabel: document.getElementById('heroAutoActionLabel'),
    heroAutoCountdownLabel: document.getElementById('heroAutoCountdownLabel'),
    heroDistLabel: document.getElementById('heroDistLabel'),
    heroDistance: document.getElementById('heroDistance'),
    heroSpeed: document.getElementById('heroSpeed'),
    heroEta: document.getElementById('heroEta'),
    heroDistToFinal: document.getElementById('heroDistToFinal'),
    summaryTriggerName: document.getElementById('summaryTriggerName'),
    summaryFinalName: document.getElementById('summaryFinalName'),
    summaryContactName: document.getElementById('summaryContactName'),
    summaryAutoActionText: document.getElementById('summaryAutoActionText'),
    btnStartTrip: document.getElementById('btnStartTrip'),
    btnEnterSleep: document.getElementById('btnEnterSleep'),
    btnStopTrip: document.getElementById('btnStopTrip'),
    btnQuickTestCall: document.getElementById('btnQuickTestCall'),
    btnQuickTestWa: document.getElementById('btnQuickTestWa'),
    quickTestContactName: document.getElementById('quickTestContactName'),
    quickTestPhoneDisplay: document.getElementById('quickTestPhoneDisplay'),
    btnSimulateRide: document.getElementById('btnSimulateRide'),
    btnDirectVibrateTest: document.getElementById('btnDirectVibrateTest'),

    // Unified Map Tab
    mapUnified: document.getElementById('mapUnified'),
    btnLocateMe: document.getElementById('btnLocateMe'),
    btnTileGoogleRoads: document.getElementById('btnTileGoogleRoads'),
    btnTileGoogleSatellite: document.getElementById('btnTileGoogleSatellite'),
    btnTileOsm: document.getElementById('btnTileOsm'),
    btnSelectTriggerMode: document.getElementById('btnSelectTriggerMode'),
    btnSelectFinalMode: document.getElementById('btnSelectFinalMode'),
    inputSearchPlace: document.getElementById('inputSearchPlace'),
    btnClearSearchPlace: document.getElementById('btnClearSearchPlace'),
    searchResultsDropdown: document.getElementById('searchResultsDropdown'),
    lblCurrentStopName: document.getElementById('lblCurrentStopName'),
    inputStopName: document.getElementById('inputStopName'),
    btnUseGpsCurrent: document.getElementById('btnUseGpsCurrent'),
    sliderTriggerRadius: document.getElementById('sliderTriggerRadius'),
    badgeTriggerRadius: document.getElementById('badgeTriggerRadius'),
    btnConfirmBothStops: document.getElementById('btnConfirmBothStops'),
    btnSaveAsNewRoute: document.getElementById('btnSaveAsNewRoute'),
    savedRoutesList: document.getElementById('savedRoutesList'),

    // Contacts Tab
    selectActiveContact: document.getElementById('selectActiveContact'),
    inputContactPhone: document.getElementById('inputContactPhone'),
    phoneValidationStatus: document.getElementById('phoneValidationStatus'),
    phoneFormattedPreview: document.getElementById('phoneFormattedPreview'),
    btnSaveActiveContactPhone: document.getElementById('btnSaveActiveContactPhone'),
    btnSaveContactLabel: document.getElementById('btnSaveContactLabel'),
    selectAutoCountdown: document.getElementById('selectAutoCountdown'),
    btnSaveAutoActionPref: document.getElementById('btnSaveAutoActionPref'),
    inputNewContactName: document.getElementById('inputNewContactName'),
    inputNewContactPhone: document.getElementById('inputNewContactPhone'),
    btnAddContact: document.getElementById('btnAddContact'),
    savedContactsList: document.getElementById('savedContactsList'),
    inputCustomMsg: document.getElementById('inputCustomMsg'),
    msgLivePreview: document.getElementById('msgLivePreview'),
    btnInsertLiveGpsTag: document.getElementById('btnInsertLiveGpsTag'),
    btnInsertSpeedTag: document.getElementById('btnInsertSpeedTag'),
    btnResetDefaultMsg: document.getElementById('btnResetDefaultMsg'),
    toggleSendLiveLocation: document.getElementById('toggleSendLiveLocation'),
    btnSaveDadSettings: document.getElementById('btnSaveDadSettings'),
    btnTestCall: document.getElementById('btnTestCall'),
    btnTestWhatsApp: document.getElementById('btnTestWhatsApp'),
    btnTestSms: document.getElementById('btnTestSms'),

    // Settings Tab
    selectAlarmSound: document.getElementById('selectAlarmSound'),
    toggleSoundAlarm: document.getElementById('toggleSoundAlarm'),
    toggleVoiceSpeech: document.getElementById('toggleVoiceSpeech'),
    toggleWakeLock: document.getElementById('toggleWakeLock'),
    btnSaveConfig: document.getElementById('btnSaveConfig'),
    inputCallMeBotKey: document.getElementById('inputCallMeBotKey'),
    btnTestSilentWhatsApp: document.getElementById('btnTestSilentWhatsApp'),
    inputWebhookUrl: document.getElementById('inputWebhookUrl'),
    btnSaveWebhookConfig: document.getElementById('btnSaveWebhookConfig'),
    inputGoogleApiKey: document.getElementById('inputGoogleApiKey'),
    btnSaveGoogleApiKey: document.getElementById('btnSaveGoogleApiKey'),
    googleApiStatusMsg: document.getElementById('googleApiStatusMsg'),
    historyList: document.getElementById('historyList'),
    btnClearHistory: document.getElementById('btnClearHistory'),

    // Overlays
    sleepOverlay: document.getElementById('sleepOverlay'),
    sleepClock: document.getElementById('sleepClock'),
    sleepStopName: document.getElementById('sleepStopName'),
    sleepDistance: document.getElementById('sleepDistance'),
    sleepEta: document.getElementById('sleepEta'),
    btnExitSleep: document.getElementById('btnExitSleep'),

    alarmOverlay: document.getElementById('alarmOverlay'),
    alarmHeadline: document.getElementById('alarmHeadline'),
    alarmSubheadline: document.getElementById('alarmSubheadline'),
    alarmAutoActionBanner: document.getElementById('alarmAutoActionBanner'),
    autoActionCountdownNum: document.getElementById('autoActionCountdownNum'),
    autoActionHeadline: document.getElementById('autoActionHeadline'),
    autoActionSub: document.getElementById('autoActionSub'),
    autoActionSecText: document.getElementById('autoActionSecText'),
    btnExecuteAutoNow: document.getElementById('btnExecuteAutoNow'),
    btnCancelAutoAction: document.getElementById('btnCancelAutoAction'),
    alarmCallBtn: document.getElementById('alarmCallBtn'),
    alarmCallBtnText: document.getElementById('alarmCallBtnText'),
    alarmWhatsAppBtn: document.getElementById('alarmWhatsAppBtn'),
    alarmSmsBtn: document.getElementById('alarmSmsBtn'),
    btnDismissAlarm: document.getElementById('btnDismissAlarm'),

    navItems: document.querySelectorAll('.nav-item'),
    tabPanes: document.querySelectorAll('.tab-pane')
  };

  // Known Local Transit Hubs for instant zero-latency search
  const KNOWN_TRANSIT_STOPS = [
    { name: 'Ambattur OT Bus Stand', lat: 13.1143, lng: 80.1548, sub: 'Ambattur Old Town Major Bus Depot, Chennai' },
    { name: 'Canara Bus Stand (Ambattur)', lat: 13.1190, lng: 80.1620, sub: 'Canara Bank Bus Stop / CTH Road, Ambattur' },
    { name: 'Ambattur Industrial Estate Bus Stand', lat: 13.0982, lng: 80.1613, sub: 'MTC Depot, Ambattur Estate' },
    { name: 'Thirumullaivoyal Bus Stop', lat: 13.1287, lng: 80.1342, sub: 'CTH Road, Thirumullaivoyal' },
    { name: 'Avadi Bus Terminus', lat: 13.1165, lng: 80.0988, sub: 'Avadi Major Bus Depot, Chennai' },
    { name: 'Koyambedu CMBT Bus Terminus', lat: 13.0694, lng: 80.2057, sub: 'Chennai Mofussil Bus Terminus' },
    { name: 'Red Hills Bus Stand', lat: 13.1977, lng: 80.1983, sub: 'GNT Road, Red Hills' },
    { name: 'Poonamallee Bus Terminus', lat: 13.0506, lng: 80.0924, sub: 'Poonamallee Depot, Chennai' },
    { name: 'Padi Saravana Stores Bus Stop', lat: 13.1006, lng: 80.1837, sub: 'Padi Junction, CTH Road' },
    { name: 'Mogappair West Bus Depot', lat: 13.0841, lng: 80.1746, sub: 'Mogappair West, Chennai' },
    { name: 'Mogappair East Bus Stop', lat: 13.0855, lng: 80.1880, sub: 'Mogappair East, Chennai' },
    { name: 'Anna Nagar West Bus Depot', lat: 13.0906, lng: 80.2037, sub: 'Anna Nagar West, Chennai' },
    { name: 'Broadway Bus Terminus', lat: 13.0894, lng: 80.2882, sub: 'Parrys Corner / Central, Chennai' },
    { name: 'Tambaram Bus Stand', lat: 12.9249, lng: 80.1000, sub: 'Tambaram Sanatorium / Railway Station' },
    { name: 'T. Nagar Bus Terminus', lat: 13.0405, lng: 80.2337, sub: 'Thyagaraya Nagar, Chennai' },
    { name: 'Guindy Bus Stand', lat: 13.0067, lng: 80.2026, sub: 'Guindy Railway Station / Metro' },
    { name: 'Vadapalani Bus Terminus', lat: 13.0524, lng: 80.2121, sub: 'Vadapalani Temple / Metro, Chennai' },
    { name: 'Villivakkam Bus Stand', lat: 13.1077, lng: 80.2052, sub: 'Villivakkam, Chennai' }
  ];

  // Map Tile Providers
  const TILE_PROVIDERS = {
    google_roadmap: {
      url: 'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
      name: 'Roadmap',
      options: { maxZoom: 20, subdomains: ['mt0', 'mt1', 'mt2', 'mt3'], attribution: 'Map data &copy; Google' }
    },
    google_hybrid: {
      url: 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
      name: 'Satellite',
      options: { maxZoom: 20, subdomains: ['mt0', 'mt1', 'mt2', 'mt3'], attribution: 'Imagery &copy; Google' }
    },
    osm: {
      url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      name: 'OpenStreetMap',
      options: { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }
    }
  };

  // -----------------------------------------------------------------
  // NAVIGATION SETUP
  // -----------------------------------------------------------------
  function setupNavigation() {
    const navButtons = document.querySelectorAll('.bottom-nav .nav-item');
    navButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const tabId = btn.getAttribute('data-tab');
        if (tabId && typeof window.switchTab === 'function') {
          window.switchTab(tabId);
        }
      });
    });
  }

  // -----------------------------------------------------------------
  // INITIALIZATION
  // -----------------------------------------------------------------
  function initApp() {
    // 1. Setup Navigation FIRST so tabs always work under all circumstances
    try { setupNavigation(); } catch (e) { console.error('[Init] Navigation error:', e); }

    // 2. Load UI Settings and update values
    try { loadSettingsIntoUI(); } catch (e) { console.error('[Init] Load settings error:', e); }

    // 3. Render Route and Contact chips
    try { renderRouteChips(); } catch (e) { console.error('[Init] Route chips error:', e); }
    try { renderContactChips(); } catch (e) { console.error('[Init] Contact chips error:', e); }

    // 4. Setup Map & Place Search
    try { setupUnifiedMap(); } catch (e) { console.error('[Init] Map error:', e); }
    try { setupPlaceSearch(); } catch (e) { console.error('[Init] Place search error:', e); }

    // 5. Setup Event Listeners
    try { setupEventListeners(); } catch (e) { console.error('[Init] Event listeners error:', e); }

    // 6. Setup Geolocation and background
    try { setupGeoCallbacks(); } catch (e) { console.error('[Init] Geo callbacks error:', e); }
    try { setupNativeBridgeCallbacks(); } catch (e) { console.error('[Init] Native bridge callbacks error:', e); }
    try { setupVisibilityWatch(); } catch (e) { console.error('[Init] Visibility watch error:', e); }

    // 7. Lists & timers
    try { renderSavedRoutesList(); } catch (e) { console.error('[Init] Saved routes error:', e); }
    try { renderSavedContactsList(); } catch (e) { console.error('[Init] Saved contacts error:', e); }
    try { renderHistory(); } catch (e) { console.error('[Init] History error:', e); }
    try { startClock(); } catch (e) { console.error('[Init] Clock error:', e); }
    try { updateMessagePreview(); } catch (e) { console.error('[Init] Message preview error:', e); }

    // 8. Initial location
    try { acquireInitialLocation(); } catch (e) { console.error('[Init] Initial location error:', e); }
  }

  function setAppState(newState) {
    currentState = newState;
    if (els.statusBadge) els.statusBadge.className = 'status-badge ' + newState.toLowerCase();
    if (els.statusText) els.statusText.textContent = newState;

    if (newState === STATES.IDLE || newState === STATES.ENDED) {
      if (els.btnStartTrip) els.btnStartTrip.style.display = 'inline-flex';
      if (els.btnEnterSleep) els.btnEnterSleep.style.display = 'none';
      if (els.btnStopTrip) els.btnStopTrip.style.display = 'none';
      releaseWakeLock();
    } else if (newState === STATES.TRACKING) {
      if (els.btnStartTrip) els.btnStartTrip.style.display = 'none';
      if (els.btnEnterSleep) els.btnEnterSleep.style.display = 'inline-flex';
      if (els.btnStopTrip) els.btnStopTrip.style.display = 'inline-flex';
    } else if (newState === STATES.ALERTING) {
      if (els.btnStartTrip) els.btnStartTrip.style.display = 'none';
      if (els.btnEnterSleep) els.btnEnterSleep.style.display = 'none';
      if (els.btnStopTrip) els.btnStopTrip.style.display = 'none';
    }
  }

  function loadSettingsIntoUI() {
    currentSettings = window.StorageManager.getSettings();
    savedRoutes = window.StorageManager.getSavedRoutes();
    savedContacts = window.StorageManager.getSavedContacts();

    const triggerName = currentSettings.triggerStop?.name || 'Ambattur OT Bus Stand';
    const finalName = currentSettings.finalStop?.name || 'Canara Bus Stand';
    const activeContact = window.StorageManager.getActiveContact() || { name: 'Dad', phone: '' };

    // Headers & Labels (Safe null-checked)
    if (els.headerRouteSub) els.headerRouteSub.textContent = `${triggerName} ➔ ${finalName}`;
    if (els.heroTriggerName) els.heroTriggerName.textContent = triggerName;
    if (els.heroDestName) els.heroDestName.textContent = finalName;
    if (els.heroDistLabel) els.heroDistLabel.textContent = `Distance To ${triggerName.toUpperCase()}`;
    if (els.summaryTriggerName) els.summaryTriggerName.textContent = triggerName;
    if (els.summaryFinalName) els.summaryFinalName.textContent = finalName;
    if (els.summaryContactName) els.summaryContactName.textContent = activeContact.name;
    if (els.sleepStopName) els.sleepStopName.textContent = `Approaching ${triggerName}`;

    // Active Edit Stop field in Map Tab
    try { updateActiveEditModeUI(); } catch (e) {}

    // Radius Slider
    const radius = currentSettings.triggerRadius || 400;
    if (els.sliderTriggerRadius) els.sliderTriggerRadius.value = radius;
    if (els.badgeTriggerRadius) els.badgeTriggerRadius.textContent = radius + ' m';

    // Contacts UI
    try { populateContactDropdown(); } catch (e) {}
    if (els.inputContactPhone) els.inputContactPhone.value = activeContact.phone || '';
    if (els.btnSaveContactLabel) els.btnSaveContactLabel.textContent = activeContact.name;
    try { updatePhonePreview(activeContact.phone); } catch (e) {}

    // Auto-Action on Reach Settings
    try { updateAutoActionUI(); } catch (e) {}
    try { updateQuickTestDisplay(); } catch (e) {}

    // Preferences
    if (els.inputCustomMsg) els.inputCustomMsg.value = currentSettings.customMessageTemplate || '';
    if (els.toggleSendLiveLocation) els.toggleSendLiveLocation.checked = currentSettings.sendLiveLocationLink !== false;
    if (els.toggleSoundAlarm) els.toggleSoundAlarm.checked = currentSettings.alertMode !== 'vibrate_only';
    if (els.toggleVoiceSpeech) els.toggleVoiceSpeech.checked = currentSettings.ttsAnnounceEnabled !== false;
    if (els.toggleWakeLock) els.toggleWakeLock.checked = currentSettings.wakeLockEnabled !== false;
    if (els.selectAlarmSound) els.selectAlarmSound.value = currentSettings.audioAlarmSound || 'bus_bell';
    if (els.inputCallMeBotKey) els.inputCallMeBotKey.value = currentSettings.callMeBotApiKey || '';
    if (els.inputWebhookUrl) els.inputWebhookUrl.value = currentSettings.webhookUrl || '';

    if (els.inputGoogleApiKey) {
      els.inputGoogleApiKey.value = currentSettings.googleMapsApiKey || '';
    }
  }

  function updatePhonePreview(rawPhone) {
    const formatted = window.StorageManager.formatPhone(rawPhone);
    if (!els.phoneValidationStatus || !els.phoneFormattedPreview) return;

    if (formatted.isValid) {
      els.phoneValidationStatus.textContent = '✓ Ready';
      els.phoneValidationStatus.style.color = '#34d399';
      els.phoneFormattedPreview.textContent = `Dialer: ${formatted.tel} • WhatsApp: ${formatted.whatsapp}`;
    } else if (rawPhone && rawPhone.trim().length > 0) {
      els.phoneValidationStatus.textContent = 'Needs 10 digits';
      els.phoneValidationStatus.style.color = '#f59e0b';
      els.phoneFormattedPreview.textContent = `Format: +919876543210 or 10-digit number`;
    } else {
      els.phoneValidationStatus.textContent = 'Auto-formats +91';
      els.phoneValidationStatus.style.color = '#38bdf8';
      els.phoneFormattedPreview.textContent = 'Enter number so Dad gets call & WhatsApp';
    }
  }

  function updateQuickTestDisplay() {
    const activeContact = window.StorageManager.getActiveContact();
    const phoneInfo = window.StorageManager.formatPhone(activeContact.phone);

    if (els.quickTestContactName) els.quickTestContactName.textContent = activeContact.name;
    if (els.quickTestPhoneDisplay) {
      if (phoneInfo.isValid) {
        els.quickTestPhoneDisplay.textContent = `${activeContact.name}: ${phoneInfo.display} (Verified)`;
        els.quickTestPhoneDisplay.style.color = '#34d399';
      } else {
        els.quickTestPhoneDisplay.textContent = `⚠️ No valid number set for ${activeContact.name} - Tap to enter`;
        els.quickTestPhoneDisplay.style.color = '#f87171';
      }
    }
  }

  function updateAutoActionUI() {
    const activeContact = window.StorageManager.getActiveContact();
    const action = currentSettings.autoActionOnReach || 'auto_call';
    const countdown = (currentSettings.autoActionCountdownSec !== undefined) ? parseInt(currentSettings.autoActionCountdownSec) : 3;

    // Check radio buttons in Contacts tab
    const radios = document.querySelectorAll('input[name="autoActionRadio"]');
    radios.forEach(radio => {
      radio.checked = (radio.value === action);
    });

    const options = document.querySelectorAll('.auto-action-option');
    options.forEach(opt => {
      if (opt.getAttribute('data-action') === action) {
        opt.classList.add('active');
      } else {
        opt.classList.remove('active');
      }
    });

    if (els.selectAutoCountdown) {
      els.selectAutoCountdown.value = countdown;
    }

    // Update Hero and Summary Badges on Tracker tab
    const isNative = (window.AndroidBridge && typeof window.AndroidBridge.isNativeApp === 'function' && window.AndroidBridge.isNativeApp());

    let actionDesc = isNative ? `⚡ Direct Call ${activeContact.name}` : `Auto-Call ${activeContact.name}`;
    let summaryDesc = isNative ? `directly dial ${activeContact.name} upon reaching trigger stop` : `automatically call ${activeContact.name}`;

    if (action === 'auto_whatsapp') {
      actionDesc = `Auto-WhatsApp ${activeContact.name}`;
      summaryDesc = `automatically send WhatsApp with live GPS to ${activeContact.name}`;
    } else if (action === 'auto_sms') {
      actionDesc = `Auto-SMS ${activeContact.name}`;
      summaryDesc = `automatically send SMS to ${activeContact.name}`;
    } else if (action === 'auto_call_and_wa') {
      actionDesc = isNative ? `⚡ Direct Call & WhatsApp ${activeContact.name}` : `Auto-Call & WhatsApp ${activeContact.name}`;
      summaryDesc = `automatically call and send WhatsApp to ${activeContact.name}`;
    } else if (action === 'prompt_only') {
      actionDesc = `Vibrate & Prompt (Manual)`;
      summaryDesc = `vibrate and show 1-tap call & WhatsApp buttons for ${activeContact.name}`;
    }

    if (els.heroAutoActionLabel) els.heroAutoActionLabel.textContent = actionDesc;
    if (els.heroAutoCountdownLabel) {
      els.heroAutoCountdownLabel.textContent = countdown === 0 ? 'Instant' : `${countdown}s Countdown`;
    }
    if (els.summaryAutoActionText) els.summaryAutoActionText.textContent = summaryDesc;
  }

  // -----------------------------------------------------------------
  // UNIFIED SINGLE MAP SYSTEM
  // -----------------------------------------------------------------
  function setupUnifiedMap() {
    const mapEl = document.getElementById('mapUnified');
    if (!mapEl || typeof L === 'undefined') {
      console.warn('[Map] Container mapUnified or Leaflet library not found.');
      return;
    }

    if (mapEl._leaflet_id) {
      mapEl._leaflet_id = null;
    }
    if (mapUnified) {
      try {
        mapUnified.remove();
      } catch (e) {
        console.warn('[Map] Removal notice:', e);
      }
      mapUnified = null;
    }
    window.mapUnified = null;

    const triggerLat = currentSettings.triggerStop?.lat || 13.1143;
    const triggerLng = currentSettings.triggerStop?.lng || 80.1548;
    const finalLat = currentSettings.finalStop?.lat || 13.1190;
    const finalLng = currentSettings.finalStop?.lng || 80.1620;

    // Center map between the two stops
    const centerLat = (triggerLat + finalLat) / 2;
    const centerLng = (triggerLng + finalLng) / 2;

    try {
      mapUnified = L.map('mapUnified', { zoomControl: true }).setView([centerLat, centerLng], 14);
      window.mapUnified = mapUnified;
      window.refreshMapVisualPins = refreshMapVisualPins;
    } catch (err) {
      console.error('[Map] Map initialization error:', err);
      return;
    }

    // Set initial Tile Layer
    setMapTileStyle(currentSettings.mapTileStyle || 'google_roadmap');

    // 1. Trigger Stop Marker (Amber Flag)
    const triggerIcon = L.divIcon({
      className: 'custom-trigger-pin',
      html: `<div id="mapUnifiedTriggerLabel" style="background:#f59e0b;color:#000;font-weight:700;font-size:11px;padding:3px 9px;border-radius:6px;border:2px solid #fff;box-shadow:0 0 10px rgba(245,158,11,0.7);white-space:nowrap;cursor:pointer;">🚩 ${currentSettings.triggerStop.name}</div>`,
      iconSize: [120, 24],
      iconAnchor: [60, 12]
    });
    markerTrigger = L.marker([triggerLat, triggerLng], { icon: triggerIcon, draggable: true }).addTo(mapUnified);

    markerTrigger.on('dragend', (e) => {
      const pos = e.target.getLatLng();
      currentSettings.triggerStop.lat = pos.lat;
      currentSettings.triggerStop.lng = pos.lng;
      updateGeofenceCircle();
      updateRouteLine();
    });

    // 2. Geofence Circle
    updateGeofenceCircle();

    // 3. Final Drop Stop Marker (Emerald Flag)
    const finalIcon = L.divIcon({
      className: 'custom-final-pin',
      html: `<div id="mapUnifiedFinalLabel" style="background:#10b981;color:#fff;font-weight:700;font-size:11px;padding:3px 9px;border-radius:6px;border:2px solid #fff;box-shadow:0 0 10px rgba(16,185,129,0.7);white-space:nowrap;cursor:pointer;">🏁 ${currentSettings.finalStop.name}</div>`,
      iconSize: [120, 24],
      iconAnchor: [60, 12]
    });
    markerFinal = L.marker([finalLat, finalLng], { icon: finalIcon, draggable: true }).addTo(mapUnified);

    markerFinal.on('dragend', (e) => {
      const pos = e.target.getLatLng();
      currentSettings.finalStop.lat = pos.lat;
      currentSettings.finalStop.lng = pos.lng;
      updateRouteLine();
    });

    // 4. Connecting Route Line (Dashed Cyan Polyline)
    updateRouteLine();

    // Map Tap/Click sets active edit stop
    mapUnified.on('click', (e) => {
      if (activeEditMode === 'trigger') {
        currentSettings.triggerStop.lat = e.latlng.lat;
        currentSettings.triggerStop.lng = e.latlng.lng;
        markerTrigger.setLatLng(e.latlng);
        updateGeofenceCircle();
      } else {
        currentSettings.finalStop.lat = e.latlng.lat;
        currentSettings.finalStop.lng = e.latlng.lng;
        markerFinal.setLatLng(e.latlng);
      }
      updateRouteLine();
    });
  }

  function setMapTileStyle(styleKey) {
    if (!TILE_PROVIDERS[styleKey]) styleKey = 'google_roadmap';
    currentSettings.mapTileStyle = styleKey;
    window.StorageManager.saveSettings(currentSettings);

    const cfg = TILE_PROVIDERS[styleKey];
    if (mapUnified) {
      if (activeTileLayer) mapUnified.removeLayer(activeTileLayer);
      activeTileLayer = L.tileLayer(cfg.url, cfg.options).addTo(mapUnified);
    }

    [els.btnTileGoogleRoads, els.btnTileGoogleSatellite, els.btnTileOsm].forEach(btn => {
      if (!btn) return;
      if (btn.getAttribute('data-style') === styleKey) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  function updateGeofenceCircle() {
    if (!mapUnified) return;
    if (circleTrigger) mapUnified.removeLayer(circleTrigger);

    const radius = parseInt(els.sliderTriggerRadius.value) || currentSettings.triggerRadius || 400;
    circleTrigger = L.circle([currentSettings.triggerStop.lat, currentSettings.triggerStop.lng], {
      radius: radius,
      color: '#f59e0b',
      fillColor: '#f59e0b',
      fillOpacity: 0.22,
      weight: 2,
      dashArray: '5, 5'
    }).addTo(mapUnified);
  }

  function updateRouteLine() {
    if (!mapUnified) return;
    if (routePolyline) mapUnified.removeLayer(routePolyline);

    const latLngs = [
      [currentSettings.triggerStop.lat, currentSettings.triggerStop.lng],
      [currentSettings.finalStop.lat, currentSettings.finalStop.lng]
    ];

    routePolyline = L.polyline(latLngs, {
      color: '#06b6d4',
      weight: 3,
      opacity: 0.8,
      dashArray: '8, 8'
    }).addTo(mapUnified);
  }

  function updateUserMarker(lat, lng, heading = 0) {
    if (!mapUnified) return;
    const latLng = [lat, lng];
    const headingDeg = Math.round(heading || 0);

    const markerHtml = `
      <div class="user-heading-container">
        <div class="user-heading-cone" style="transform: rotate(${headingDeg}deg);"></div>
        <div class="user-heading-dot" title="Your live location"></div>
      </div>
    `;

    const icon = L.divIcon({
      className: 'custom-live-user-marker',
      html: markerHtml,
      iconSize: [36, 36],
      iconAnchor: [18, 18]
    });

    if (!userMarker) {
      userMarker = L.marker(latLng, { icon: icon, zIndexOffset: 1000 }).addTo(mapUnified);
    } else {
      userMarker.setLatLng(latLng);
      userMarker.setIcon(icon);
    }
  }

  function updateActiveEditModeUI() {
    if (activeEditMode === 'trigger') {
      if (els.btnSelectTriggerMode) els.btnSelectTriggerMode.classList.add('active');
      if (els.btnSelectFinalMode) els.btnSelectFinalMode.classList.remove('active');
      if (els.lblCurrentStopName) els.lblCurrentStopName.textContent = '1. Alert Trigger Checkpoint Name';
      if (els.inputStopName) els.inputStopName.value = currentSettings.triggerStop?.name || 'Ambattur OT Bus Stand';
    } else {
      if (els.btnSelectFinalMode) els.btnSelectFinalMode.classList.add('active');
      if (els.btnSelectTriggerMode) els.btnSelectTriggerMode.classList.remove('active');
      if (els.lblCurrentStopName) els.lblCurrentStopName.textContent = '2. Final Drop Stop Name';
      if (els.inputStopName) els.inputStopName.value = currentSettings.finalStop?.name || 'Canara Bus Stand';
    }
  }

  function refreshMapVisualPins() {
    if (!mapUnified) return;

    if (markerTrigger && currentSettings.triggerStop) {
      markerTrigger.setLatLng([currentSettings.triggerStop.lat, currentSettings.triggerStop.lng]);
    }
    if (markerFinal && currentSettings.finalStop) {
      markerFinal.setLatLng([currentSettings.finalStop.lat, currentSettings.finalStop.lng]);
    }

    const tLabel = document.getElementById('mapUnifiedTriggerLabel');
    if (tLabel) tLabel.textContent = `🚩 ${currentSettings.triggerStop?.name || 'Trigger'}`;

    const fLabel = document.getElementById('mapUnifiedFinalLabel');
    if (fLabel) fLabel.textContent = `🏁 ${currentSettings.finalStop?.name || 'Drop'}`;

    updateGeofenceCircle();
    updateRouteLine();

    // Fit bounds to show both stops nicely
    try {
      if (currentSettings.triggerStop && currentSettings.finalStop) {
        const bounds = L.latLngBounds([
          [currentSettings.triggerStop.lat, currentSettings.triggerStop.lng],
          [currentSettings.finalStop.lat, currentSettings.finalStop.lng]
        ]);
        mapUnified.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
      }
    } catch (e) {}
  }

  // -----------------------------------------------------------------
  // SMART PLACE SEARCH ENGINE
  // -----------------------------------------------------------------
  function setupPlaceSearch() {
    const input = els.inputSearchPlace;
    const dropdown = els.searchResultsDropdown;
    const clearBtn = els.btnClearSearchPlace;
    if (!input || !dropdown) return;

    input.addEventListener('input', (e) => {
      const q = e.target.value.trim();
      if (!q) {
        dropdown.style.display = 'none';
        if (clearBtn) clearBtn.style.display = 'none';
        return;
      }
      if (clearBtn) clearBtn.style.display = 'block';

      if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => {
        performPlaceSearch(q, dropdown);
      }, 300);
    });

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        input.value = '';
        dropdown.style.display = 'none';
        clearBtn.style.display = 'none';
      });
    }
  }

  async function performPlaceSearch(query, dropdownEl) {
    const qRaw = query.trim();
    if (!qRaw) return;

    dropdownEl.innerHTML = '<div style="padding: 10px; font-size: 0.8rem; color: #94a3b8; text-align: center;">Searching places...</div>';
    dropdownEl.style.display = 'block';

    const results = [];
    const qLower = qRaw.toLowerCase();
    const qClean = qRaw.replace(/\b(bus\s*stand|bus\s*stop|terminus|station)\b/gi, '').trim();

    // 1. Instant local stop library match
    KNOWN_TRANSIT_STOPS.forEach(stop => {
      const matchName = stop.name.toLowerCase().includes(qLower) || (qClean && stop.name.toLowerCase().includes(qClean.toLowerCase()));
      const matchSub = stop.sub.toLowerCase().includes(qLower) || (qClean && stop.sub.toLowerCase().includes(qClean.toLowerCase()));
      if (matchName || matchSub) {
        results.push({
          name: stop.name,
          sub: `⭐ Local Transit Hub • ${stop.sub}`,
          lat: stop.lat,
          lng: stop.lng
        });
      }
    });

    if (results.length > 0) {
      renderSearchResults(results, dropdownEl);
    }

    // 2. Komoot Photon & Nominatim Online Search
    try {
      const biasLat = userLiveCoords ? userLiveCoords.lat : currentSettings.triggerStop.lat;
      const biasLng = userLiveCoords ? userLiveCoords.lng : currentSettings.triggerStop.lng;

      const photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(qClean || qRaw)}&lat=${biasLat}&lon=${biasLng}&limit=5`;
      const photonRes = await fetch(photonUrl);
      if (photonRes.ok) {
        const photonData = await photonRes.json();
        if (photonData?.features) {
          photonData.features.forEach(f => {
            const p = f.properties;
            const coords = f.geometry.coordinates;
            const name = p.name || p.street || p.city;
            if (name && !results.some(r => Math.abs(r.lat - coords[1]) < 0.001 && Math.abs(r.lng - coords[0]) < 0.001)) {
              const sub = [p.district, p.city, p.state].filter(Boolean).join(', ') || 'Location Match';
              results.push({ name, sub, lat: coords[1], lng: coords[0] });
            }
          });
        }
      }
    } catch (e) {
      console.warn('[Search] Photon notice:', e);
    }

    if (results.length === 0) {
      dropdownEl.innerHTML = `
        <div style="padding: 12px; font-size: 0.8rem; color: #94a3b8; text-align: center;">
          <div>No stops found for "<strong>${qRaw}</strong>".</div>
          <div style="font-size: 0.72rem; color: #64748b; margin-top: 4px;">Tap directly on the map to pin your stop, or use "Use Current GPS".</div>
        </div>
      `;
      return;
    }

    renderSearchResults(results, dropdownEl);
  }

  function renderSearchResults(results, dropdownEl) {
    dropdownEl.innerHTML = results.slice(0, 6).map((item, idx) => `
      <div class="search-result-item" data-index="${idx}">
        <div class="search-result-title">📍 ${item.name}</div>
        <div class="search-result-sub">${item.sub}</div>
      </div>
    `).join('');

    dropdownEl.querySelectorAll('.search-result-item').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.getAttribute('data-index'));
        const place = results[idx];
        dropdownEl.style.display = 'none';
        applySelectedPlace(place);
      });
    });
  }

  function applySelectedPlace(place) {
    if (activeEditMode === 'trigger') {
      currentSettings.triggerStop = { name: place.name, lat: place.lat, lng: place.lng };
      els.inputStopName.value = place.name;
      markerTrigger.setLatLng([place.lat, place.lng]);
    } else {
      currentSettings.finalStop = { name: place.name, lat: place.lat, lng: place.lng };
      els.inputStopName.value = place.name;
      markerFinal.setLatLng([place.lat, place.lng]);
    }

    els.inputSearchPlace.value = '';
    els.btnClearSearchPlace.style.display = 'none';

    refreshMapVisualPins();
    mapUnified.setView([place.lat, place.lng], 15);
  }

  // -----------------------------------------------------------------
  // INITIAL LIVE GPS ACQUISITION
  // -----------------------------------------------------------------
  function acquireInitialLocation() {
    GeoTracker.getLiveLocation(
      (pos) => {
        const { latitude, longitude, heading, speed, accuracy } = pos.coords;
        userLiveCoords = { lat: latitude, lng: longitude };

        updateUserMarker(latitude, longitude, heading || 0);

        const distToTrigger = GeoTracker.calculateDistance(
          latitude, longitude, currentSettings.triggerStop.lat, currentSettings.triggerStop.lng
        );
        const distToFinal = GeoTracker.calculateDistance(
          latitude, longitude, currentSettings.finalStop.lat, currentSettings.finalStop.lng
        );

        els.heroDistance.textContent = GeoTracker.formatDistance(distToTrigger);
        els.heroDistToFinal.textContent = GeoTracker.formatDistance(distToFinal);

        const dir = heading ? GeoTracker.getCardinalDirection(heading) : 'Live';
        els.directionText.textContent = `Live GPS: Heading ${dir} (${Math.round(heading || 0)}°) • ±${Math.round(accuracy || 10)}m`;
        if (els.directionArrowIcon) {
          els.directionArrowIcon.style.transform = `rotate(${heading || 0}deg)`;
        }
      },
      (err) => {
        console.warn('[GPS] Initial acquisition notice:', err);
        els.directionText.textContent = 'Tap "Center Me" on map to allow GPS';
      }
    );
  }

  // -----------------------------------------------------------------
  // GEOLOCATION ENGINE CALLBACKS
  // -----------------------------------------------------------------
  function setupGeoCallbacks() {
    window.geoTracker.onLocationUpdate = (data) => {
      userLiveCoords = data.coords;
      currentBusSpeedKmh = data.speedKmh || 0;
      currentEtaMins = data.etaMinutes || 5;

      // Update Hero Metrics
      els.heroDistance.textContent = data.formattedDistToTrigger;
      els.heroSpeed.textContent = currentBusSpeedKmh;
      els.heroEta.textContent = currentEtaMins;
      els.heroDistToFinal.textContent = data.formattedDistToFinal;

      // Update Compass & Direction
      if (els.directionArrowIcon) {
        els.directionArrowIcon.style.transform = `rotate(${data.heading || 0}deg)`;
      }
      els.directionText.textContent = `Heading ${data.compassDirection} (${data.heading || 0}°) • Speed ${currentBusSpeedKmh} km/h`;

      // Update Sleep Mode Screen
      els.sleepDistance.textContent = data.formattedDistToTrigger;
      els.sleepEta.textContent = `Speed: ${currentBusSpeedKmh} km/h • ETA: ~${currentEtaMins} mins • Heading ${data.compassDirection}`;

      // Update Map Marker
      if (userLiveCoords) {
        updateUserMarker(userLiveCoords.lat, userLiveCoords.lng, data.heading || 0);
      }

      // Feed data to Cockpit Engine (if running)
      if (window.cockpitEngine && window.cockpitEngine.isRunning) {
        window.cockpitEngine.feedGPS(data);
      }
    };

    window.geoTracker.onCrossingTriggerStop = (distToTrigger, distToFinal, triggerData) => {
      triggerCrossingAlert(distToTrigger, triggerData);
    };

    window.geoTracker.onError = (msg) => {
      console.warn('[GPS Error]:', msg);
      els.directionText.textContent = 'Searching GPS signal...';
    };
  }

  // NATIVE ANDROID BRIDGE & SHAKE CALLBACKS
  function setupNativeBridgeCallbacks() {
    window.onNativeLocationUpdate = (lat, lng, speedKmh, speedAccuracyKmh, accuracyMeters, bearing, ageMs, distRemainingMeters) => {
      userLiveCoords = { lat, lng };
      currentBusSpeedKmh = Math.round(speedKmh);

      // Hero Metrics
      const formattedDist = distRemainingMeters >= 1000
        ? (distRemainingMeters / 1000).toFixed(1) + ' km'
        : Math.round(distRemainingMeters) + ' m';
      if (els.heroDistance) els.heroDistance.textContent = formattedDist;
      if (els.heroSpeed) els.heroSpeed.textContent = currentBusSpeedKmh;

      // Accuracy Readout Badges
      const gpsAccEl = document.getElementById('trackerGpsAccuracy');
      const speedAccEl = document.getElementById('trackerSpeedAccuracy');
      const fixAgeEl = document.getElementById('trackerFixAge');

      if (gpsAccEl) {
        gpsAccEl.textContent = accuracyMeters > 0 ? `📡 GPS: ±${Math.round(accuracyMeters)}m` : '📡 GPS: Active';
      }
      if (speedAccEl) {
        speedAccEl.textContent = speedAccuracyKmh > 0 ? `⚡ Speed Acc: ±${speedAccuracyKmh.toFixed(1)} km/h` : '⚡ Speed: GPS';
      }
      if (fixAgeEl) {
        const ageSec = (ageMs / 1000).toFixed(1);
        fixAgeEl.textContent = `⏱️ Fix: ${ageSec}s ago`;
        if (ageMs > 5000) fixAgeEl.classList.add('stale');
        else fixAgeEl.classList.remove('stale');
      }

      // Map Marker
      updateUserMarker(lat, lng, bearing >= 0 ? bearing : 0);

      // Feed to Cockpit Engine
      if (window.cockpitEngine && window.cockpitEngine.isRunning) {
        window.cockpitEngine.feedGPS({
          speedKmh,
          speedAccuracyKmh,
          accuracyMeters,
          bearing,
          coords: { lat, lng }
        });
      }
    };

    window.onNativeAlarmTriggered = (stopName, distRemainingMeters) => {
      console.log('[Native] Alarm triggered at stop:', stopName);
      setAppState(STATES.ALERTING);
      if (els.sleepOverlay) els.sleepOverlay.classList.remove('active');
      if (els.alarmOverlay) els.alarmOverlay.classList.add('active');

      // Reset shake pills
      [1, 2, 3].forEach(i => {
        const p = document.getElementById('alarmShakePill' + i);
        if (p) p.className = 'shake-pill';
      });
      const hint = document.getElementById('alarmShakeHint');
      if (hint) hint.textContent = 'Shake phone 3 times firmly to stop alarm';

      // Hide post-dismiss card
      const postCard = document.getElementById('alarmPostDismissCard');
      if (postCard) postCard.style.display = 'none';

      const shakeBox = document.getElementById('alarmShakeSection');
      if (shakeBox) shakeBox.style.display = 'block';

      // Start 3-second auto action countdown for phone dialer
      const triggerData = {
        distanceMeters: distRemainingMeters || 200,
        latitude: currentSettings.triggerStop.lat,
        longitude: currentSettings.triggerStop.lng
      };
      updateAlarmOverlayActions(triggerData);
      startAutoActionCountdown(triggerData);
    };

    window.onNativeShakeProgress = (count, max) => {
      console.log(`[Native Shake Progress]: ${count}/${max}`);
      for (let i = 1; i <= 3; i++) {
        const p = document.getElementById('alarmShakePill' + i);
        if (p) {
          if (i <= count) p.className = 'shake-pill completed';
          else p.className = 'shake-pill';
        }
      }
      const hint = document.getElementById('alarmShakeHint');
      if (hint) hint.textContent = `Shake motion detected (${count}/${max})...`;
    };

    window.onNativeShakeReset = () => {
      console.log('[Native Shake Reset]');
      for (let i = 1; i <= 3; i++) {
        const p = document.getElementById('alarmShakePill' + i);
        if (p) p.className = 'shake-pill';
      }
      const hint = document.getElementById('alarmShakeHint');
      if (hint) hint.textContent = 'Sequence timed out. Shake phone 3 times firmly.';
    };

    window.onNativeAlarmDismissed = (source, contactName, contactPhone) => {
      console.log(`[Native Alarm Dismissed]: source=${source}, contact=${contactName}`);
      cancelAutoActionCountdown();
      window.alarmEngine.stop();

      // Show Post-Alarm Action Card inside overlay
      const shakeBox = document.getElementById('alarmShakeSection');
      if (shakeBox) shakeBox.style.display = 'none';

      const postCard = document.getElementById('alarmPostDismissCard');
      if (postCard) {
        postCard.style.display = 'block';
        const titleEl = document.getElementById('postDismissTitle');
        const subEl = document.getElementById('postDismissSub');
        const dialBtn = document.getElementById('btnPostDismissDial');
        const closeBtn = document.getElementById('btnPostDismissClose');

        if (titleEl) titleEl.textContent = `Near ${currentSettings.triggerStop.name}`;
        if (subEl) subEl.textContent = `Alarm silenced via ${source === 'shake' ? 'shake gesture' : 'manual button'}. Call ${contactName} for pickup?`;
        if (dialBtn) {
          dialBtn.innerHTML = `📞 Open Dialer: ${contactName} (${contactPhone})`;
          dialBtn.onclick = () => {
            if (window.AndroidBridge && typeof window.AndroidBridge.openDialer === 'function') {
              window.AndroidBridge.openDialer(contactPhone);
            } else {
              window.location.href = `tel:${contactPhone}`;
            }
          };
        }
        if (closeBtn) {
          closeBtn.onclick = () => {
            if (els.alarmOverlay) els.alarmOverlay.classList.remove('active');
            setAppState(STATES.ENDED);
          };
        }
      }
    };

    // State Restoration when Activity/WebView reloads
    window.onNativeStateRestored = (snapshot) => {
      console.log('[Native State Restored]:', snapshot);
      if (snapshot && snapshot.isTripActive) {
        setAppState(STATES.TRACKING);
        if (snapshot.targetStopName) currentSettings.triggerStop.name = snapshot.targetStopName;
        if (snapshot.lastDistRemainingMeters && snapshot.lastDistRemainingMeters > 0) {
          const formatted = snapshot.lastDistRemainingMeters >= 1000
            ? (snapshot.lastDistRemainingMeters / 1000).toFixed(1) + ' km'
            : Math.round(snapshot.lastDistRemainingMeters) + ' m';
          if (els.heroDistance) els.heroDistance.textContent = formatted;
        }
        if (snapshot.isAlarming) {
          window.onNativeAlarmTriggered(snapshot.targetStopName || 'Checkpoint', snapshot.lastDistRemainingMeters || 0);
        }
      }
    };

    // Dedicated Shake Test Controller (Settings tab)
    let isTestingShake = false;
    const btnToggleTestShake = document.getElementById('btnToggleTestShake');
    const shakeTestFeedback = document.getElementById('shakeTestFeedback');
    const testShakeStatus = document.getElementById('testShakeStatus');

    if (btnToggleTestShake) {
      on(btnToggleTestShake, 'click', () => {
        isTestingShake = !isTestingShake;
        if (isTestingShake) {
          btnToggleTestShake.textContent = '⏹️ Stop Shake Test';
          btnToggleTestShake.style.borderColor = '#ef4444';
          btnToggleTestShake.style.color = '#ef4444';
          if (shakeTestFeedback) shakeTestFeedback.style.display = 'block';
          if (testShakeStatus) testShakeStatus.textContent = 'Shake your phone firmly 3 times...';
          [1, 2, 3].forEach(i => {
            const p = document.getElementById('testShakePill' + i);
            if (p) p.className = 'shake-step-pill';
          });
          if (window.AndroidBridge && typeof window.AndroidBridge.setShakeTestMode === 'function') {
            window.AndroidBridge.setShakeTestMode(true);
          }
        } else {
          btnToggleTestShake.textContent = '👋 Start Shake Test';
          btnToggleTestShake.style.borderColor = '#38bdf8';
          btnToggleTestShake.style.color = '#38bdf8';
          if (shakeTestFeedback) shakeTestFeedback.style.display = 'none';
          if (window.AndroidBridge && typeof window.AndroidBridge.setShakeTestMode === 'function') {
            window.AndroidBridge.setShakeTestMode(false);
          }
        }
      });

      window.onShakeTestProgress = (count, max) => {
        for (let i = 1; i <= 3; i++) {
          const p = document.getElementById('testShakePill' + i);
          if (p) {
            if (i <= count) p.className = 'shake-step-pill active';
            else p.className = 'shake-step-pill';
          }
        }
        if (testShakeStatus) testShakeStatus.textContent = `Motion detected: Shake ${count} of ${max}...`;
      };

      window.onShakeTestCompleted = () => {
        for (let i = 1; i <= 3; i++) {
          const p = document.getElementById('testShakePill' + i);
          if (p) p.className = 'shake-step-pill completed';
        }
        if (testShakeStatus) testShakeStatus.textContent = '✅ 3 Shakes Confirmed! (Haptic pulse fired)';
        setTimeout(() => {
          if (isTestingShake && btnToggleTestShake) btnToggleTestShake.click();
        }, 2500);
      };

      window.onShakeTestReset = () => {
        for (let i = 1; i <= 3; i++) {
          const p = document.getElementById('testShakePill' + i);
          if (p) p.className = 'shake-step-pill';
        }
        if (testShakeStatus) testShakeStatus.textContent = 'Timed out (3s window). Shake 3 times firmly.';
      };
    }

    // =========================================================================
    // WEB FALLBACK SHAKE DETECTOR (active during ALERTING or shake test)
    // =========================================================================
    let webShakeCount = 0;
    let webLastShakeTime = 0;
    let webLastAccel = { x: 0, y: 0, z: 0 };
    let webShakeWindowTimer = null;

    if (window.DeviceMotionEvent) {
      window.addEventListener('devicemotion', (event) => {
        const isAlerting = (currentState === STATES.ALERTING);
        if (!isAlerting && !isTestingShake) return;

        const acc = event.accelerationIncludingGravity || event.acceleration;
        if (!acc || acc.x === null) return;

        const now = Date.now();
        const deltaX = Math.abs(acc.x - webLastAccel.x);
        const deltaY = Math.abs(acc.y - webLastAccel.y);
        const deltaZ = Math.abs(acc.z - webLastAccel.z);
        webLastAccel = { x: acc.x, y: acc.y, z: acc.z };

        const totalDelta = deltaX + deltaY + deltaZ;
        if (totalDelta > 13) {
          if (now - webLastShakeTime > 180) { // debounce reversal peaks
            webLastShakeTime = now;
            webShakeCount++;
            console.log('[Web Shake Detected]:', webShakeCount);

            if (isTestingShake) {
              if (window.onShakeTestProgress) window.onShakeTestProgress(webShakeCount, 3);
            } else {
              if (window.onNativeShakeProgress) window.onNativeShakeProgress(webShakeCount, 3);
            }

            clearTimeout(webShakeWindowTimer);
            webShakeWindowTimer = setTimeout(() => {
              webShakeCount = 0;
              if (isTestingShake) {
                if (window.onShakeTestReset) window.onShakeTestReset();
              } else {
                if (window.onNativeShakeReset) window.onNativeShakeReset();
              }
            }, 3500);

            if (webShakeCount >= 3) {
              console.log('[Web Shake Completed] 3 shakes confirmed!');
              webShakeCount = 0;
              clearTimeout(webShakeWindowTimer);
              if (isTestingShake) {
                if (window.onShakeTestCompleted) window.onShakeTestCompleted();
              } else {
                dismissAlarm('shake');
              }
            }
          }
        }
      }, { passive: true });
    }

    function dismissAlarm(source = 'manual_button') {
      cancelAutoActionCountdown();
      window.alarmEngine.stop();
      if (window.AndroidBridge && typeof window.AndroidBridge.dismissNativeAlarm === 'function') {
        window.AndroidBridge.dismissNativeAlarm();
      }
      window.geoTracker.stopTracking();
      stopCockpitMode();
      const contact = window.StorageManager.getActiveContact();
      if (window.onNativeAlarmDismissed) {
        window.onNativeAlarmDismissed(source, contact.name, contact.phone);
      }
    }
  }

  function triggerCrossingAlert(distToTrigger = 250, triggerData = null) {
    setAppState(STATES.ALERTING);

    if (triggerData) {
      if (triggerData.latitude && triggerData.longitude) {
        userLiveCoords = { lat: triggerData.latitude, lng: triggerData.longitude };
      }
      if (triggerData.speedKmh !== undefined) currentBusSpeedKmh = triggerData.speedKmh;
      if (triggerData.etaMinutes !== undefined) currentEtaMins = triggerData.etaMinutes;
    }

    // Dismiss sleep overlay
    els.sleepOverlay.classList.remove('active');

    const contact = window.StorageManager.getActiveContact();
    const triggerName = currentSettings.triggerStop.name;
    const finalName = currentSettings.finalStop.name;

    els.alarmHeadline.textContent = `NEAR ${triggerName.toUpperCase()}!`;
    els.alarmSubheadline.textContent = `Phone vibrating • Bus speed: ${currentBusSpeedKmh} km/h • Near ${triggerName}! Alerting ${contact.name} for pickup at ${finalName}!`;

    updateAlarmOverlayActions(triggerData);
    els.alarmOverlay.classList.add('active');

    // Start Vibration and Selected Alarm Sound Tone
    const soundEnabled = currentSettings.alertMode !== 'vibrate_only';
    window.alarmEngine.start(soundEnabled, currentSettings.audioAlarmSound || 'bus_bell');

    // Start Native Android Alarm Controller and Shake Detector
    if (window.AndroidBridge && typeof window.AndroidBridge.startAlarmAndShake === 'function') {
      window.AndroidBridge.startAlarmAndShake("Near " + triggerName);
    }

    // Reset shake pills for this alarm cycle
    for (let i = 1; i <= 3; i++) {
      const p = document.getElementById('alarmShakePill' + i);
      if (p) p.className = 'shake-pill';
    }
    const hint = document.getElementById('alarmShakeHint');
    if (hint) hint.textContent = 'Shake phone 3 times firmly to stop alarm';
    const postCard = document.getElementById('alarmPostDismissCard');
    if (postCard) postCard.style.display = 'none';
    const shakeBox = document.getElementById('alarmShakeSection');
    if (shakeBox) shakeBox.style.display = 'block';

    // Voice Speech Announcer (TTS)
    if (currentSettings.ttsAnnounceEnabled !== false) {
      const action = currentSettings.autoActionOnReach || 'auto_call';
      let actionVoice = `Calling ${contact.name} now!`;
      if (action === 'auto_whatsapp') actionVoice = `Sending WhatsApp message to ${contact.name} now!`;
      if (action === 'auto_sms') actionVoice = `Sending SMS to ${contact.name} now!`;

      window.alarmEngine.speak(`Attention! You have reached ${triggerName}! ${actionVoice}`);
    }

    // Show Native System Notification
    showArrivalNotification(triggerName, contact.name, finalName);

    // Save trip trigger log
    const lat = userLiveCoords ? userLiveCoords.lat : currentSettings.triggerStop.lat;
    const lng = userLiveCoords ? userLiveCoords.lng : currentSettings.triggerStop.lng;
    window.StorageManager.setLastTrigger({
      type: 'Crossed ' + triggerName,
      triggerStop: triggerName,
      finalStop: finalName,
      contact: contact.name,
      distance: Math.round(distToTrigger) + ' m',
      speed: currentBusSpeedKmh + ' km/h',
      liveLink: `https://maps.google.com/?q=${lat.toFixed(5)},${lng.toFixed(5)}`
    });
    renderHistory();

    // START THE AUTOMATED CALL / MESSAGE TRIGGER!
    startAutoActionCountdown(triggerData);
  }

  // -----------------------------------------------------------------
  // AUTOMATED CALLING & MESSAGING COUNTDOWN CONTROLLER
  // -----------------------------------------------------------------
  let autoActionTimer = null;
  let autoActionRemaining = 3;
  let currentActiveTriggerData = null;

  function startAutoActionCountdown(triggerData) {
    if (autoActionTimer) {
      clearInterval(autoActionTimer);
      autoActionTimer = null;
    }

    currentActiveTriggerData = triggerData;
    const links = generateActiveContactLinks(triggerData);
    const action = currentSettings.autoActionOnReach || 'auto_call';
    const countdownSec = (currentSettings.autoActionCountdownSec !== undefined) ? parseInt(currentSettings.autoActionCountdownSec) : 3;

    // If manual prompt only or no valid phone number set
    if (action === 'prompt_only' || !links.isValid) {
      if (els.alarmAutoActionBanner) els.alarmAutoActionBanner.style.display = 'none';
      return;
    }

    if (els.alarmAutoActionBanner) els.alarmAutoActionBanner.style.display = 'flex';

    let headline = `AUTOMATICALLY CALLING ${links.contactName.toUpperCase()}...`;
    if (action === 'auto_whatsapp') headline = `SENDING WHATSAPP TO ${links.contactName.toUpperCase()}...`;
    if (action === 'auto_sms') headline = `SENDING SMS TO ${links.contactName.toUpperCase()}...`;
    if (action === 'auto_call_and_wa') headline = `CALLING & WHATSAPP TO ${links.contactName.toUpperCase()}...`;

    if (els.autoActionHeadline) els.autoActionHeadline.textContent = headline;

    // Instant execution (0 seconds delay)
    if (countdownSec <= 0) {
      if (els.autoActionCountdownNum) els.autoActionCountdownNum.textContent = '⚡';
      if (els.autoActionSub) els.autoActionSub.innerHTML = `Dialing <strong>now</strong>!`;
      executeAutoAction(triggerData);
      return;
    }

    // Cancelable Countdown
    autoActionRemaining = countdownSec;
    if (els.autoActionCountdownNum) els.autoActionCountdownNum.textContent = autoActionRemaining;
    if (els.autoActionSecText) els.autoActionSecText.textContent = `${autoActionRemaining} second${autoActionRemaining > 1 ? 's' : ''}`;

    autoActionTimer = setInterval(() => {
      autoActionRemaining--;
      if (autoActionRemaining <= 0) {
        clearInterval(autoActionTimer);
        autoActionTimer = null;
        if (els.autoActionCountdownNum) els.autoActionCountdownNum.textContent = '✓';
        if (els.autoActionSub) els.autoActionSub.innerHTML = `Action <strong>executed</strong>!`;
        executeAutoAction(triggerData);
      } else {
        if (els.autoActionCountdownNum) els.autoActionCountdownNum.textContent = autoActionRemaining;
        if (els.autoActionSecText) els.autoActionSecText.textContent = `${autoActionRemaining} second${autoActionRemaining > 1 ? 's' : ''}`;
      }
    }, 1000);
  }

  function cancelAutoActionCountdown() {
    if (autoActionTimer) {
      clearInterval(autoActionTimer);
      autoActionTimer = null;
    }
    if (els.autoActionCountdownNum) els.autoActionCountdownNum.textContent = '✕';
    if (els.autoActionHeadline) els.autoActionHeadline.textContent = 'AUTO-ACTION PAUSED';
    if (els.autoActionSub) els.autoActionSub.textContent = 'Tap any button below to connect.';
  }

  function executeAutoAction(triggerData) {
    const links = generateActiveContactLinks(triggerData);
    if (!links.isValid) {
      alert(`⚠️ Please set a valid mobile number for ${links.contactName} in Contacts!`);
      return;
    }

    const action = currentSettings.autoActionOnReach || 'auto_call';

    // 1. Trigger background messaging ONLY if WhatsApp mode is requested (Zero messages for pure call)
    if (action === 'auto_whatsapp' || action === 'auto_call_and_wa') {
      sendSilentBackgroundAlert(links);
    }

    // 2. Trigger native OS call dialer or WhatsApp
    const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

    const targetPhone = links.phone || links.displayPhone || '9444883897';

    if (action === 'auto_call') {
      console.log('[Auto-Action] Direct Phone Call Mode: Calling directly to:', targetPhone);
      if (window.AndroidBridge && typeof window.AndroidBridge.makeDirectCall === 'function') {
        console.log('[Native AndroidBridge] Triggering automatic direct call to:', targetPhone);
        window.AndroidBridge.makeDirectCall(targetPhone);
      } else if (window.AndroidBridge && typeof window.AndroidBridge.openDialer === 'function') {
        console.log('[Native AndroidBridge] Opening native dialer to:', targetPhone);
        window.AndroidBridge.openDialer(targetPhone);
      } else {
        window.location.href = links.telLink;
        if (!isMobileDevice) {
          showDesktopDialerToast(links);
        }
      }
    } else if (action === 'auto_sms') {
      console.log('[Auto-Action] Triggering SMS to:', links.phone);
      window.location.href = links.smsLink;
    }
  }

  function showDesktopDialerToast(links) {
    const existing = document.getElementById('desktopDialerToast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'desktopDialerToast';
    toast.style.cssText = `
      position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
      background: #0f172a; border: 2px solid #38bdf8; border-radius: 12px;
      padding: 14px 18px; color: #fff; z-index: 10000; max-width: 420px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.8); text-align: center; font-size: 0.82rem;
    `;
    toast.innerHTML = `
      <div style="font-weight: 800; color: #38bdf8; font-size: 0.95rem; margin-bottom: 4px;">
        📞 Phone Call Triggered: ${links.contactName} (${links.displayPhone})
      </div>
      <div style="color: #94a3b8; font-size: 0.76rem; line-height: 1.4;">
        A cellular call was sent to your device. On your <strong>Android/iPhone</strong>, this immediately opens your Phone dialer. On PC, connect Windows Phone Link or test directly on your mobile phone!
      </div>
      <button onclick="this.parentElement.remove()" style="margin-top: 8px; background: #38bdf8; color: #0f172a; font-weight: 700; border: none; border-radius: 6px; padding: 5px 14px; cursor: pointer; font-size: 0.75rem;">
        Got it
      </button>
    `;
    document.body.appendChild(toast);
    setTimeout(() => { try { toast.remove(); } catch(e) {} }, 8000);
  }

  async function sendSilentBackgroundAlert(links) {
    // 1. CallMeBot WhatsApp API (Direct automated background WhatsApp to phone)
    if (currentSettings.callMeBotApiKey && links.waDigits) {
      try {
        const url = `https://api.callmebot.com/whatsapp.php?phone=${links.waDigits}&text=${encodeURIComponent(links.rawMessage)}&apikey=${encodeURIComponent(currentSettings.callMeBotApiKey.trim())}`;
        fetch(url, { mode: 'no-cors' })
          .then(() => console.log('[Silent Dispatch] WhatsApp dispatched via CallMeBot API'))
          .catch(err => console.warn('[Silent Dispatch] Fetch notice:', err));
        try {
          const imgPing = new Image();
          imgPing.src = url;
        } catch (imgErr) {}
      } catch (e) {
        console.warn('[CallMeBot notice]:', e);
      }
    }

    // 2. Custom Webhook (n8n, Zapier, Telegram, custom backend)
    if (currentSettings.webhookUrl) {
      try {
        fetch(currentSettings.webhookUrl.trim(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event: 'checkpoint_reached',
            triggerStop: currentSettings.triggerStop.name,
            finalStop: currentSettings.finalStop.name,
            contactName: links.contactName,
            phone: links.phone,
            message: links.rawMessage,
            speedKmh: currentBusSpeedKmh,
            timestamp: new Date().toISOString()
          })
        }).catch(err => console.warn('[Webhook notice]:', err));
      } catch (e) {
        console.warn('[Webhook notice]:', e);
      }
    }
  }

  function showArrivalNotification(triggerName, contactName, finalName) {
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        const title = `🚨 Crossed ${triggerName}!`;
        const options = {
          body: `Alerting ${contactName} for pickup at ${finalName}!`,
          icon: 'icons/icon.svg',
          badge: 'icons/icon.svg',
          vibrate: [800, 300, 800, 300, 1200],
          tag: 'busawake-arrival',
          renotify: true
        };
        if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
          navigator.serviceWorker.ready.then(reg => reg.showNotification(title, options));
        } else {
          new Notification(title, options);
        }
      } catch (e) {
        console.warn('[Notification notice]:', e);
      }
    }
  }

  // -----------------------------------------------------------------
  // ALERT LINKS & CONTACT ACTIONS
  // -----------------------------------------------------------------
  function getDynamicFormattedMessage(triggerData = null) {
    const template = currentSettings.customMessageTemplate;
    const trigger = currentSettings.triggerStop.name || 'Ambattur OT Bus Stand';
    const final = currentSettings.finalStop.name || 'Canara Bus Stand';
    const contact = window.StorageManager.getActiveContact();

    const lat = (triggerData && triggerData.latitude) || (userLiveCoords && userLiveCoords.lat) || currentSettings.triggerStop.lat;
    const lng = (triggerData && triggerData.longitude) || (userLiveCoords && userLiveCoords.lng) || currentSettings.triggerStop.lng;
    const liveLink = `https://maps.google.com/?q=${lat.toFixed(5)},${lng.toFixed(5)}`;

    const speed = (triggerData && triggerData.speedKmh !== undefined) ? triggerData.speedKmh : (currentBusSpeedKmh || 32);
    const eta = (triggerData && triggerData.etaMinutes !== undefined) ? triggerData.etaMinutes : (currentEtaMins || 5);

    let msg = template
      .replace(/{contact_name}/g, contact.name || 'Dad')
      .replace(/{trigger_stop}/g, trigger)
      .replace(/{final_stop}/g, final)
      .replace(/{speed}/g, speed)
      .replace(/{eta}/g, eta)
      .replace(/{live_location_link}/g, liveLink);

    if (currentSettings.sendLiveLocationLink !== false && !msg.includes('maps.google.com')) {
      msg += `\n📍 Live Location: ${liveLink}`;
    }

    return msg;
  }

  function updateMessagePreview() {
    if (els.msgLivePreview) {
      els.msgLivePreview.textContent = `"${getDynamicFormattedMessage()}"`;
    }
  }

  function generateActiveContactLinks(triggerData = null) {
    const contact = window.StorageManager.getActiveContact();
    const phoneInfo = window.StorageManager.formatPhone(contact.phone);
    const rawMessage = getDynamicFormattedMessage(triggerData);
    const msg = encodeURIComponent(rawMessage);

    const telLink = phoneInfo.tel ? `tel:${phoneInfo.tel}` : 'tel:';
    // WhatsApp universal deep-link format
    const waLink = phoneInfo.whatsapp ? `https://api.whatsapp.com/send?phone=${phoneInfo.whatsapp}&text=${msg}` : '#';
    const smsLink = phoneInfo.tel ? `sms:${phoneInfo.tel}?body=${msg}` : 'sms:';

    return {
      telLink,
      waLink,
      smsLink,
      phone: phoneInfo.tel,
      waDigits: phoneInfo.whatsapp,
      displayPhone: phoneInfo.display,
      isValid: phoneInfo.isValid,
      contactName: contact.name,
      rawMessage
    };
  }

  function updateAlarmOverlayActions(triggerData = null) {
    const links = generateActiveContactLinks(triggerData);
    els.alarmCallBtn.href = links.telLink;
    els.alarmWhatsAppBtn.href = links.waLink;
    els.alarmSmsBtn.href = links.smsLink;

    if (!links.isValid) {
      els.alarmCallBtnText.textContent = `📞 SET ${links.contactName.toUpperCase()} NUMBER IN CONTACTS`;
      els.alarmWhatsAppBtn.style.opacity = '0.5';
    } else {
      els.alarmCallBtnText.textContent = `📞 CALL ${links.contactName.toUpperCase()} (${links.phone})`;
      els.alarmWhatsAppBtn.style.opacity = '1';
    }
  }

  // -----------------------------------------------------------------
  // ROUTE & CONTACT PRESETS MANAGEMENT
  // -----------------------------------------------------------------
  function renderRouteChips() {
    savedRoutes = window.StorageManager.getSavedRoutes();
    if (!els.routeChipsContainer) return;
    els.routeChipsContainer.innerHTML = '';

    savedRoutes.forEach(route => {
      const isCurrent = (
        currentSettings.triggerStop?.name.toLowerCase() === route.triggerStop?.name.toLowerCase() &&
        currentSettings.finalStop?.name.toLowerCase() === route.finalStop?.name.toLowerCase()
      );

      const chip = document.createElement('button');
      chip.className = `chip-item ${isCurrent ? 'active' : ''}`;
      chip.innerHTML = `📍 ${route.name}`;
      chip.addEventListener('click', () => {
        applyRoutePreset(route);
      });
      els.routeChipsContainer.appendChild(chip);
    });
  }

  function applyRoutePreset(route) {
    currentSettings.triggerStop = { ...route.triggerStop };
    currentSettings.finalStop = { ...route.finalStop };
    currentSettings.triggerRadius = route.triggerRadius || 400;
    currentSettings.activeRouteId = route.id;

    window.StorageManager.saveSettings(currentSettings);
    loadSettingsIntoUI();
    renderRouteChips();
    refreshMapVisualPins();
    updateMessagePreview();
  }

  function renderSavedRoutesList() {
    savedRoutes = window.StorageManager.getSavedRoutes();
    if (!els.savedRoutesList) return;
    if (!savedRoutes || savedRoutes.length === 0) {
      els.savedRoutesList.innerHTML = '<div style="font-size: 0.8rem; color: var(--text-muted); text-align: center; padding: 8px;">No presets saved.</div>';
      return;
    }

    els.savedRoutesList.innerHTML = savedRoutes.map(route => `
      <div class="saved-item-row">
        <div class="saved-item-info">
          <div class="saved-item-title">${route.name}</div>
          <div class="saved-item-sub">🚩 ${route.triggerStop.name} ➔ 🏁 ${route.finalStop.name}</div>
        </div>
        <div style="display: flex; gap: 6px;">
          <button class="btn btn-sm btn-outline btn-use-route" data-id="${route.id}">Use</button>
          <button class="btn btn-sm btn-outline btn-del-route" data-id="${route.id}" style="color: #f87171;">✕</button>
        </div>
      </div>
    `).join('');

    els.savedRoutesList.querySelectorAll('.btn-use-route').forEach(b => {
      b.addEventListener('click', () => {
        const id = b.getAttribute('data-id');
        const found = savedRoutes.find(r => r.id === id);
        if (found) {
          applyRoutePreset(found);
          alert(`✓ Loaded preset "${found.name}"!`);
        }
      });
    });

    els.savedRoutesList.querySelectorAll('.btn-del-route').forEach(b => {
      b.addEventListener('click', () => {
        const id = b.getAttribute('data-id');
        if (confirm('Delete this saved route preset?')) {
          savedRoutes = window.StorageManager.deleteRoute(id);
          renderSavedRoutesList();
          renderRouteChips();
        }
      });
    });
  }

  function populateContactDropdown() {
    savedContacts = window.StorageManager.getSavedContacts();
    const activeContact = window.StorageManager.getActiveContact();
    if (!els.selectActiveContact) return;

    els.selectActiveContact.innerHTML = savedContacts.map(c => `
      <option value="${c.id}" ${c.id === activeContact.id ? 'selected' : ''}>
        👤 ${c.name} ${c.phone ? `(${c.phone})` : '(No number set)'}
      </option>
    `).join('');
  }

  function renderContactChips() {
    savedContacts = window.StorageManager.getSavedContacts();
    const activeContact = window.StorageManager.getActiveContact();
    if (!els.contactChipsContainer) return;
    els.contactChipsContainer.innerHTML = '';

    savedContacts.forEach(contact => {
      const isCurrent = (contact.id === activeContact.id);
      const chip = document.createElement('button');
      chip.className = `chip-item ${isCurrent ? 'contact-active' : ''}`;
      chip.innerHTML = `👤 ${contact.name} ${contact.phone ? '✓' : '(Set Phone)'}`;
      chip.addEventListener('click', () => {
        setActiveContact(contact.id);
      });
      els.contactChipsContainer.appendChild(chip);
    });
  }

  function setActiveContact(contactId) {
    currentSettings.activeContactId = contactId;
    window.StorageManager.saveSettings(currentSettings);
    loadSettingsIntoUI();
    renderContactChips();
    updateMessagePreview();
  }

  function renderSavedContactsList() {
    savedContacts = window.StorageManager.getSavedContacts();
    if (!els.savedContactsList) return;
    if (!savedContacts || savedContacts.length === 0) {
      els.savedContactsList.innerHTML = '<div style="font-size: 0.8rem; color: var(--text-muted); text-align: center;">No contacts saved.</div>';
      return;
    }

    els.savedContactsList.innerHTML = savedContacts.map(c => `
      <div class="saved-item-row">
        <div class="saved-item-info">
          <div class="saved-item-title">${c.name}</div>
          <div class="saved-item-sub">${c.phone || '⚠️ No number set yet'}</div>
        </div>
        <div style="display: flex; gap: 6px;">
          <button class="btn btn-sm btn-outline btn-select-contact" data-id="${c.id}">Select</button>
          ${c.id !== 'contact-dad' && c.id !== 'contact-mom' ? `<button class="btn btn-sm btn-outline btn-del-contact" data-id="${c.id}" style="color: #f87171;">✕</button>` : ''}
        </div>
      </div>
    `).join('');

    els.savedContactsList.querySelectorAll('.btn-select-contact').forEach(b => {
      b.addEventListener('click', () => {
        const id = b.getAttribute('data-id');
        setActiveContact(id);
      });
    });

    els.savedContactsList.querySelectorAll('.btn-del-contact').forEach(b => {
      b.addEventListener('click', () => {
        const id = b.getAttribute('data-id');
        if (confirm('Delete this contact?')) {
          savedContacts = window.StorageManager.deleteContact(id);
          if (currentSettings.activeContactId === id) {
            currentSettings.activeContactId = savedContacts[0]?.id || 'contact-dad';
            window.StorageManager.saveSettings(currentSettings);
          }
          loadSettingsIntoUI();
          renderContactChips();
          renderSavedContactsList();
        }
      });
    });
  }

  // -----------------------------------------------------------------
  // NAVIGATION & TABS
  // -----------------------------------------------------------------
  function setupNavigation() {
    const navButtons = document.querySelectorAll('.nav-item');
    navButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const targetTabId = btn.getAttribute('data-tab');
        window.switchTab(targetTabId);
      });
    });
  }

  // -----------------------------------------------------------------
  // WAKELOCK & VISIBILITY
  // -----------------------------------------------------------------
  async function requestWakeLock() {
    if ('wakeLock' in navigator && currentSettings.wakeLockEnabled) {
      try {
        wakeLock = await navigator.wakeLock.request('screen');
        console.log('[WakeLock] Active');
      } catch (err) {
        console.warn('[WakeLock] Request notice:', err);
      }
    }
  }

  function releaseWakeLock() {
    if (wakeLock) {
      wakeLock.release().then(() => { wakeLock = null; });
    }
  }

  function setupVisibilityWatch() {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        els.visibilityWarning.style.display = 'none';
        if (currentState === STATES.TRACKING) requestWakeLock();
      } else {
        if (currentState === STATES.TRACKING) {
          els.visibilityWarning.style.display = 'flex';
        }
      }
    });
  }

  function startClock() {
    const updateTime = () => {
      const now = new Date();
      els.sleepClock.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };
    updateTime();
    setInterval(updateTime, 1000);
  }

  function renderHistory() {
    const history = window.StorageManager.getTripHistory();
    if (!history || history.length === 0) {
      els.historyList.innerHTML = '<div style="font-size: 0.8rem; color: var(--text-muted); text-align: center; padding: 10px;">No trips logged yet.</div>';
      return;
    }

    els.historyList.innerHTML = history.map(item => `
      <div class="saved-item-row">
        <div>
          <div class="saved-item-title">${item.type || 'Trigger Crossed'}</div>
          <div style="font-size: 0.72rem; color: #94a3b8;">${item.triggerStop || 'Ambattur OT'} ➔ ${item.finalStop || 'Canara Stand'} (${item.contact || 'Dad'})</div>
        </div>
        <div style="text-align: right;">
          <div style="color: #6366f1; font-weight: 700; font-size: 0.76rem;">${item.time || ''}</div>
          <div style="font-size: 0.68rem; color: #64748b;">${item.date || ''}</div>
        </div>
      </div>
    `).join('');
  }

  // -----------------------------------------------------------------
  // EVENT LISTENERS
  // -----------------------------------------------------------------
  function setupEventListeners() {
    function on(el, evt, handler) {
      if (el) el.addEventListener(evt, handler);
    }

    // Start Bus Trip & Sleep Mode
    on(els.btnStartTrip, 'click', () => {
      window.alarmEngine.unlockAudio(); // Unlock Web Audio and Speech API on user gesture
      requestWakeLock();
      window.geoTracker.startTracking(
        currentSettings.triggerStop,
        currentSettings.finalStop,
        currentSettings.triggerRadius
      );
      setAppState(STATES.TRACKING);
      if (els.sleepOverlay) els.sleepOverlay.classList.add('active');
      startCockpitMode();

      // Native Android Background Journey
      if (window.AndroidBridge && typeof window.AndroidBridge.startNativeJourney === 'function') {
        const contact = window.StorageManager.getActiveContact();
        window.AndroidBridge.startNativeJourney(
          currentSettings.triggerStop.lat,
          currentSettings.triggerStop.lng,
          parseFloat(currentSettings.triggerRadius) || 400.0,
          contact.name || 'Dad',
          contact.phone || '9444883897',
          currentSettings.triggerStop.name || 'Ambattur OT Bus Stand'
        );
      }
    });

    on(els.btnEnterSleep, 'click', () => {
      if (els.sleepOverlay) els.sleepOverlay.classList.add('active');
    });

    on(els.btnExitSleep, 'click', () => {
      if (els.sleepOverlay) els.sleepOverlay.classList.remove('active');
    });

    on(els.btnStopTrip, 'click', () => {
      if (confirm('Stop active bus trip tracking?')) {
        cancelAutoActionCountdown();
        window.geoTracker.stopTracking();
        window.alarmEngine.stop();
        stopCockpitMode();
        setAppState(STATES.IDLE);

        if (window.AndroidBridge && typeof window.AndroidBridge.stopNativeJourney === 'function') {
          window.AndroidBridge.stopNativeJourney();
        }
      }
    });

    // 1-Tap Quick Test Buttons on Main Tracker Card
    on(els.btnQuickTestCall, 'click', () => {
      window.alarmEngine.unlockAudio();
      const links = generateActiveContactLinks();
      if (!links.isValid) {
        alert(`⚠️ Please set a valid 10-digit mobile number for ${links.contactName} in the Contacts tab!`);
        window.switchTab('tabContacts');
        return;
      }
      console.log('[Test Call] Opening dialer for:', links.phone);
      if (window.AndroidBridge && typeof window.AndroidBridge.openDialer === 'function') {
        window.AndroidBridge.openDialer(links.phone);
      } else {
        window.location.href = links.telLink;
      }
    });

    // 1-Tap Alarm Call Button in Alarm Screen
    on(els.alarmCallBtn, 'click', (e) => {
      if (window.AndroidBridge && typeof window.AndroidBridge.openDialer === 'function') {
        e.preventDefault();
        const links = generateActiveContactLinks(currentActiveTriggerData);
        if (links.isValid) {
          window.AndroidBridge.openDialer(links.phone);
        }
      }
    });

    on(els.btnQuickTestWa, 'click', () => {
      window.alarmEngine.unlockAudio();
      const links = generateActiveContactLinks();
      if (!links.isValid) {
        alert(`⚠️ Please set a valid 10-digit mobile number for ${links.contactName} in the Contacts tab!`);
        window.switchTab('tabContacts');
        return;
      }
      sendSilentBackgroundAlert(links);
      console.log('[Test WhatsApp] Opening:', links.waLink);
      window.open(links.waLink, '_blank');
    });

    // Pre-Trip Alarm Audio & Volume Test
    const btnPreTripAudioTest = document.getElementById('btnPreTripAudioTest');
    const volumeStatusNote = document.getElementById('volumeStatusNote');
    const btnQuickTestAudio = document.getElementById('btnQuickTestAudio');
    const quickTestVolumeNote = document.getElementById('quickTestVolumeNote');

    function executeAudioTest(btn, noteEl) {
      window.alarmEngine.unlockAudio();
      let msg = '🔊 Playing 3-second test tone...';

      if (window.AndroidBridge && typeof window.AndroidBridge.getAlarmVolumeInfo === 'function') {
        try {
          const info = JSON.parse(window.AndroidBridge.getAlarmVolumeInfo());
          if (info.isMuted) {
            msg = '⚠️ Alarm stream is MUTED (0%). Please increase device alarm volume in Sound Settings!';
          } else if (info.isTotalSilence) {
            msg = '⚠️ Device in Total Silence DND mode. Audio may be suppressed!';
          } else {
            msg = `🔊 Alarm stream volume: ${info.percentage}% (${info.currentVolume}/${info.maxVolume}). Playing 3s test...`;
          }
        } catch (e) {
          console.error(e);
        }
      }

      if (noteEl) {
        noteEl.style.display = 'block';
        noteEl.textContent = msg;
        if (msg.startsWith('⚠️')) noteEl.style.color = '#f59e0b';
        else noteEl.style.color = '#38bdf8';
      }

      if (btn) btn.disabled = true;

      window.onAlarmTestCompleted = () => {
        if (btn) btn.disabled = false;
        if (noteEl) noteEl.textContent = '✅ Pre-trip audio test completed.';
      };

      if (window.AndroidBridge && typeof window.AndroidBridge.testAlarmPlayback === 'function') {
        window.AndroidBridge.testAlarmPlayback(3000);
      } else {
        window.alarmEngine.start(true, currentSettings.audioAlarmSound || 'bus_bell');
        setTimeout(() => {
          window.alarmEngine.stop();
          if (window.onAlarmTestCompleted) window.onAlarmTestCompleted();
        }, 3000);
      }
    }

    if (btnPreTripAudioTest) {
      on(btnPreTripAudioTest, 'click', () => executeAudioTest(btnPreTripAudioTest, volumeStatusNote));
    }
    if (btnQuickTestAudio) {
      on(btnQuickTestAudio, 'click', () => executeAudioTest(btnQuickTestAudio, quickTestVolumeNote));
    }

    // Dismiss Alarm Button
    on(els.btnDismissAlarm, 'click', () => {
      cancelAutoActionCountdown();
      window.alarmEngine.stop();
      if (els.alarmOverlay) els.alarmOverlay.classList.remove('active');
      window.geoTracker.stopTracking();
      stopCockpitMode();
      setAppState(STATES.ENDED);

      if (window.AndroidBridge && typeof window.AndroidBridge.dismissNativeAlarm === 'function') {
        window.AndroidBridge.dismissNativeAlarm();
      }
    });

    // Auto-Action Countdown Controls in Alarm Overlay
    on(els.btnExecuteAutoNow, 'click', () => {
      if (autoActionTimer) clearInterval(autoActionTimer);
      autoActionTimer = null;
      executeAutoAction(currentActiveTriggerData);
    });

    on(els.btnCancelAutoAction, 'click', () => {
      cancelAutoActionCountdown();
    });

    // Map Edit Mode Selection
    on(els.btnSelectTriggerMode, 'click', () => {
      activeEditMode = 'trigger';
      updateActiveEditModeUI();
    });

    on(els.btnSelectFinalMode, 'click', () => {
      activeEditMode = 'final';
      updateActiveEditModeUI();
    });

    // Stop Name input change
    on(els.inputStopName, 'input', (e) => {
      const val = e.target.value.trim();
      if (activeEditMode === 'trigger') {
        currentSettings.triggerStop.name = val || 'Trigger Stop';
      } else {
        currentSettings.finalStop.name = val || 'Final Stop';
      }
    });

    // Center on Me Button
    on(els.btnLocateMe, 'click', () => {
      if (userLiveCoords && mapUnified) {
        mapUnified.flyTo([userLiveCoords.lat, userLiveCoords.lng], 16);
      } else {
        acquireInitialLocation();
      }
    });

    // Use Current GPS Button
    on(els.btnUseGpsCurrent, 'click', () => {
      if (!userLiveCoords) {
        acquireInitialLocation();
        return alert('Acquiring your live location, please tap again in a second.');
      }

      if (activeEditMode === 'trigger') {
        currentSettings.triggerStop.lat = userLiveCoords.lat;
        currentSettings.triggerStop.lng = userLiveCoords.lng;
        if (markerTrigger) markerTrigger.setLatLng([userLiveCoords.lat, userLiveCoords.lng]);
        updateGeofenceCircle();
        alert(`✓ Pinned current location to Trigger Checkpoint (${currentSettings.triggerStop.name})`);
      } else {
        currentSettings.finalStop.lat = userLiveCoords.lat;
        currentSettings.finalStop.lng = userLiveCoords.lng;
        if (markerFinal) markerFinal.setLatLng([userLiveCoords.lat, userLiveCoords.lng]);
        alert(`✓ Pinned current location to Final Drop Stop (${currentSettings.finalStop.name})`);
      }

      updateRouteLine();
      if (mapUnified) mapUnified.setView([userLiveCoords.lat, userLiveCoords.lng], 15);
    });

    // Slider radius
    on(els.sliderTriggerRadius, 'input', (e) => {
      const val = parseInt(e.target.value);
      if (els.badgeTriggerRadius) els.badgeTriggerRadius.textContent = val + ' m';
      currentSettings.triggerRadius = val;
      updateGeofenceCircle();
    });

    // Confirm and Save Both Stops
    on(els.btnConfirmBothStops, 'click', () => {
      const triggerName = (activeEditMode === 'trigger' && els.inputStopName ? els.inputStopName.value.trim() : null) || currentSettings.triggerStop.name;
      const finalName = (activeEditMode === 'final' && els.inputStopName ? els.inputStopName.value.trim() : null) || currentSettings.finalStop.name;

      currentSettings.triggerStop.name = triggerName;
      currentSettings.finalStop.name = finalName;
      if (els.sliderTriggerRadius) currentSettings.triggerRadius = parseInt(els.sliderTriggerRadius.value) || 400;

      window.StorageManager.saveSettings(currentSettings);
      loadSettingsIntoUI();
      renderRouteChips();
      refreshMapVisualPins();
      updateMessagePreview();

      // Switch back to Tracker tab
      window.switchTab('tabTracker');
      alert(`✅ Confirmed!\n🚩 Alert: ${triggerName}\n🏁 Drop: ${finalName}\nReady for your bus ride!`);
    });

    // Save as New Route Preset
    on(els.btnSaveAsNewRoute, 'click', () => {
      const defaultName = `${currentSettings.triggerStop.name} ➔ ${currentSettings.finalStop.name}`;
      const presetName = prompt('Enter a name for this route preset:', defaultName);
      if (!presetName) return;

      window.StorageManager.addOrUpdateRoute({
        name: presetName,
        triggerStop: { ...currentSettings.triggerStop },
        finalStop: { ...currentSettings.finalStop },
        triggerRadius: currentSettings.triggerRadius
      });

      renderRouteChips();
      renderSavedRoutesList();
      alert(`⭐ Route preset "${presetName}" saved!`);
    });

    // Map Tile Switchers
    on(els.btnTileGoogleRoads, 'click', () => setMapTileStyle('google_roadmap'));
    on(els.btnTileGoogleSatellite, 'click', () => setMapTileStyle('google_hybrid'));
    on(els.btnTileOsm, 'click', () => setMapTileStyle('osm'));

    // Contacts
    on(els.selectActiveContact, 'change', (e) => {
      setActiveContact(e.target.value);
    });

    // Real-time Phone Number Input Auto-formatting & Instant Auto-Save
    on(els.inputContactPhone, 'input', (e) => {
      const val = e.target.value;
      updatePhonePreview(val);
      const activeContact = window.StorageManager.getActiveContact();
      activeContact.phone = val.trim();
      window.StorageManager.addOrUpdateContact(activeContact);
      updateQuickTestDisplay();
      updateMessagePreview();
    });

    on(els.btnSaveActiveContactPhone, 'click', () => {
      const activeContact = window.StorageManager.getActiveContact();
      const phoneVal = els.inputContactPhone ? els.inputContactPhone.value.trim() : '';
      const phoneInfo = window.StorageManager.formatPhone(phoneVal);
      activeContact.phone = phoneInfo.raw;
      window.StorageManager.addOrUpdateContact(activeContact);
      renderContactChips();
      renderSavedContactsList();
      populateContactDropdown();
      updateQuickTestDisplay();
      updateMessagePreview();
      alert(`✓ Saved mobile number for ${activeContact.name} (${phoneInfo.display})!`);
    });

    // Auto-Action Options in Contacts Tab
    const autoActionOptions = document.querySelectorAll('.auto-action-option');
    autoActionOptions.forEach(opt => {
      opt.addEventListener('click', () => {
        const action = opt.getAttribute('data-action');
        currentSettings.autoActionOnReach = action;
        window.StorageManager.saveSettings(currentSettings);
        updateAutoActionUI();
      });
    });

    on(els.btnSaveAutoActionPref, 'click', () => {
      const selectedRadio = document.querySelector('input[name="autoActionRadio"]:checked');
      if (selectedRadio) {
        currentSettings.autoActionOnReach = selectedRadio.value;
      }
      if (els.selectAutoCountdown) {
        currentSettings.autoActionCountdownSec = parseInt(els.selectAutoCountdown.value);
      }
      window.StorageManager.saveSettings(currentSettings);
      updateAutoActionUI();
      alert('✓ Auto-action settings saved!');
    });

    on(els.btnAddContact, 'click', () => {
      const name = els.inputNewContactName ? els.inputNewContactName.value.trim() : '';
      const phone = els.inputNewContactPhone ? els.inputNewContactPhone.value.trim() : '';
      if (!name) return alert('Please enter contact name (e.g. Brother, Mom, Dad)');

      window.StorageManager.addOrUpdateContact({ name, phone });
      if (els.inputNewContactName) els.inputNewContactName.value = '';
      if (els.inputNewContactPhone) els.inputNewContactPhone.value = '';
      renderContactChips();
      renderSavedContactsList();
      populateContactDropdown();
      alert(`✓ Added ${name} to contacts!`);
    });

    // Message Editor
    on(els.btnInsertLiveGpsTag, 'click', () => {
      if (els.inputCustomMsg) {
        els.inputCustomMsg.value += '\n📍 Live Location: {live_location_link}';
        currentSettings.customMessageTemplate = els.inputCustomMsg.value;
      }
      updateMessagePreview();
    });

    on(els.btnInsertSpeedTag, 'click', () => {
      if (els.inputCustomMsg) {
        els.inputCustomMsg.value += ' (Speed: {speed} km/h)';
        currentSettings.customMessageTemplate = els.inputCustomMsg.value;
      }
      updateMessagePreview();
    });

    on(els.btnResetDefaultMsg, 'click', () => {
      const rec = '{contact_name}, I just crossed {trigger_stop}! Bus speed: {speed} km/h (ETA ~{eta} mins). Please start on the bike to pick me up at {final_stop}!\n📍 Live Location: {live_location_link}';
      if (els.inputCustomMsg) els.inputCustomMsg.value = rec;
      currentSettings.customMessageTemplate = rec;
      updateMessagePreview();
    });

    on(els.inputCustomMsg, 'input', () => {
      if (els.inputCustomMsg) currentSettings.customMessageTemplate = els.inputCustomMsg.value;
      updateMessagePreview();
    });

    on(els.btnSaveDadSettings, 'click', () => {
      currentSettings = window.StorageManager.saveSettings({
        customMessageTemplate: els.inputCustomMsg ? els.inputCustomMsg.value.trim() : '',
        sendLiveLocationLink: els.toggleSendLiveLocation ? els.toggleSendLiveLocation.checked : true
      });
      loadSettingsIntoUI();
      updateMessagePreview();
      alert('✓ Message template saved!');
    });

    // Test Contact Links
    on(els.btnTestCall, 'click', () => {
      window.alarmEngine.unlockAudio();
      const links = generateActiveContactLinks();
      if (!links.isValid) return alert(`Please save ${links.contactName}'s phone number first!`);
      window.location.href = links.telLink;
    });

    on(els.btnTestWhatsApp, 'click', () => {
      window.alarmEngine.unlockAudio();
      const links = generateActiveContactLinks();
      if (!links.isValid) return alert(`Please save ${links.contactName}'s phone number first!`);
      sendSilentBackgroundAlert(links);
      window.open(links.waLink, '_blank');
    });

    on(els.btnTestSms, 'click', () => {
      window.alarmEngine.unlockAudio();
      const links = generateActiveContactLinks();
      if (!links.isValid) return alert(`Please save ${links.contactName}'s phone number first!`);
      window.location.href = links.smsLink;
    });

    // Preferences in Settings Tab
    on(els.btnSaveConfig, 'click', () => {
      currentSettings = window.StorageManager.saveSettings({
        alertMode: els.toggleSoundAlarm && els.toggleSoundAlarm.checked ? 'vibrate_and_sound' : 'vibrate_only',
        audioAlarmSound: els.selectAlarmSound ? els.selectAlarmSound.value : 'bus_bell',
        ttsAnnounceEnabled: els.toggleVoiceSpeech ? els.toggleVoiceSpeech.checked : true,
        wakeLockEnabled: els.toggleWakeLock ? els.toggleWakeLock.checked : true
      });
      loadSettingsIntoUI();
      alert('✓ Preferences saved!');
    });

    on(els.btnTestSilentWhatsApp, 'click', () => {
      const apiKey = els.inputCallMeBotKey ? els.inputCallMeBotKey.value.trim() : (currentSettings.callMeBotApiKey || '');
      if (!apiKey) {
        alert('⚠️ Please enter your CallMeBot API Key first!\n\nFollow the 1-minute setup above: Send "I allow callmebot to send me messages" on WhatsApp to get your free key.');
        return;
      }
      currentSettings = window.StorageManager.saveSettings({ callMeBotApiKey: apiKey });
      const contact = currentSettings.emergencyContact;
      const phoneDigits = contact && contact.phone ? contact.phone.replace(/[^0-9]/g, '') : '919444883897';
      const targetName = contact && contact.name ? contact.name : 'Dad';
      const testMsg = `BusAwake Test: Silent background WhatsApp alert is successfully connected to ${targetName}! Automatic arrival alerts will be delivered directly here. 🚍🔔`;
      const url = `https://api.callmebot.com/whatsapp.php?phone=${phoneDigits}&text=${encodeURIComponent(testMsg)}&apikey=${encodeURIComponent(apiKey)}`;
      
      try {
        fetch(url, { mode: 'no-cors' });
        const img = new Image();
        img.src = url;
      } catch (e) {}

      alert(`✓ Test alert dispatched silently to ${targetName} (+${phoneDigits})!\n\nCheck WhatsApp on ${targetName}'s phone in a few seconds to confirm receipt.`);
    });

    on(els.btnSaveWebhookConfig, 'click', () => {
      currentSettings = window.StorageManager.saveSettings({
        callMeBotApiKey: els.inputCallMeBotKey ? els.inputCallMeBotKey.value.trim() : '',
        webhookUrl: els.inputWebhookUrl ? els.inputWebhookUrl.value.trim() : ''
      });
      alert('✓ Webhook configuration saved!');
    });

    on(els.btnSaveGoogleApiKey, 'click', () => {
      const key = els.inputGoogleApiKey ? els.inputGoogleApiKey.value.trim() : '';
      currentSettings.googleMapsApiKey = key;
      window.StorageManager.saveSettings(currentSettings);
      alert(key ? '✓ Google Maps API key saved!' : '✓ Switched to built-in smart places search.');
    });


    // Simulation & Vibrate Direct Test
    on(els.btnSimulateRide, 'click', () => {
      window.alarmEngine.unlockAudio();
      requestWakeLock();
      setAppState(STATES.TRACKING);
      window.geoTracker.startSimulation(
        currentSettings.triggerStop,
        currentSettings.finalStop,
        currentSettings.triggerRadius
      );
      if (els.sleepOverlay) els.sleepOverlay.classList.add('active');
      startCockpitMode();
    });

    on(els.btnDirectVibrateTest, 'click', () => {
      window.alarmEngine.unlockAudio();
      triggerCrossingAlert(200);
    });

    on(els.btnClearHistory, 'click', () => {
      if (confirm('Clear past trip logs?')) {
        window.StorageManager.clearHistory();
        renderHistory();
      }
    });

    // Notification Permission Request
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(e => console.warn('[Notification permission notice]:', e));
    }
  }

    // ------ COCKPIT BUTTON WIRING ------
    const btnStartCockpit = document.getElementById('btnStartCockpit');
    const btnStopCockpit = document.getElementById('btnStopCockpit');
    const cockpitStartPanel = document.getElementById('cockpitStartPanel');
    const cockpitDashboard = document.getElementById('cockpitDashboard');
    const cockpitStatusBadge = document.getElementById('cockpitStatusBadge');

    function startCockpitMode() {
      if (!window.cockpitEngine) return;
      window.cockpitEngine.start('cockpitChart');

      // UI toggles
      if (cockpitStartPanel) cockpitStartPanel.style.display = 'none';
      if (cockpitDashboard) cockpitDashboard.style.display = 'flex';
      if (cockpitStatusBadge) {
        cockpitStatusBadge.className = 'cockpit-status-badge cockpit-active';
        cockpitStatusBadge.innerHTML = '<span class="pulse-dot"></span> LIVE';
      }

      // Also start GPS tracking if not already active
      if (currentState === STATES.IDLE) {
        const triggerCoords = currentSettings.triggerStop.coords;
        const finalCoords = currentSettings.finalStop.coords;
        if (triggerCoords && finalCoords) {
          window.geoTracker.startTracking(
            triggerCoords, finalCoords,
            currentSettings.triggerRadius
          );
        }
      }
      console.log('[Cockpit] Started via button');
    }

    function stopCockpitMode() {
      if (!window.cockpitEngine) return;
      window.cockpitEngine.stop();

      if (cockpitStartPanel) cockpitStartPanel.style.display = '';
      if (cockpitDashboard) cockpitDashboard.style.display = 'none';
      if (cockpitStatusBadge) {
        cockpitStatusBadge.className = 'cockpit-status-badge cockpit-idle';
        cockpitStatusBadge.innerHTML = '<span class="pulse-dot"></span> IDLE';
      }
      console.log('[Cockpit] Stopped via button');
    }

    if (btnStartCockpit) {
      btnStartCockpit.addEventListener('click', startCockpitMode);
    }
    if (btnStopCockpit) {
      btnStopCockpit.addEventListener('click', stopCockpitMode);
    }

  initApp();
});
