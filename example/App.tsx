import React, { useEffect, useState, useCallback } from 'react';
import { SafeAreaView, StyleSheet, Text, View, TouchableOpacity, ScrollView } from 'react-native';
import { Routix, RoutixMatch } from '../src/index';
// import { Routix, RoutixMatch } from 'react-native-routix';

const App = () => {
  const [match, setMatch] = useState<RoutixMatch | null>(null);
  const [loading, setLoading] = useState(false);

  // 3. Helper to resolve attribution (Defined first to avoid reference errors)
  const resolveAttribution = useCallback(async () => {
    setLoading(true);
    try {
      await Routix.resolve({ enableClipboard: true });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // 1. Initialize Routix
    Routix.initialize({ apiKey: 'rtx_test_key_123' });

    // 🌟 THE REACTIVE PATTERN:
    // Listen for ALL attribution events in one place.
    const unsubscribe = Routix.addAttributionListener((newMatch) => {
      console.log('[Routix] Attribution received:', newMatch.short_code);
      setMatch(newMatch);
    });

    // 1. TRIGGER: Resolve deferred install automatically on start
    resolveAttribution();

    // 🔗 PRODUCTION INTEGRATION:
    // To handle real system deep links, pipe the Linking listener into Routix:
    // Linking.getInitialURL().then(url => url && Routix.handleDeepLink(url));
    // Linking.addEventListener('url', ({ url }) => Routix.handleDeepLink(url));

    // 🧪 SIMULATION: Simulate a link click after 2 seconds
    const timer = setTimeout(() => {
      Routix.handleDeepLink('https://routix.link/SUMMER24?code=SUMMER24');
    }, 2000);

    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, [resolveAttribution]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.header}>ATTRIBUTED CODE</Text>
        <Text style={styles.code}>{match?.short_code || 'None'}</Text>

        <View style={styles.divider} />

        {match && match.success && (
          <View style={styles.infoBox}>
            <InfoRow label="Source" value={match.match_source || 'N/A'} />
            <InfoRow label="Confidence" value={`${Math.round((match.confidence || 0) * 100)}%`} />
            <InfoRow label="Timestamp" value={match.timestamp?.split('T')[0] || 'N/A'} />
          </View>
        )}

        <TouchableOpacity 
          style={[styles.button, loading && styles.buttonDisabled]} 
          onPress={resolveAttribution}
          disabled={loading}
        >
          <Text style={styles.buttonText}>{loading ? 'Checking...' : 'Check Deferred Attribution'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
};

const InfoRow = ({ label, value }: { label: string; value: string }) => (
  <View style={styles.row}>
    <Text style={styles.rowLabel}>{label}</Text>
    <Text style={styles.rowValue}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0F' },
  content: { padding: 32, alignItems: 'center', justifyContent: 'center', flexGrow: 1 },
  header: { color: 'rgba(255,255,255,0.4)', fontSize: 12, letterSpacing: 1.5, fontWeight: 'bold' },
  code: { color: '#2DD4BF', fontSize: 48, fontWeight: 'bold', marginVertical: 16 },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.1)', width: '100%', marginVertical: 32 },
  infoBox: { width: '100%', marginBottom: 32 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  rowLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 14 },
  rowValue: { color: '#FFF', fontSize: 14, fontWeight: 'bold' },
  button: { backgroundColor: '#2DD4BF', width: '100%', padding: 18, borderRadius: 12, alignItems: 'center' },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#000', fontWeight: 'bold', fontSize: 16 },
});

export default App;
