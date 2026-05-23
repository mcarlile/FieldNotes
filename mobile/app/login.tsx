import { openAuthSessionAsync } from "expo-web-browser";
import * as Linking from "expo-linking";
import {
  Alert,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";

const LOGIN_URL = "https://bigmiles.app/api/login?redirectTo=mobile";

export default function LoginScreen() {
  const router = useRouter();

  async function handleSignIn() {
    const redirectUri = Linking.createURL("auth");
    const result = await openAuthSessionAsync(LOGIN_URL, redirectUri);

    if (result.type === "success" && result.url) {
      // The deep link handler (auth-callback) will pick this up via useEffect in _layout
      // but since openAuthSessionAsync returns the URL directly on iOS, handle it here too
      const parsed = Linking.parse(result.url);
      if (parsed.queryParams?.token) {
        router.replace({
          pathname: "/auth-callback",
          params: { token: parsed.queryParams.token as string },
        });
        return;
      }
      if (parsed.queryParams?.error) {
        Alert.alert("Sign in failed", "Please try again.");
        return;
      }
    }

    if (result.type === "cancel") {
      // User dismissed — do nothing
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.wordmark}>Big Miles</Text>
          <Text style={styles.tagline}>Your outdoor field journal</Text>
        </View>

        <View style={styles.body}>
          <Pressable
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
            onPress={handleSignIn}
          >
            <Text style={styles.buttonText}>Sign in →</Text>
          </Pressable>
          <Text style={styles.hint}>
            Uses your existing Big Miles account.{"\n"}A browser will open briefly.
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#F5F0E8",
  },
  container: {
    flex: 1,
    paddingHorizontal: 32,
    justifyContent: "space-between",
    paddingVertical: 60,
  },
  header: {
    gap: 8,
  },
  wordmark: {
    fontSize: 48,
    fontWeight: "700",
    color: "#1a1815",
    letterSpacing: -1.5,
  },
  tagline: {
    fontSize: 16,
    color: "#6B6560",
    letterSpacing: 0.2,
  },
  body: {
    gap: 16,
    alignItems: "flex-start",
  },
  button: {
    backgroundColor: "#1a1815",
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 8,
  },
  buttonPressed: {
    opacity: 0.75,
  },
  buttonText: {
    color: "#F5F0E8",
    fontSize: 16,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
  hint: {
    fontSize: 13,
    color: "#9A948E",
    lineHeight: 20,
  },
});
