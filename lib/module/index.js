import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ---------------------------------------------------------------------------
// Lazy-loaded optional peer dependencies
// Using separate boolean "loaded" flags to avoid re-entering require() after
// a failed attempt (the `!false === true` bug is avoided this way).
// ---------------------------------------------------------------------------
let _DeviceInfo = null;
let _DeviceInfoLoaded = false;
let _Clipboard = null;
let _ClipboardLoaded = false;
function getDeviceInfoModule() {
  if (!_DeviceInfoLoaded) {
    _DeviceInfoLoaded = true;
    try {
      _DeviceInfo = require('react-native-device-info');
    } catch (e) {
      console.warn('[Routix] react-native-device-info not installed. Device metadata will be limited.');
    }
  }
  return _DeviceInfo ?? null;
}
function getClipboardModule() {
  if (!_ClipboardLoaded) {
    _ClipboardLoaded = true;
    try {
      _Clipboard = require('@react-native-clipboard/clipboard');
    } catch (e) {
      console.warn('[Routix] @react-native-clipboard/clipboard not installed. Clipboard attribution disabled.');
    }
  }
  return _Clipboard ?? null;
}

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------
class RoutixEngine {
  apiKey = null;
  baseUrl = 'https://api.routix.link';
  version = '1.0.5';
  listeners = [];
  initialize(config) {
    this.apiKey = config.apiKey;
  }

  /**
   * Parses a direct deep link URL when the app is already installed.
   * Extracts Routix parameters from the URL.
   */
  handleDeepLink(url) {
    try {
      const urlObj = new URL(url);
      const params = urlObj.searchParams;
      const shortCode = params.get('code') || params.get('ref');
      if (!shortCode) return null;
      const match = {
        success: true,
        short_code: shortCode,
        original_url: url,
        match_source: 'direct_link',
        confidence: 1.0,
        timestamp: new Date().toISOString()
      };
      this.notifyListeners(match);
      return match;
    } catch (e) {
      return null;
    }
  }

