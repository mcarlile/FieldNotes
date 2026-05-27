import { useState } from "react";
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getInboxItems, promoteInboxItem, dismissInboxItem, type InboxItem } from "../../src/api/inbox";
import LoadingView from "../../src/components/LoadingView";

const TRIP_TYPES = [
  "hiking", "backpacking", "cycling", "running",
  "paddling", "fishing", "motorcycle", "climbing", "skiing", "other",
];

function SourceBadge({ source }: { source: string | null }) {
  if (!source) return null;
  const label = source === "strava-activity" ? "Strava" : source === "strava-route" ? "Strava Route" : source;
  return (
    <View style={styles.sourceBadge}>
      <Text style={styles.sourceBadgeText}>{label}</Text>
    </View>
  );
}

function InboxCard({
  item,
  onPromote,
  onDismiss,
}: {
  item: InboxItem;
  onPromote: (item: InboxItem) => void;
  onDismiss: (id: string) => void;
}) {
  const stats = item.gpxStats;
  const isPromoted = item.status === "promoted";
  const isDismissed = item.status === "dismissed";

  return (
    <View style={[styles.card, (isPromoted || isDismissed) && styles.cardMuted]}>
      <View style={styles.cardHeader}>
        <Text style={styles.filename} numberOfLines={1}>
          {item.filename.replace(/\.gpx$/i, "").replace(/[_-]/g, " ")}
        </Text>
        <SourceBadge source={item.source} />
      </View>
      {stats && (
        <Text style={styles.statLine}>
          {stats.distance != null ? `${stats.distance.toFixed(1)} mi` : ""}
          {stats.distance != null && stats.elevationGain != null ? " · " : ""}
          {stats.elevationGain != null ? `${stats.elevationGain.toFixed(0)} ft gain` : ""}
          {stats.date ? `  ${new Date(stats.date).toLocaleDateString()}` : ""}
        </Text>
      )}
      {!isPromoted && !isDismissed && (
        <View style={styles.cardActions}>
          <Pressable style={styles.promoteBtn} onPress={() => onPromote(item)}>
            <Text style={styles.promoteBtnText}>Add to journal →</Text>
          </Pressable>
          <Pressable onPress={() => onDismiss(item.id)}>
            <Text style={styles.dismissText}>Dismiss</Text>
          </Pressable>
        </View>
      )}
      {isPromoted && <Text style={styles.promotedLabel}>Added to journal</Text>}
    </View>
  );
}

