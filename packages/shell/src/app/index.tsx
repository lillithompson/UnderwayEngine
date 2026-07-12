import { View, StyleSheet } from 'react-native';
import { BG_DARK } from '@/engine/colors';
import WebViewShell from '../components/WebViewShell';

export default function NativeShellScreen() {
  return (
    <View style={styles.container}>
      <WebViewShell />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG_DARK,
  },
});
