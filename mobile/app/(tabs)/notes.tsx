import { useState } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { getFieldNotes } from "../../src/api/fieldNotes";
import FieldNoteCard from "../../src/components/FieldNoteCard";
import LoadingView from "../../src/components/LoadingView";

const SORT_OPTIONS = [
  { id: "recent", label: "Recent" },
  { id: "oldest", label: "Oldest" },
  { id: "name", label: "Name" },
] as const;

export default function NotesTab() {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"recent" | "oldest" | "name">("recent");
  const router = useRouter();

  const { data: notes = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ["field-notes", search, sort],
    queryFn: () => getFieldNotes({ search, sortOrder: sort }),
  });

  if (isLoading) return <LoadingView />;

  return (
    <SafeAreaView style={styles.safe}>
      {/* Search + sort bar */}
      <View style={styles.bar}>
        <TextInput
          style={styles.search}
          placeholder="Search…"
          placeholderTextColor="#9A948E"
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
        />
        <View style={styles.sortRow}>
          {SORT_OPTIONS.map((opt) => (
            <Pressable
              key={opt.id}
              onPress={() => setSort(opt.id)}
              style={[styles.sortPill, sort === opt.id && styles.sortPillActive]}
            >
              <Text style={[styles.sortLabel, sort === opt.id && styles.sortLabelActive]}>
                {opt.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <FlatList
        data={notes}
        keyExtractor={(n) => n.id}
        renderItem={({ item }) => <FieldNoteCard note={item} />}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={isFetching} onRefresh={refetch} tintColor="#1a1815" />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No field notes yet.</Text>
            <Text style={styles.emptyBody}>
              Add trips from the Big Miles web app or promote items from your inbox.
            </Text>
          </View>
        }
      />

      {/* FAB — link to web */}
      <Pressable
        style={styles.fab}
        onPress={() =>
          router.push({ pathname: "/field-notes/[id]", params: { id: "new" } })
        }
      >
        <Text style={styles.fabText}>+</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F5F0E8" },
  bar: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4, gap: 8 },
  search: {
    backgroundColor: "#FDFAF5",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#E8E2D6",
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
    color: "#1a1815",
  },
  sortRow: { flexDirection: "row", gap: 6 },
  sortPill: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#E8E2D6",
  },
  sortPillActive: { backgroundColor: "#1a1815", borderColor: "#1a1815" },
  sortLabel: { fontSize: 12, color: "#6B6560", letterSpacing: 0.3 },
  sortLabelActive: { color: "#F5F0E8" },
  list: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 100 },
  empty: { alignItems: "center", paddingTop: 80, gap: 8, paddingHorizontal: 32 },
  emptyTitle: { fontSize: 18, fontWeight: "600", color: "#1a1815" },
  emptyBody: { fontSize: 14, color: "#9A948E", textAlign: "center", lineHeight: 22 },
  fab: {
    position: "absolute",
    bottom: 32,
    right: 24,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#1a1815",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  fabText: { color: "#F5F0E8", fontSize: 28, lineHeight: 32 },
});
