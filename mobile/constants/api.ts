import { Platform } from 'react-native';

// Android emulator uses 10.0.2.2 to reach host localhost
// iOS simulator and web can use localhost directly
const DEV_HOST = Platform.OS === 'android' ? '10.0.2.2' : 'localhost';

export const API_BASE_URL = `http://${DEV_HOST}:8080`;
