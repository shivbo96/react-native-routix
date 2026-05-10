import DeviceInfo from 'react-native-device-info';
import { Platform } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface RoutixMatch {
  success: boolean;
  short_code?: string;
  original_url?: string;
  match_source?: string; // Maps to attribution_source or match_type
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

class RoutixEngine {
  private apiKey: string | null = null;
  private readonly baseUrl: string = 'https://api.routix.link';
  private version: string = '1.0.0';
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
              // Try to load the native referrer client (optional peer dep)
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
          try {
              const content = await Clipboard.getString();
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

      const match: RoutixMatch = {
        success: data.success,
        short_code: data.short_code,
        original_url: data.original_url || data.metadata?.original_url,
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
    } catch (error: any) {
      console.error('[Routix] Attribution resolution failed:', error.message);
      return null;
    }
  }

  public async trackEvent(code: string, type: string = 'track', metadata?: any) {
    if (!this.apiKey) return false;

    try {
      await this.makeRequest(`${this.baseUrl}/api/v1/links/${code}/${type}`, {
        ...metadata,
        ...(type === 'track' && metadata?.eventType ? { event_type: metadata.eventType } : {}),
        sdk_v: `react-native-${this.version}`,
        timestamp: new Date().toISOString()
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

  private async getDeviceInfo() {
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

    const { width, height } = require('react-native').Dimensions.get('window');

    return {
      sdk_version: `react-native-${this.version}`,
      app_id: DeviceInfo.getBundleId(),
      app_version: DeviceInfo.getVersion(),
      build_number: DeviceInfo.getBuildNumber(),
      os: Platform.OS,
      os_version: DeviceInfo.getSystemVersion(),
      manufacturer: await DeviceInfo.getManufacturer(),
      brand: DeviceInfo.getBrand(),
      model: DeviceInfo.getModel(),
      screen_width: width,
      screen_height: height,
      locale: Platform.OS === 'ios' 
        ? (require('react-native').NativeModules.SettingsManager.settings.appleLocale || 
           require('react-native').NativeModules.SettingsManager.settings.appleLanguages[0])
        : require('react-native').NativeModules.I18nManager.localeIdentifier,
      timezone: require('react-native-localize')?.getTimeZone() || 'unknown',
      anonymous_device_id: anonId,
      first_open_timestamp: firstOpen,
    };
  }
}

export const Routix = new RoutixEngine();
