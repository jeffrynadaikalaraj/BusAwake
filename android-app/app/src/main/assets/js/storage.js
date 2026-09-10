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
      triggerStop: { name: 'Ambattur OT Bus Stand', lat: 13.1143, lng: 80.1548 },
      finalStop: { name: 'Canara Bus Stand', lat: 13.1190, lng: 80.1620 },
      triggerRadius: 400
    },
    {
      id: 'route-cmbt-1',
      name: 'Koyambedu CMBT ➔ Ambattur OT',
      triggerStop: { name: 'Padi Saravana Stores Bus Stop', lat: 13.1006, lng: 80.1837 },
      finalStop: { name: 'Ambattur OT Bus Stand', lat: 13.1143, lng: 80.1548 },
      triggerRadius: 450
    }
  ],

  DEFAULT_SETTINGS: {
    activeRouteId: 'route-ambattur-1',
    activeContactId: 'contact-dad',
    triggerStop: {
      name: 'Ambattur OT Bus Stand',
      lat: 13.1143,
      lng: 80.1548
    },
    finalStop: {
      name: 'Canara Bus Stand',
      lat: 13.1190,
      lng: 80.1620
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

  getSettings() {
    try {
      const data = localStorage.getItem(this.KEYS.SETTINGS);
      if (!data) return { ...this.DEFAULT_SETTINGS };
      return { ...this.DEFAULT_SETTINGS, ...JSON.parse(data) };
    } catch (e) {
      console.error('[Storage] Error reading settings:', e);
      return { ...this.DEFAULT_SETTINGS };
    }
  },

  saveSettings(newSettings) {
    try {
      const current = this.getSettings();
      const updated = { ...current, ...newSettings };
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
    const existingIndex = routes.findIndex(r => r.id === route.id || r.name.toLowerCase() === route.name.toLowerCase());
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
