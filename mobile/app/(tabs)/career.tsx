import { StyleSheet } from 'react-native';

import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';

export default function CareerScreen() {
  return (
    <ThemedView style={styles.container}>
      <ThemedText type="title">Career Navigator</ThemedText>
      <ThemedText style={styles.subtitle}>
        Guided career path recommendations coming soon
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
