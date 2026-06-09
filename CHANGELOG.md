# Changelog

## 1.0.5

* Added console warnings for all optional peer dependencies (`react-native-device-info`, `@react-native-clipboard/clipboard`, `react-native-localize`) when they are missing.
* Fully guarded device info collection and clipboard attribution checks to ensure the application never crashes even if optional dependencies are completely absent.
* Cleaned up external dependencies.

## 1.0.4

* Unified versioning across all Routix SDKs.
* Standardized README structure with clear Direct vs. Deferred flow distinction.
* Improved attribution reliability with expanded device metadata capture (Screen size, Timezone).
* Added official support for unified event tracking schemas (`trackSale`, `trackCustomEvent`).

## 1.0.0

* Initial release of the Routix React Native SDK.
* Cross-platform support for Android and iOS attribution.
* Unified API for deep link resolution and event tracking.
