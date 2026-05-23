import { ActivityIndicator, StyleSheet, View } from "react-native";

export default function LoadingView() {
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#1a1815" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#F5F0E8",
  },
});
