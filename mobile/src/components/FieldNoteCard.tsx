import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import type { FieldNote } from "../api/fieldNotes";
import TypeBadge from "./TypeBadge";

interface Props {
  note: FieldNote;
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function FieldNoteCard({ note }: Props) {
  const router = useRouter();
  const types = Array.isArray(note.tripType) ? note.tripType : [note.tripType];

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      onPress={() => router.push(`/field-notes/${note.id}`)}
    >
      <TypeBadge types={types} />
      <Text style={styles.title} numberOfLines={2}>
        {note.title}
      </Text>
      <Text style={styles.meta} numberOfLines={1}>
        {note.distance != null ? `${note.distance} mi · ` : ""}
        {note.elevationGain != null ? `${note.elevationGain} ft · ` : ""}
        {formatDate(note.date)}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#FDFAF5",
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
    gap: 6,
    borderWidth: 1,
    borderColor: "#E8E2D6",
  },
  pressed: {
    opacity: 0.75,
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1a1815",
    lineHeight: 24,
  },
  meta: {
    fontSize: 12,
    color: "#8A847E",
    letterSpacing: 0.3,
  },
});