export default function InboxTab() {
  const qc = useQueryClient();
  const [promoteTarget, setPromoteTarget] = useState<InboxItem | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [selectedTypes, setSelectedTypes] = useState<string[]>(["hiking"]);

  const { data: items = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ["inbox"],
    queryFn: getInboxItems,
  });

  const promoteMutation = useMutation({
    mutationFn: promoteInboxItem,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inbox"] });
      qc.invalidateQueries({ queryKey: ["field-notes"] });
      setPromoteTarget(null);
    },
    onError: () => Alert.alert("Error", "Failed to add to journal."),
  });

  const dismissMutation = useMutation({
    mutationFn: dismissInboxItem,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inbox"] }),
  });

  function openPromote(item: InboxItem) {
    setTitle(item.filename.replace(/\.gpx$/i, "").replace(/[_-]/g, " "));
    setDescription("");
    setSelectedTypes(["hiking"]);
    setPromoteTarget(item);
  }

  function toggleType(t: string) {
    setSelectedTypes((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
    );
  }

  if (isLoading) return <LoadingView />;

  const pending = items.filter((i) => i.status === "pending");
  const past = items.filter((i) => i.status !== "pending");

  return (
    <SafeAreaView style={styles.safe}>
      <FlatList
        data={[...pending, ...past]}
        keyExtractor={(i) => i.id}
        renderItem={({ item }) => (
          <InboxCard
            item={item}
            onPromote={openPromote}
            onDismiss={(id) => dismissMutation.mutate(id)}
          />
        )}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={isFetching} onRefresh={refetch} tintColor="#1a1815" />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Inbox is empty</Text>
            <Text style={styles.emptyBody}>
              Send GPX files via your webhook URL or import from Strava at bigmiles.app
            </Text>
          </View>
        }
      />

      {/* Promote modal */}
      <Modal visible={!!promoteTarget} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modalSafe}>
          <View style={styles.modalHeader}>
            <Pressable onPress={() => setPromoteTarget(null)}>
              <Text style={styles.modalCancel}>Cancel</Text>
            </Pressable>
            <Text style={styles.modalTitle}>Add to journal</Text>
            <Pressable
              onPress={() => {
                if (!promoteTarget || !title.trim()) return;
                promoteMutation.mutate({
                  id: promoteTarget.id,
                  title: title.trim(),
                  description: description.trim(),
                  tripType: selectedTypes,
                });
              }}
              disabled={!title.trim() || promoteMutation.isPending}
            >
              <Text style={[styles.modalSave, (!title.trim() || promoteMutation.isPending) && styles.modalSaveDisabled]}>
                Save
              </Text>
            </Pressable>
          </View>

          <ScrollView style={styles.modalBody} contentContainerStyle={styles.modalContent}>
            <Text style={styles.fieldLabel}>Title</Text>
            <TextInput
              style={styles.input}
              value={title}
              onChangeText={setTitle}
              placeholder="Trip title…"
              placeholderTextColor="#9A948E"
            />

            <Text style={styles.fieldLabel}>Description</Text>
            <TextInput
              style={[styles.input, styles.inputMulti]}
              value={description}
              onChangeText={setDescription}
              placeholder="Notes about this trip…"
              placeholderTextColor="#9A948E"
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />

            <Text style={styles.fieldLabel}>Trip type</Text>
            <View style={styles.typeGrid}>
              {TRIP_TYPES.map((t) => (
                <Pressable
                  key={t}
                  onPress={() => toggleType(t)}
                  style={[styles.typePill, selectedTypes.includes(t) && styles.typePillActive]}
                >
                  <Text style={[styles.typePillText, selectedTypes.includes(t) && styles.typePillTextActive]}>
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F5F0E8" },
  list: { padding: 16, gap: 10, paddingBottom: 40 },
  card: {
    backgroundColor: "#FDFAF5",
    borderRadius: 12,
    padding: 14,
    gap: 6,
    borderWidth: 1,
    borderColor: "#E8E2D6",
  },
  cardMuted: { opacity: 0.5 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  filename: { fontSize: 15, fontWeight: "600", color: "#1a1815", flex: 1 },
  sourceBadge: { backgroundColor: "#FFF3E0", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  sourceBadgeText: { fontSize: 10, color: "#E65100", letterSpacing: 0.4, fontWeight: "600" },
  statLine: { fontSize: 12, color: "#8A847E" },
  cardActions: { flexDirection: "row", alignItems: "center", gap: 16, marginTop: 4 },
  promoteBtn: { backgroundColor: "#1a1815", borderRadius: 6, paddingHorizontal: 12, paddingVertical: 6 },
  promoteBtnText: { color: "#F5F0E8", fontSize: 13, fontWeight: "600" },
  dismissText: { fontSize: 13, color: "#9A948E", textDecorationLine: "underline" },
  promotedLabel: { fontSize: 12, color: "#6B6560", fontStyle: "italic" },
  empty: { alignItems: "center", paddingTop: 80, gap: 8, paddingHorizontal: 32 },
  emptyTitle: { fontSize: 18, fontWeight: "600", color: "#1a1815" },
  emptyBody: { fontSize: 14, color: "#9A948E", textAlign: "center", lineHeight: 22 },
  // Modal
  modalSafe: { flex: 1, backgroundColor: "#F5F0E8" },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#E8E2D6",
  },
  modalTitle: { fontSize: 16, fontWeight: "700", color: "#1a1815" },
  modalCancel: { fontSize: 15, color: "#6B6560" },
  modalSave: { fontSize: 15, fontWeight: "700", color: "#1a1815" },
  modalSaveDisabled: { opacity: 0.4 },
  modalBody: { flex: 1 },
  modalContent: { padding: 20, gap: 6, paddingBottom: 60 },
  fieldLabel: { fontSize: 12, color: "#6B6560", letterSpacing: 0.4, textTransform: "uppercase", marginTop: 12, marginBottom: 4 },
  input: {
    backgroundColor: "#FDFAF5",
    borderWidth: 1,
    borderColor: "#E8E2D6",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: "#1a1815",
  },
  inputMulti: { minHeight: 80 },
  typeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  typePill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#E8E2D6",
  },
  typePillActive: { backgroundColor: "#1a1815", borderColor: "#1a1815" },
  typePillText: { fontSize: 13, color: "#6B6560" },
  typePillTextActive: { color: "#F5F0E8" },
});
