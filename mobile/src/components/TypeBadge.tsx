import { StyleSheet, Text, View } from "react-native";

interface Props {
  types: string[];
}

export default function TypeBadge({ types }: Props) {
  return (
    <View style={styles.row}>
      {types.map((t) => (
        <View key={t} style={styles.badge}>
          <Text style={styles.text}>{t}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
  },
  badge: {
    backgroundColor: "#E8E2D6",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  text: {
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    color: "#6B6560",
    fontFamily: "System",
  },
});
