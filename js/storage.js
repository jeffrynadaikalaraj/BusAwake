// Local Storage & Configuration Manager for BusAwake
const Storage = {
  KEYS: {
    SETTINGS: 'busawake_settings_v6',
    SENSITIVE_SESSION: 'busawake_secrets_v6',
    SAVED_ROUTES: 'busawake_routes_v6',
    SAVED_CONTACTS: 'busawake_contacts_v6',
    HISTORY: 'busawake_history_v6',
    LAST_TRIGGER: 'busawake_last_trigger_v6'
  },

  SENSITIVE_FIELDS: ['callMeBotApiKey', 'googleMapsApiKey', 'webhookUrl'],

  DEFAULT_CONTACTS: [
    {
      id: 'contact-dad',
      name: 'Dad',
      relation: 'Dad',
      phone: '9444883897'
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
    webhookUrl: '',
    callMeBotApiKey: '',
    sendLiveLocationLink: true,
    wakeLockEnabled: true,
    mapTileStyle: 'google_roadmap',
    googleMapsApiKey: ''
  },

  // Robust Phone Number Normalizer
  formatPhone(rawPhone) {
    if (!rawPhone || typeof rawPhone !== 'string') {
      return { raw: '', tel: '', whatsapp: '', display: '', isValid: false };
    }
    // Remove all whitespace, dashes, parentheses
    let cleaned = rawPhone.replace(/[\s\-\(\)]/g, '').trim();
    if (!cleaned) {
      return { raw: '', tel: '', whatsapp: '', display: '', isValid: false };
    }

    // If starts with 00, replace with +
    if (cleaned.startsWith('00')) {
      cleaned = '+' + cleaned.substring(2);
    }

    // If Indian local format: 0 followed by 10 digits (e.g. 09840123456)
    if (cleaned.startsWith('0') && cleaned.length === 11) {
      cleaned = '+91' + cleaned.substring(1);
    }

    // If 10 standard digits without country code (e.g. 9840123456)
    if (/^[6-9]\d{9}$/.test(cleaned)) {
      cleaned = '+91' + cleaned;
    }

    // Standardize tel format (must have + for international or pure digits)
    const tel = cleaned.startsWith('+') ? cleaned : '+' + cleaned;

    // Standardize WhatsApp digits: strictly digits without '+'
    const whatsapp = cleaned.replace(/\+/g, '');

    const isValid = whatsapp.length >= 10 && whatsapp.length <= 15;

    return {
      raw: rawPhone,
      tel,
      whatsapp,
      display: cleaned,
      isValid
    };
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

  getSensitiveSettings() {
    try {
      const raw = sessionStorage.getItem(this.KEYS.SENSITIVE_SESSION);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  },

  saveSensitiveSettings(obj) {
    try {
      const current = this.getSensitiveSettings();
      const updated = { ...current };
      this.SENSITIVE_FIELDS.forEach((field) => {
        if (Object.prototype.hasOwnProperty.call(obj, field)) {
          updated[field] = obj[field] || '';
        }
      });
      sessionStorage.setItem(this.KEYS.SENSITIVE_SESSION, JSON.stringify(updated));
      return updated;
    } catch (e) {
      console.warn('[Storage] Session secrets notice:', e);
      return {};
    }
  },

  getSettings() {
    try {
      this.migrateOldCoordinates();
      const data = localStorage.getItem(this.KEYS.SETTINGS);
      const parsed = data ? JSON.parse(data) : {};

      // Strip any legacy plaintext secrets from localStorage and move to sessionStorage
      let stripped = false;
      const migratedSecrets = {};
      this.SENSITIVE_FIELDS.forEach((field) => {
        if (parsed[field]) {
          migratedSecrets[field] = parsed[field];
          delete parsed[field];
          stripped = true;
        }
      });
      if (stripped) {
        this.saveSensitiveSettings(migratedSecrets);
        localStorage.setItem(this.KEYS.SETTINGS, JSON.stringify(parsed));
      }

      const secrets = this.getSensitiveSettings();
      return { ...this.DEFAULT_SETTINGS, ...parsed, ...secrets };
    } catch (e) {
      console.error('[Storage] Error reading settings:', e);
      return { ...this.DEFAULT_SETTINGS };
    }
  },

  saveSettings(newSettings) {
    try {
      const current = this.getSettings();
      const updated = { ...current, ...newSettings };

      // Keep API keys and webhook URLs out of persistent plaintext localStorage
      this.saveSensitiveSettings(updated);
      const persistable = { ...updated };
      this.SENSITIVE_FIELDS.forEach((field) => {
        delete persistable[field];
      });

      localStorage.setItem(this.KEYS.SETTINGS, JSON.stringify(persistable));
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