  /**
   * Adds a listener for attribution events.
   * @returns A function to unsubscribe.
   */
  addAttributionListener(listener) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }
  notifyListeners(match) {
    this.listeners.forEach(listener => listener(match));
  }
  async makeRequest(url, body) {
    if (!this.apiKey) return null;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'X-SDK-Version': `react-native-${this.version}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  /**
   * Resolve deep link attribution for the current installation.
   */
  async resolve(options = {}) {
    if (!this.apiKey) {
      console.warn('[Routix] SDK not initialized. Call initialize() first.');
      return null;
    }

    // 1. Idempotency Check (Only resolve once per install)
    const alreadyResolved = await AsyncStorage.getItem('routix_resolved');
    if (alreadyResolved === 'true') return null;
    try {
      var _data$metadata;
      let clipboardToken = null;
      let installReferrer = null;

      // 2. Deterministic Match: Android Install Referrer
      if (Platform.OS === 'android') {
        try {
          const {
            InstallReferrerClient
          } = require('@react-native-google-play-install-referrer/install-referrer');
          const referrerDetails = await InstallReferrerClient.getReferrer();
          installReferrer = referrerDetails.installReferrer;
          console.log('[Routix] Android Install Referrer detected:', installReferrer);
        } catch (e) {
          console.log('[Routix] Android Install Referrer client not found, falling back to probabilistic.');
        }
      }

      // 3. Probabilistic Match: Clipboard Fallback (iOS specific utility)
      if (options.enableClipboard) {
        const ClipboardMod = getClipboardModule();
        if (!ClipboardMod) {
          console.warn('[Routix] Clipboard skipped: @react-native-clipboard/clipboard not installed.');
        } else {
          try {
            const ClipboardAPI = ClipboardMod.default ?? ClipboardMod;
            const content = await ClipboardAPI.getString();
            if (content && content.startsWith('rtx_')) {
              clipboardToken = content;
              console.log('[Routix] Clipboard attribution token found.');
            }
          } catch (e) {
            console.error('[Routix] Clipboard read failed:', e);
          }
        }
      }
      const deviceInfo = await this.getDeviceInfo();

      // Use whichever token we found (Referrer has priority)
      const token = installReferrer || (clipboardToken ? clipboardToken.substring(4) : null);
      const data = await this.makeRequest(`${this.baseUrl}/api/v1/sdk/resolve`, {
        install_referrer: token,
        device_info: deviceInfo
      });
      if (!data) return null;
      const match = {
        success: data.success,
        short_code: data.short_code,
        original_url: data.original_url || ((_data$metadata = data.metadata) === null || _data$metadata === void 0 ? void 0 : _data$metadata.original_url),
        match_source: data.attribution_source || data.match_type || data.match_source,
        confidence: data.confidence ?? 1.0,
        metadata: data.metadata,
        timestamp: data.timestamp
      };
      if (match.success) {
        await AsyncStorage.setItem('routix_resolved', 'true');
        this.notifyListeners(match);
        console.log('[Routix] Attribution resolved successfully via:', match.match_source);
      }
      return match;
    } catch (error) {
      console.error('[Routix] Attribution resolution failed:', error.message);
      return null;
    }
  }
  async trackEvent(code, type = 'track', metadata) {
    if (!this.apiKey) return false;
    try {
      await this.makeRequest(`${this.baseUrl}/api/v1/links/${code}/${type}`, {
        ...metadata,
        ...(type === 'track' && metadata !== null && metadata !== void 0 && metadata.eventType ? {
          event_type: metadata.eventType
        } : {}),
        sdk_v: `react-native-${this.version}`,
        timestamp: new Date().toISOString()
      });
      return true;
    } catch (error) {
      console.error(`[Routix] Tracking failed for ${type}:`, error);
      return false;
    }
  }
  trackInstall = code => this.trackEvent(code, 'install');
  trackLead = (code, metadata) => this.trackEvent(code, 'lead', metadata);
  trackSale = (code, amount, currency = 'USD', metadata) => this.trackEvent(code, 'sale', {
    ...metadata,
    amount,
    currency
  });

  /**
   * Track an event attributed to a specific link.
   */
  trackLinkEvent = (code, eventType, metadata) => this.trackEvent(code, 'track', {
    ...metadata,
    eventType
  });

  /**
   * Track a workspace-level custom event independent of any link.
   */
  async trackCustomEvent(eventType, metadata) {
    if (!this.apiKey) return false;
    try {
      await this.makeRequest(`${this.baseUrl}/api/v1/track`, {
        ...metadata,
        event_type: eventType,
        sdk_v: `react-native-${this.version}`,
        timestamp: new Date().toISOString()
      });
      return true;
    } catch (error) {
      console.error(`[Routix] Global tracking failed for ${eventType}:`, error);
      return false;
    }
  }

  /**
   * Collects device metadata for attribution fingerprinting.
   * Every single access is individually guarded — this method CANNOT crash the app,
   * even if all optional peer dependencies are missing.
   */
  async getDeviceInfo() {
    try {
      // 1. Get or Generate Anonymous Device ID
      let anonId = await AsyncStorage.getItem('routix_anon_id');
      if (!anonId) {
        anonId = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
        await AsyncStorage.setItem('routix_anon_id', anonId);
      }

      // 2. Get or Set First Open Timestamp
      let firstOpen = await AsyncStorage.getItem('routix_first_open');
      if (!firstOpen) {
        firstOpen = new Date().toISOString();
        await AsyncStorage.setItem('routix_first_open', firstOpen);
      }

      // 3. Screen dimensions — guarded
      let screenWidth = null;
      let screenHeight = null;
      try {
        const {
          width,
          height
        } = require('react-native').Dimensions.get('window');
        screenWidth = width;
        screenHeight = height;
      } catch (e) {/* ignore */}

      // 4. Device info — optional peer dep, fully guarded
      const DIMod = getDeviceInfoModule();
      const DI = (DIMod === null || DIMod === void 0 ? void 0 : DIMod.default) ?? DIMod ?? null;

      // 5. Locale — guarded per platform
      let locale = 'en_US';
      try {
        if (Platform.OS === 'ios') {
          var _require$NativeModule, _s$appleLanguages;
          const sm = (_require$NativeModule = require('react-native').NativeModules) === null || _require$NativeModule === void 0 ? void 0 : _require$NativeModule.SettingsManager;
          const s = sm === null || sm === void 0 ? void 0 : sm.settings;
          locale = (s === null || s === void 0 ? void 0 : s.appleLocale) || (s === null || s === void 0 || (_s$appleLanguages = s.appleLanguages) === null || _s$appleLanguages === void 0 ? void 0 : _s$appleLanguages[0]) || 'en_US';
        } else {
          var _require$NativeModule2;
          locale = ((_require$NativeModule2 = require('react-native').NativeModules) === null || _require$NativeModule2 === void 0 || (_require$NativeModule2 = _require$NativeModule2.I18nManager) === null || _require$NativeModule2 === void 0 ? void 0 : _require$NativeModule2.localeIdentifier) || 'en_US';
        }
      } catch (e) {/* ignore */}

      // 6. Timezone — optional peer dep, guarded
      let timezone = 'unknown';
      try {
        var _require;
        timezone = ((_require = require('react-native-localize')) === null || _require === void 0 ? void 0 : _require.getTimeZone()) || 'unknown';
      } catch (e) {
        console.warn('[Routix] react-native-localize not installed. Timezone will default to \'unknown\'.');
      }
      return {
        sdk_version: `react-native-${this.version}`,
        app_id: DI ? DI.getBundleId() : null,
        app_version: DI ? DI.getVersion() : null,
        build_number: DI ? DI.getBuildNumber() : null,
        os: Platform.OS,
        os_version: DI ? DI.getSystemVersion() : null,
        manufacturer: DI ? await DI.getManufacturer() : null,
        brand: DI ? DI.getBrand() : null,
        model: DI ? DI.getModel() : null,
        screen_width: screenWidth,
        screen_height: screenHeight,
        locale,
        timezone,
        anonymous_device_id: anonId,
        first_open_timestamp: firstOpen
      };
    } catch (error) {
      // Absolute last resort — no matter what goes wrong, we return minimal info
      console.warn('[Routix] Device info collection failed gracefully:', error === null || error === void 0 ? void 0 : error.message);
      return {
        sdk_version: `react-native-${this.version}`,
        os: Platform.OS
      };
    }
  }
}
export const Routix = new RoutixEngine();
//# sourceMappingURL=index.js.map