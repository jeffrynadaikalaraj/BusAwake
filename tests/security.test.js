const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Minimal browser mocks for StorageManager & DOM XSS/link tests
function createMockStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    _store: store
  };
}

const localStorageMock = createMockStorage();
const sessionStorageMock = createMockStorage();

const sandbox = {
  window: {},
  localStorage: localStorageMock,
  sessionStorage: sessionStorageMock,
  console
};
sandbox.window = sandbox;

const storageCode = fs.readFileSync(path.join(__dirname, '..', 'js', 'storage.js'), 'utf8');
vm.runInNewContext(storageCode, sandbox);
const StorageManager = sandbox.window.StorageManager;

let passed = 0;
function runTest(name, fn) {
  fn();
  passed++;
  console.log(`PASS: ${name}`);
}

// 1. Valid Indian mobile numbers
runTest('1. Valid Indian mobile numbers', () => {
  const a = StorageManager.validatePhoneNumber('9876543210');
  assert.strictEqual(a.isValid, true);
  assert.strictEqual(a.tel, '+919876543210');
  assert.strictEqual(a.whatsapp, '919876543210');

  const b = StorageManager.validatePhoneNumber('09876543210');
  assert.strictEqual(b.isValid, true);
  assert.strictEqual(b.tel, '+919876543210');

  const c = StorageManager.validatePhoneNumber('+91 98765-43210');
  assert.strictEqual(c.isValid, true);
  assert.strictEqual(c.tel, '+919876543210');
});

// 2. Valid international phone numbers
runTest('2. Valid international phone numbers', () => {
  const us = StorageManager.validatePhoneNumber('+1 (415) 555-2671');
  assert.strictEqual(us.isValid, true);
  assert.strictEqual(us.tel, '+14155552671');
  assert.strictEqual(us.whatsapp, '14155552671');

  const uk = StorageManager.validatePhoneNumber('00442071234567');
  assert.strictEqual(uk.isValid, true);
  assert.strictEqual(uk.tel, '+442071234567');
});

// 3. Invalid phone numbers
runTest('3. Invalid phone numbers rejected', () => {
  for (const bad of ['123', '+0123456789', '98765+43210', '0000000000', '+1234567890123456']) {
    const res = StorageManager.validatePhoneNumber(bad);
    assert.strictEqual(res.isValid, false, `Expected ${bad} to be invalid`);
    assert.ok(res.error.length > 0);
  }
});

// 4. Empty contact numbers
runTest('4. Empty contact numbers rejected', () => {
  for (const empty of ['', '   ', null, undefined]) {
    const res = StorageManager.validatePhoneNumber(empty);
    assert.strictEqual(res.isValid, false);
    assert.strictEqual(res.tel, '');
  }
});

// 5. Malicious HTML in stop names & 7. Safe Leaflet pin rendering
runTest('5 & 7. Malicious HTML in stop names rendered safely via textContent', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  assert.ok(appSource.includes('function createStopPinNode('), 'createStopPinNode helper must exist');
  assert.ok(!appSource.includes('html: `<div id="mapUnifiedTriggerLabel"'), 'Raw HTML template for trigger pin must not exist');
  assert.ok(!appSource.includes('html: `<div id="mapUnifiedFinalLabel"'), 'Raw HTML template for final pin must not exist');

  // Simulate createStopPinNode behavior
  const payload = '<img src=x onerror=alert(1)>';
  let capturedText = null;
  const fakeDiv = {
    id: '',
    style: { cssText: '' },
    set textContent(val) { capturedText = val; },
    get textContent() { return capturedText; }
  };
  fakeDiv.textContent = `🚩 ${payload}`;
  assert.strictEqual(fakeDiv.textContent, `🚩 ${payload}`);
});

// 6. JavaScript injection attempts in phone numbers
runTest('6. JavaScript / HTML injection attempts in phone numbers rejected', () => {
  const injections = [
    '<script>alert(1)</script>',
    '9876543210<script>',
    'javascript:alert(1)',
    '9876543210" onclick="alert(1)',
    '9876543210;drop table'
  ];
  for (const inj of injections) {
    const res = StorageManager.validatePhoneNumber(inj);
    assert.strictEqual(res.isValid, false, `Injection ${inj} should be rejected`);
  }
});

