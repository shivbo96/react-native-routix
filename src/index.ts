import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ---------------------------------------------------------------------------
// Lazy-loaded optional peer dependencies
// Using separate boolean "loaded" flags to avoid re-entering require() after
// a failed attempt (the `!false === true` bug is avoided this way).
// ---------------------------------------------------------------------------
let _DeviceInfo: any = null;
let _DeviceInfoLoaded = false;
let _Clipboard: any = null;
let _ClipboardLoaded = false;

function getDeviceInfoModule(): any | null {
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

function getClipboardModule(): any | null {
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
export interface RoutixMatch {
  success: boolean;
  short_code?: string;
  original_url?: string;
  match_source?: string;
  confidence?: number;
  metadata?: any;
  timestamp?: string;
}

export interface RoutixConfig {
  apiKey: string;
}

export interface ResolveOptions {
  enableClipboard?: boolean;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------
class RoutixEngine {
  private apiKey: string | null = null;
  private readonly baseUrl: string = 'https://api.routix.link';
  private version: string = '1.0.6';
  private listeners: Array<(match: RoutixMatch) => void> = [];

  public initialize(config: RoutixConfig) {
    this.apiKey = config.apiKey;
  }

  /**
   * Parses a direct deep link URL when the app is already installed.
   * Extracts Routix parameters from the URL.
   */
  public handleDeepLink(url: string): RoutixMatch | null {
    try {
      const urlObj = new URL(url);
      const params = urlObj.searchParams;
      const shortCode = params.get('code') || params.get('ref');

      if (!shortCode) return null;

      const match: RoutixMatch = {
        success: true,
        short_code: shortCode,
        original_url: url,
        match_source: 'direct_link',
        confidence: 1.0,
        timestamp: new Date().toISOString(),
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
  public addAttributionListener(listener: (match: RoutixMatch) => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notifyListeners(match: RoutixMatch) {
    this.listeners.forEach(listener => listener(match));
  }

  private async makeRequest(url: string, body: any) {
    if (!this.apiKey) return null;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'X-SDK-Version': `react-native-${this.version}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
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
  public async resolve(options: ResolveOptions = {}): Promise<RoutixMatch | null> {
    if (!this.apiKey) {
      console.warn('[Routix] SDK not initialized. Call initialize() first.');
      return null;
    }

    // 1. Idempotency Check (Only resolve once per install)
    const alreadyResolved = await AsyncStorage.getItem('routix_resolved');
    if (alreadyResolved === 'true') return null;

    try {
      let clipboardToken = null;
      let installReferrer = null;

      // 2. Deterministic Match: Android Install Referrer
      if (Platform.OS === 'android') {
        try {
          const { InstallReferrerClient } = require('@react-native-google-play-install-referrer/install-referrer');
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
        device_info: deviceInfo,
      });

      if (!data) return null;

      const match: RoutixMatch = {
        success: data.success,
        short_code: data.short_code,
        original_url: data.original_url || data.metadata?.original_url,
        match_source: data.attribution_source || data.match_type || data.match_source,
        confidence: data.confidence ?? 1.0,
        metadata: data.metadata,
        timestamp: data.timestamp,
      };

      if (match.success) {
        await AsyncStorage.setItem('routix_resolved', 'true');
        this.notifyListeners(match);
        console.log('[Routix] Attribution resolved successfully via:', match.match_source);
      }

      return match;
    } catch (error: any) {
      console.error('[Routix] Attribution resolution failed:', error.message);
      return null;
    }
  }

  public async trackEvent(code: string, type: string = 'track', metadata?: any) {
    if (!this.apiKey) return false;

    try {
      const deviceInfo = await this.getDeviceInfo();
      await this.makeRequest(`${this.baseUrl}/api/v1/links/${code}/${type}`, {
        ...metadata,
        anonymous_device_id: metadata?.anonymous_device_id || metadata?.anonymousDeviceId || deviceInfo?.anonymous_device_id,
        device_info: metadata?.device_info || metadata?.deviceInfo || deviceInfo,
        ...(type === 'track' && metadata?.eventType ? { event_type: metadata.eventType } : {}),
        sdk_v: `react-native-${this.version}`,
        timestamp: new Date().toISOString(),
      });

      return true;
    } catch (error) {
      console.error(`[Routix] Tracking failed for ${type}:`, error);
      return false;
    }
  }

  public trackInstall = (code: string) => this.trackEvent(code, 'install');
  public trackLead = (code: string, metadata?: any) => this.trackEvent(code, 'lead', metadata);
  public trackSale = (code: string, amount: number, currency: string = 'USD', metadata?: any) =>
    this.trackEvent(code, 'sale', { ...metadata, amount, currency });

  /**
   * Track an event attributed to a specific link.
   */
  public trackLinkEvent = (code: string, eventType: string, metadata?: any) =>
    this.trackEvent(code, 'track', { ...metadata, eventType });

  /**
   * Track a workspace-level custom event independent of any link.
   */
  public async trackCustomEvent(eventType: string, metadata?: any) {
    if (!this.apiKey) return false;

    try {
      const deviceInfo = await this.getDeviceInfo();
      await this.makeRequest(`${this.baseUrl}/api/v1/track`, {
        ...metadata,
        anonymous_device_id: metadata?.anonymous_device_id || metadata?.anonymousDeviceId || deviceInfo?.anonymous_device_id,
        device_info: metadata?.device_info || metadata?.deviceInfo || deviceInfo,
        event_type: eventType,
        sdk_v: `react-native-${this.version}`,
        timestamp: new Date().toISOString(),
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
  private async getDeviceInfo() {
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
      let screenWidth: number | null = null;
      let screenHeight: number | null = null;
      try {
        const { width, height } = require('react-native').Dimensions.get('window');
        screenWidth = width;
        screenHeight = height;
      } catch (e) { /* ignore */ }

      // 4. Device info — optional peer dep, fully guarded
      const DIMod = getDeviceInfoModule();
      const DI = (DIMod?.default ?? DIMod) ?? null;

      // 5. Locale — guarded per platform
      let locale = 'en_US';
      try {
        if (Platform.OS === 'ios') {
          const sm = require('react-native').NativeModules?.SettingsManager;
          const s = sm?.settings;
          locale = s?.appleLocale || s?.appleLanguages?.[0] || 'en_US';
        } else {
          locale = require('react-native').NativeModules?.I18nManager?.localeIdentifier || 'en_US';
        }
      } catch (e) { /* ignore */ }

      // 6. Timezone — optional peer dep, guarded
      let timezone = 'unknown';
      try {
        timezone = require('react-native-localize')?.getTimeZone() || 'unknown';
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
        first_open_timestamp: firstOpen,
      };
    } catch (error: any) {
      // Absolute last resort — no matter what goes wrong, we return minimal info
      console.warn('[Routix] Device info collection failed gracefully:', error?.message);
      return { sdk_version: `react-native-${this.version}`, os: Platform.OS };
    }
  }
}

export const Routix = new RoutixEngine();
