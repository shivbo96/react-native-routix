"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.Routix = void 0;
var _reactNativeDeviceInfo = _interopRequireDefault(require("react-native-device-info"));
var _reactNative = require("react-native");
var _clipboard = _interopRequireDefault(require("@react-native-clipboard/clipboard"));
var _asyncStorage = _interopRequireDefault(require("@react-native-async-storage/async-storage"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
class RoutixEngine {
  apiKey = null;
  baseUrl = 'https://api.routix.link';
  version = '1.0.0';
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
    const alreadyResolved = await _asyncStorage.default.getItem('routix_resolved');
    if (alreadyResolved === 'true') return null;
    try {
      var _data$metadata;
      let clipboardToken = null;
      let installReferrer = null;

      // 2. Deterministic Match: Android Install Referrer
      if (_reactNative.Platform.OS === 'android') {
        try {
          // Try to load the native referrer client (optional peer dep)
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
        try {
          const content = await _clipboard.default.getString();
          if (content && content.startsWith('rtx_')) {
            clipboardToken = content;
            console.log('[Routix] Clipboard attribution token found.');
          }
        } catch (e) {
          console.error('[Routix] Clipboard read failed:', e);
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
        await _asyncStorage.default.setItem('routix_resolved', 'true');
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
  async getDeviceInfo() {
    var _require;
    // 1. Get or Generate Anonymous Device ID
    let anonId = await _asyncStorage.default.getItem('routix_anon_id');
    if (!anonId) {
      anonId = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      await _asyncStorage.default.setItem('routix_anon_id', anonId);
    }

    // 2. Get or Set First Open Timestamp
    let firstOpen = await _asyncStorage.default.getItem('routix_first_open');
    if (!firstOpen) {
      firstOpen = new Date().toISOString();
      await _asyncStorage.default.setItem('routix_first_open', firstOpen);
    }
    const {
      width,
      height
    } = require('react-native').Dimensions.get('window');
    return {
      sdk_version: `react-native-${this.version}`,
      app_id: _reactNativeDeviceInfo.default.getBundleId(),
      app_version: _reactNativeDeviceInfo.default.getVersion(),
      build_number: _reactNativeDeviceInfo.default.getBuildNumber(),
      os: _reactNative.Platform.OS,
      os_version: _reactNativeDeviceInfo.default.getSystemVersion(),
      manufacturer: await _reactNativeDeviceInfo.default.getManufacturer(),
      brand: _reactNativeDeviceInfo.default.getBrand(),
      model: _reactNativeDeviceInfo.default.getModel(),
      screen_width: width,
      screen_height: height,
      locale: _reactNative.Platform.OS === 'ios' ? require('react-native').NativeModules.SettingsManager.settings.appleLocale || require('react-native').NativeModules.SettingsManager.settings.appleLanguages[0] : require('react-native').NativeModules.I18nManager.localeIdentifier,
      timezone: ((_require = require('react-native-localize')) === null || _require === void 0 ? void 0 : _require.getTimeZone()) || 'unknown',
      anonymous_device_id: anonId,
      first_open_timestamp: firstOpen
    };
  }
}
const Routix = exports.Routix = new RoutixEngine();
//# sourceMappingURL=index.js.map