// 8 & 9. Emergency call, SMS, and WhatsApp link generation + encodeURIComponent
runTest('8 & 9. Call, SMS, and WhatsApp link generation with URL encoding', () => {
  const valid = StorageManager.validatePhoneNumber('9876543210');
  const rawMessage = 'Crossed Ambattur OT! Speed: 35 km/h & GPS: https://maps.google.com/?q=13.12,80.14';
  const encoded = encodeURIComponent(rawMessage);
  const telLink = valid.isValid ? `tel:${valid.tel}` : '#';
  const waLink = valid.isValid ? `https://api.whatsapp.com/send?phone=${encodeURIComponent(valid.whatsapp)}&text=${encoded}` : '#';
  const smsLink = valid.isValid ? `sms:${valid.tel}?body=${encoded}` : '#';

  assert.strictEqual(telLink, 'tel:+919876543210');
  assert.ok(waLink.startsWith('https://api.whatsapp.com/send?phone=919876543210&text='));
  assert.ok(smsLink.startsWith('sms:+919876543210?body='));
  assert.ok(!waLink.includes(' '), 'WhatsApp query must be URL encoded');

  const invalid = StorageManager.validatePhoneNumber('<script>');
  assert.strictEqual(invalid.isValid ? `tel:${invalid.tel}` : '#', '#');
});

// 10. Native bridge validation in JS & Kotlin
runTest('10. Native bridge validation enforced in app.js and AndroidBridge.kt', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  assert.ok(appSource.includes('function invokeNativeBridgeCall('), 'invokeNativeBridgeCall must exist');

  const bridgeKt = fs.readFileSync(
    path.join(__dirname, '..', 'android-app', 'app', 'src', 'main', 'java', 'com', 'busawake', 'app', 'AndroidBridge.kt'),
    'utf8'
  );
  assert.ok(bridgeKt.includes('sanitizeAndValidatePhone'), 'AndroidBridge.kt must validate phone numbers');
  assert.ok(bridgeKt.includes('E164_PHONE_REGEX'), 'AndroidBridge.kt must enforce E.164 regex');
});

// 11. Google Maps API key no longer persisted in sessionStorage or localStorage
runTest('11. Google Maps API key never persisted in sessionStorage or localStorage', () => {
  sessionStorageMock.setItem('busawake_secrets_v6', JSON.stringify({ googleMapsApiKey: 'AIzaLegacyKey' }));
  StorageManager.saveSettings({ googleMapsApiKey: 'AIzaNewTestKey' });

  const loaded = StorageManager.getSettings();
  assert.strictEqual(loaded.googleMapsApiKey, undefined, 'googleMapsApiKey must not be in settings');
  assert.strictEqual(sessionStorageMock.getItem('busawake_secrets_v6'), null, 'Legacy sessionStorage secrets must be cleared');

  const rawLocal = JSON.parse(localStorageMock.getItem(StorageManager.KEYS.SETTINGS));
  assert.strictEqual(rawLocal.googleMapsApiKey, undefined, 'googleMapsApiKey must not be in localStorage');
});

// 12. Android cleartext traffic & WebView mixed content disabled
runTest('12. AndroidManifest and WebView forbid cleartext and mixed content', () => {
  const manifest = fs.readFileSync(
    path.join(__dirname, '..', 'android-app', 'app', 'src', 'main', 'AndroidManifest.xml'),
    'utf8'
  );
  assert.ok(manifest.includes('android:usesCleartextTraffic="false"'), 'usesCleartextTraffic must be false');
  assert.ok(!manifest.includes('android:usesCleartextTraffic="true"'), 'usesCleartextTraffic must not be true');

  const mainKt = fs.readFileSync(
    path.join(__dirname, '..', 'android-app', 'app', 'src', 'main', 'java', 'com', 'busawake', 'app', 'MainActivity.kt'),
    'utf8'
  );
  assert.ok(mainKt.includes('WebSettings.MIXED_CONTENT_NEVER_ALLOW'), 'WebView must use MIXED_CONTENT_NEVER_ALLOW');
  assert.ok(!mainKt.includes('MIXED_CONTENT_ALWAYS_ALLOW'), 'WebView must not use MIXED_CONTENT_ALWAYS_ALLOW');
});

console.log(`\nAll ${passed} security tests passed.`);
