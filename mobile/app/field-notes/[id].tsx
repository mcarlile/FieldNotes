import {
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getFieldNote, deleteFieldNote } from "../../src/api/fieldNotes";
import TypeBadge from "../../src/components/TypeBadge";
import LoadingView from "../../src/components/LoadingView";

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statBox}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export default function FieldNoteDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();

  const { data: note, isLoading, error } = useQuery({
    queryKey: ["field-note", id],
    queryFn: () => getFieldNote(id!),
    enabled: !!id,
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteFieldNote(id!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["field-notes"] });
      router.back();
    },
    onError: () => Alert.alert("Error", "Failed to delete field note."),
  });

  if (isLoading) return <LoadingView />;
  if (error || !note) {
    return (
      <SafeAreaView style={styles.safe}>
        <Text style={styles.errorText}>Field note not found.</Text>
      </SafeAreaView>
    );
  }

  const types = Array.isArray(note.tripType) ? note.tripType : [note.tripType];
  const dateStr = new Date(note.date).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  function confirmDelete() {
    Alert.alert(
      "Delete field note",
      "This cannot be undone. Are you sure?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => deleteMutation.mutate(),
        },
      ]
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: note.title,
          headerRight: () => (
            <Pressable onPress={confirmDelete} style={{ marginRight: 8 }}>
              <Text style={styles.deleteBtn}>Delete</Text>
            </Pressable>
          ),
        }}
      />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {/* Meta row */}
        <View style={styles.metaRow}>
          <TypeBadge types={types} />
        </View>
        <Text style={styles.date}>{dateStr}</Text>

        {/* Stats */}
        {(note.distance != null || note.elevationGain != null) && (
          <View style={styles.statsRow}>
            {note.distance != null && (
              <StatBox label="Distance" value={`${note.distance} mi`} />
            )}
            {note.elevationGain != null && (
              <StatBox label="Elevation gain" value={`${note.elevationGain} ft`} />
            )}
            {note.photos && note.photos.length > 0 && (
              <StatBox label="Photos" value={String(note.photos.length)} />
            )}
          </View>
        )}

        {/* Description */}
        <Text style={styles.description}>{note.description}</Text>

        {/* Photos */}
        {note.photos && note.photos.length > 0 && (
          <View style={styles.photosSection}>
            <Text style={styles.sectionHeader}>Photos</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.photoRow}
            >
              {note.photos.map((photo) => (
                <View key={photo.id} style={styles.photoPlaceholder}>
                  <Text style={styles.photoName} numberOfLines={1}>
                    {photo.filename}
                  </Text>
                </View>
              ))}
            </ScrollView>
          </View>
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F5F0E8" },
  scroll: { backgroundColor: "#F5F0E8" },
  content: { padding: 20, gap: 16, paddingBottom: 60 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  date: { fontSize: 13, color: "#8A847E", letterSpacing: 0.2 },
  statsRow: {
    flexDirection: "row",
    gap: 12,
    backgroundColor: "#FDFAF5",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#E8E2D6",
  },
  statBox: { gap: 2, flex: 1 },
  statValue: { fontSize: 20, fontWeight: "700", color: "#1a1815" },
  statLabel: { fontSize: 11, color: "#9A948E", letterSpacing: 0.4, textTransform: "uppercase" },
  description: { fontSize: 16, color: "#2C2A27", lineHeight: 26 },
  sectionHeader: {
    fontSize: 11,
    color: "#9A948E",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  photosSection: { gap: 4 },
  photoRow: { gap: 10 },
  photoPlaceholder: {
    width: 120,
    height: 120,
    backgroundColor: "#E8E2D6",
    borderRadius: 8,
    justifyContent: "flex-end",
    padding: 8,
  },
  photoName: { fontSize: 10, color: "#6B6560" },
  deleteBtn: { fontSize: 15, color: "#DC2626" },
  errorText: { textAlign: "center", marginTop: 80, fontSize: 16, color: "#9A948E" },
});
