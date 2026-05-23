import { Alert, Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useAuthStore } from "../../src/auth/store";
import { useQuery } from "@tanstack/react-query";
import { apiJson } from "../../src/api/client";

interface User {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  profile_image_url: string | null;
}

export default function SettingsTab() {
  const { logout, token } = useAuthStore();
  const router = useRouter();

  const { data: user } = useQuery({
    queryKey: ["me"],
    queryFn: () => apiJson<User>("/api/me"),
    enabled: !!token,
  });

  function handleLogout() {
    Alert.alert("Sign out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: async () => {
          await logout();
          router.replace("/login");
        },
      },
    ]);
  }

  const displayName =
    user?.first_name || user?.last_name
      ? [user.first_name, user.last_name].filter(Boolean).join(" ")
      : user?.email ?? "—";

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Account</Text>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Name</Text>
            <Text style={styles.rowValue}>{displayName}</Text>
          </View>
          {user?.email && (
            <View style={[styles.row, styles.rowBorder]}>
              <Text style={styles.rowLabel}>Email</Text>
              <Text style={styles.rowValue} numberOfLines={1}>
                {user.email}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>App</Text>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Version</Text>
            <Text style={styles.rowValue}>1.0.0</Text>
          </View>
          <View style={[styles.row, styles.rowBorder]}>
            <Text style={styles.rowLabel}>Connected to</Text>
            <Text style={styles.rowValue}>bigmiles.app</Text>
          </View>
        </View>

        <Pressable
          style={({ pressed }) => [styles.logoutBtn, pressed && { opacity: 0.7 }]}
          onPress={handleLogout}
        >
          <Text style={styles.logoutText}>Sign out</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F5F0E8" },
  container: { flex: 1, padding: 20, gap: 24 },
  section: {
    backgroundColor: "#FDFAF5",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E8E2D6",
    overflow: "hidden",
  },
  sectionLabel: {
    fontSize: 11,
    color: "#9A948E",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 6,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  rowBorder: { borderTopWidth: 1, borderTopColor: "#E8E2D6" },
  rowLabel: { fontSize: 15, color: "#1a1815" },
  rowValue: { fontSize: 15, color: "#6B6560", maxWidth: "60%" },
  logoutBtn: {
    borderWidth: 1,
    borderColor: "#DC2626",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  logoutText: { fontSize: 15, color: "#DC2626", fontWeight: "600" },
});
