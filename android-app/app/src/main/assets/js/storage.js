// Local Storage & Configuration Manager for BusAwake
const Storage = {
  KEYS: {
    SETTINGS: 'busawake_settings_v6',
    SAVED_ROUTES: 'busawake_routes_v6',
    SAVED_CONTACTS: 'busawake_contacts_v6',
    HISTORY: 'busawake_history_v6',
    LAST_TRIGGER: 'busawake_last_trigger_v6'
  },

  DEFAULT_CONTACTS: [
    {
      id: 'contact-dad',
      name: 'Dad',
      relation: 'Dad',
      phone: ''
    },
    {
      id: 'contact-mom',
      name: 'Mom',
      relation: 'Mom',
      phone: ''
    }
  ],

  DEFAULT_ROUTES: [
    {
      id: 'route-ambattur-1',
      name: 'Ambattur OT ➔ Canara Bus Stand',
      triggerStop: { name: 'Ambattur OT Bus Stand', lat: 13.1228, lng: 80.1484 },
      finalStop: { name: 'Canara Bus Stand', lat: 13.1205, lng: 80.1520 },
      triggerRadius: 400
    },
    {
      id: 'route-cmbt-1',
      name: 'Koyambedu CMBT ➔ Ambattur OT',
      triggerStop: { name: 'Padi Saravana Stores Bus Stop', lat: 13.1006, lng: 80.1837 },
      finalStop: { name: 'Ambattur OT Bus Stand', lat: 13.1228, lng: 80.1484 },
      triggerRadius: 450
    }
  ],

  DEFAULT_SETTINGS: {
    activeRouteId: 'route-ambattur-1',
    activeContactId: 'contact-dad',
    triggerStop: {
      name: 'Ambattur OT Bus Stand',
      lat: 13.1228,
      lng: 80.1484
    },
    finalStop: {
      name: 'Canara Bus Stand',
      lat: 13.1205,
      lng: 80.1520
    },
    triggerRadius: 400,
    customMessageTemplate: '{contact_name}, I just crossed {trigger_stop}! Bus speed: {speed} km/h (ETA ~{eta} mins). Please start on the bike to pick me up at {final_stop}!\n📍 Live Location: {live_location_link}',
    alertMode: 'vibrate_and_sound', // 'vibrate_and_sound' or 'vibrate_only'
    autoActionOnReach: 'auto_call', // 'auto_call', 'auto_whatsapp', 'auto_sms', 'auto_call_and_wa', 'prompt_only'
    autoActionCountdownSec: 3, // 0 for instant, 3 or 5 for cancelable countdown
    ttsAnnounceEnabled: true,
    audioAlarmSound: 'bus_bell', // 'bus_bell', 'siren', 'melodic'
    sendLiveLocationLink: true,
    wakeLockEnabled: true,
    mapTileStyle: 'google_roadmap'
  },

  // Centralized strict phone number validator (Indian 10-digit & E.164 international)
  validatePhoneNumber(rawPhone) {
    if (typeof rawPhone !== 'string') {
      return { raw: '', tel: '', whatsapp: '', display: '', isValid: false, error: 'Please enter a phone number.' };
    }

    const trimmed = rawPhone.trim();
    if (!trimmed) {
      return { raw: '', tel: '', whatsapp: '', display: '', isValid: false, error: 'Phone number cannot be empty.' };
    }

    // Reject HTML, scripts, letters, or unexpected characters before normalization
    if (!/^[+\d\s().-]+$/.test(trimmed)) {
      return {
        raw: '',
        tel: '',
        whatsapp: '',
        display: '',
        isValid: false,
        error: 'Invalid characters in phone number. Use digits and optional + country code only.'
      };
    }

    let cleaned = trimmed.replace(/[\s().-]/g, '');

    // Reject '+' anywhere other than the leading position
    if (cleaned.indexOf('+', 1) !== -1) {
      return { raw: '', tel: '', whatsapp: '', display: '', isValid: false, error: 'Invalid + placement in phone number.' };
    }

    // Convert international 00 prefix to +
    if (cleaned.startsWith('00')) {
      cleaned = '+' + cleaned.substring(2);
    }

    // Indian local format: 0 + 10-digit mobile (e.g. 09840123456)
    if (/^0[6-9]\d{9}$/.test(cleaned)) {
      cleaned = '+91' + cleaned.substring(1);
    } else if (/^[6-9]\d{9}$/.test(cleaned)) {
      // Standard 10-digit Indian mobile without country code
      cleaned = '+91' + cleaned;
    } else if (!cleaned.startsWith('+')) {
      // International number entered without '+' (must start with non-zero country code, 7-15 digits)
      cleaned = '+' + cleaned;
    }

    // Strict E.164 check: '+' followed by non-zero country code and 7 to 15 total digits
    if (!/^\+[1-9]\d{6,14}$/.test(cleaned)) {
      return {
        raw: '',
        tel: '',
        whatsapp: '',
        display: '',
        isValid: false,
        error: 'Enter a valid 10-digit Indian number or international E.164 number (e.g. +919876543210 or +14155552671).'
      };
    }

    const whatsapp = cleaned.substring(1);
    return {
      raw: trimmed,
      tel: cleaned,
      whatsapp,
      display: cleaned,
      isValid: true,
      error: ''
    };
  },

  // Backward-compatible wrapper around validatePhoneNumber
  formatPhone(rawPhone) {
    return this.validatePhoneNumber(rawPhone);
  },

  // Automatically migrate legacy/approximate coordinates in device localStorage to precise GPS coordinates
  migrateOldCoordinates() {
    try {
      // 1. Settings migration
      const data = localStorage.getItem(this.KEYS.SETTINGS);
      if (data) {
        let changed = false;
        const s = JSON.parse(data);
        if (s.triggerStop) {
          if (s.triggerStop.name && s.triggerStop.name.toLowerCase().includes('ot bus stand')) {
            if (Math.abs(s.triggerStop.lat - 13.1143) < 0.005) {
              s.triggerStop.lat = 13.1228;
              s.triggerStop.lng = 80.1484;
              changed = true;
            }
          }
          if (s.triggerStop.name && s.triggerStop.name.toLowerCase().includes('canara')) {
            if (Math.abs(s.triggerStop.lat - 13.1190) < 0.005) {
              s.triggerStop.lat = 13.1205;
              s.triggerStop.lng = 80.1520;
              changed = true;
            }
          }
        }
        if (s.finalStop) {
          if (s.finalStop.name && s.finalStop.name.toLowerCase().includes('ot bus stand')) {
            if (Math.abs(s.finalStop.lat - 13.1143) < 0.005) {
              s.finalStop.lat = 13.1228;
              s.finalStop.lng = 80.1484;
              changed = true;
            }
          }
          if (s.finalStop.name && s.finalStop.name.toLowerCase().includes('canara')) {
            if (Math.abs(s.finalStop.lat - 13.1190) < 0.005) {
              s.finalStop.lat = 13.1205;
              s.finalStop.lng = 80.1520;
              changed = true;
            }
          }
        }
        if (changed) {
          localStorage.setItem(this.KEYS.SETTINGS, JSON.stringify(s));
          console.log('[Storage] Seamlessly migrated settings to exact Ambattur OT Bus Stand coordinates (13.1228, 80.1484)');
        }
      }

      // 2. Saved routes migration
      const routesData = localStorage.getItem(this.KEYS.SAVED_ROUTES);
      if (routesData) {
        let routesChanged = false;
        const routes = JSON.parse(routesData);
        if (Array.isArray(routes)) {
          routes.forEach(r => {
            if (r.triggerStop && r.triggerStop.name && r.triggerStop.name.toLowerCase().includes('ot bus stand')) {
              if (Math.abs(r.triggerStop.lat - 13.1143) < 0.005) {
                r.triggerStop.lat = 13.1228;
                r.triggerStop.lng = 80.1484;
                routesChanged = true;
              }
            }
            if (r.finalStop && r.finalStop.name && r.finalStop.name.toLowerCase().includes('ot bus stand')) {
              if (Math.abs(r.finalStop.lat - 13.1143) < 0.005) {
                r.finalStop.lat = 13.1228;
                r.finalStop.lng = 80.1484;
                routesChanged = true;
              }
            }
            if (r.triggerStop && r.triggerStop.name && r.triggerStop.name.toLowerCase().includes('canara')) {
              if (Math.abs(r.triggerStop.lat - 13.1190) < 0.005) {
                r.triggerStop.lat = 13.1205;
                r.triggerStop.lng = 80.1520;
                routesChanged = true;
              }
            }
            if (r.finalStop && r.finalStop.name && r.finalStop.name.toLowerCase().includes('canara')) {
              if (Math.abs(r.finalStop.lat - 13.1190) < 0.005) {
                r.finalStop.lat = 13.1205;
                r.finalStop.lng = 80.1520;
                routesChanged = true;
              }
            }
          });
          if (routesChanged) {
            localStorage.setItem(this.KEYS.SAVED_ROUTES, JSON.stringify(routes));
            console.log('[Storage] Seamlessly migrated saved routes to exact Ambattur OT Bus Stand coordinates');
          }
        }
      }
    } catch (e) {
      console.warn('[Storage] Migration notice:', e);
    }
  },

  getSettings() {
    try {
      this.migrateOldCoordinates();
      // Remove any legacy API key storage from sessionStorage or localStorage
      try {
        sessionStorage.removeItem('busawake_secrets_v6');
      } catch (e) {}

      const data = localStorage.getItem(this.KEYS.SETTINGS);
      const parsed = data ? JSON.parse(data) : {};

      if (Object.prototype.hasOwnProperty.call(parsed, 'googleMapsApiKey') ||
          Object.prototype.hasOwnProperty.call(parsed, 'callMeBotApiKey') ||
          Object.prototype.hasOwnProperty.call(parsed, 'webhookUrl')) {
        delete parsed.googleMapsApiKey;
        delete parsed.callMeBotApiKey;
        delete parsed.webhookUrl;
        localStorage.setItem(this.KEYS.SETTINGS, JSON.stringify(parsed));
      }

      return { ...this.DEFAULT_SETTINGS, ...parsed };
    } catch (e) {
      console.error('[Storage] Error reading settings:', e);
      return { ...this.DEFAULT_SETTINGS };
    }
  },

  saveSettings(newSettings) {
    try {
      const current = this.getSettings();
      const updated = { ...current, ...newSettings };
      delete updated.googleMapsApiKey;
      delete updated.callMeBotApiKey;
      delete updated.webhookUrl;

      localStorage.setItem(this.KEYS.SETTINGS, JSON.stringify(updated));
      return updated;
    } catch (e) {
      console.error('[Storage] Error saving settings:', e);
      return null;
    }
  },

  // Contact Management
  getSavedContacts() {
    try {
      const data = localStorage.getItem(this.KEYS.SAVED_CONTACTS);
      if (!data) {
        this.saveContactsList(this.DEFAULT_CONTACTS);
        return this.DEFAULT_CONTACTS;
      }
      const parsed = JSON.parse(data);
      return (Array.isArray(parsed) && parsed.length > 0) ? parsed : this.DEFAULT_CONTACTS;
    } catch (e) {
      return this.DEFAULT_CONTACTS;
    }
  },

  saveContactsList(contacts) {
    try {
      localStorage.setItem(this.KEYS.SAVED_CONTACTS, JSON.stringify(contacts));
    } catch (e) {
      console.error('[Storage] Error saving contacts list:', e);
    }
  },

  getActiveContact() {
    const settings = this.getSettings();
    const contacts = this.getSavedContacts();
    const found = contacts.find(c => c.id === settings.activeContactId);
    return found || contacts[0] || { id: 'contact-dad', name: 'Dad', relation: 'Dad', phone: '' };
  },

  addOrUpdateContact(contact) {
    const contacts = this.getSavedContacts();
    const existingIndex = contacts.findIndex(c => c.id === contact.id);
    if (existingIndex >= 0) {
      contacts[existingIndex] = { ...contacts[existingIndex], ...contact };
    } else {
      contacts.push({
        id: 'contact-' + Date.now(),
        ...contact
      });
    }
    this.saveContactsList(contacts);
    return contacts;
  },

  deleteContact(contactId) {
    let contacts = this.getSavedContacts().filter(c => c.id !== contactId);
    if (contacts.length === 0) {
      contacts = [...this.DEFAULT_CONTACTS];
    }
    this.saveContactsList(contacts);
    return contacts;
  },

  // Routes Presets Management
  getSavedRoutes() {
    try {
      this.migrateOldCoordinates();
      const data = localStorage.getItem(this.KEYS.SAVED_ROUTES);
      if (!data) {
        this.saveRoutesList(this.DEFAULT_ROUTES);
        return this.DEFAULT_ROUTES;
      }
      const parsed = JSON.parse(data);
      return (Array.isArray(parsed) && parsed.length > 0) ? parsed : this.DEFAULT_ROUTES;
    } catch (e) {
      return this.DEFAULT_ROUTES;
    }
  },

  saveRoutesList(routes) {
    try {
      localStorage.setItem(this.KEYS.SAVED_ROUTES, JSON.stringify(routes));
    } catch (e) {
      console.error('[Storage] Error saving routes list:', e);
    }
  },

  addOrUpdateRoute(route) {
    const routes = this.getSavedRoutes();
    const existingIndex = routes.findIndex(r => r.id === route.id || (r.name && route.name && r.name.toLowerCase() === route.name.toLowerCase()));
    if (existingIndex >= 0) {
      routes[existingIndex] = { ...routes[existingIndex], ...route };
    } else {
      routes.push({
        id: 'route-' + Date.now(),
        ...route
      });
    }
    this.saveRoutesList(routes);
    return routes;
  },

  deleteRoute(routeId) {
    let routes = this.getSavedRoutes().filter(r => r.id !== routeId);
    if (routes.length === 0) {
      routes = [...this.DEFAULT_ROUTES];
    }
    this.saveRoutesList(routes);
    return routes;
  },

  setLastTrigger(info) {
    try {
      const payload = {
        timestamp: new Date().toISOString(),
        formattedTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        ...info
      };
      localStorage.setItem(this.KEYS.LAST_TRIGGER, JSON.stringify(payload));
      this.addTripHistory(payload);
      return payload;
    } catch (e) {
      console.error('[Storage] Error recording trigger:', e);
    }
  },

  addTripHistory(record) {
    try {
      const history = this.getTripHistory();
      history.unshift({
        id: Date.now(),
        date: new Date().toLocaleDateString(),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        ...record
      });
      const trimmed = history.slice(0, 30);
      localStorage.setItem(this.KEYS.HISTORY, JSON.stringify(trimmed));
      return trimmed;
    } catch (e) {
      console.error('[Storage] Error adding history:', e);
      return [];
    }
  },

  getTripHistory() {
    try {
      const data = localStorage.getItem(this.KEYS.HISTORY);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  },

  clearHistory() {
    try {
      localStorage.removeItem(this.KEYS.HISTORY);
      localStorage.removeItem(this.KEYS.LAST_TRIGGER);
    } catch (e) {
      console.error('[Storage] Error clearing history:', e);
    }
  }
};

window.StorageManager = Storage;
