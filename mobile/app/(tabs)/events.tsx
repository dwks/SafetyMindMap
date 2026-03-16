import { StyleSheet } from 'react-native';

import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';

export default function EventsScreen() {
  return (
    <ThemedView style={styles.container}>
      <ThemedText type="title">Events & Programs</ThemedText>
      <ThemedText style={styles.subtitle}>
        AI safety events and programs feed coming soon
      </ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  subtitle: {
    marginTop: 8,
    opacity: 0.6,
    textAlign: 'center',
  },
});
