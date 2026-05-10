# Routix React Native SDK 🚀

[![npm version](https://img.shields.io/npm/v/react-native-routix?color=blue&logo=npm)](https://www.npmjs.com/package/react-native-routix)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Build Status](https://img.shields.io/github/actions/workflow/status/shivbo96/flowlnk/test-sdk-rn.yml?branch=main&logo=github)](https://github.com/shivbo96/flowlnk/actions)

The official **Routix SDK** for React Native. Professional attribution, deep linking, and conversion tracking for your cross-platform mobile apps.

---

## 📖 Table of Contents
- [Features](#-features)
- [Installation](#-installation)
- [Android Setup](#android-setup)
- [iOS Setup](#ios-setup)
- [Usage](#-usage)
  - [Initialization](#1-initialize-the-sdk)
  - [Deep Link Resolution](#2-resolve-deep-links)
  - [Event Tracking](#3-track-conversion-events)
- [Support](#-support)
- [License](#-license)

---

## 🚀 Features

- **🎯 Precision Attribution**: Resolve deep links via Android Install Referrer and iOS Fingerprinting.
- **📈 Conversion Tracking**: Track `install`, `lead`, and `sale` events with robust metadata support.
- **⚛️ Native Performance**: Built with TypeScript and optimized for React Native 0.60+.
- **🛡️ Privacy First**: Lightweight implementation focusing on essential attribution data.

---

## 📦 Installation

```bash
npm install react-native-routix
# or
yarn add react-native-routix
```

### Android Setup
Add the Install Referrer dependency to your `android/app/build.gradle`:
```gradle
dependencies {
    implementation 'com.android.installreferrer:installreferrer:2.2'
}
```

### iOS Setup
Run pod install in your `ios` directory:
```bash
cd ios && pod install
```

---

## 🛠️ Usage

### 1. Initialize the SDK
Initialize the SDK at the root of your application (e.g., `App.js` or `index.js`).

```typescript
import Routix from 'react-native-routix';

Routix.initialize({
  apiKey: 'your_workspace_api_key'
});
```

### 2. Resolve Deep Links
Resolve attribution data on app launch.

```typescript
const resolveAttribution = async () => {
  try {
    const match = await Routix.resolve({ enableClipboard: true });
    
    if (match?.success) {
      console.log('Attributed to:', match.shortCode);
      console.log('Source:', match.matchSource);
      
      const promo = match.metadata?.promo_code;
    }
  } catch (error) {
    console.error('Routix Resolve Error:', error);
  }
};
```

### 3. Track Conversion Events

**Sales & Revenue**
```typescript
await Routix.trackSale('SUMMER_24', {
  amount: 29.99,
  currency: 'USD',
  metadata: { plan: 'pro' }
});
```

**Custom Events**
```typescript
await Routix.trackCustomEvent('sign_up_completed', {
  method: 'email'
});
```

---

## 🤝 Support

- **Documentation**: [docs.routix.link](https://docs.routix.link)
- **Issues**: Report bugs via [GitHub Issues](https://github.com/shivbo96/flowlnk/issues)
- **Discord**: [Join our community](https://discord.gg/routix)

---

## 📄 License

This SDK is distributed under the **MIT License**. See [LICENSE](LICENSE) for more information.
