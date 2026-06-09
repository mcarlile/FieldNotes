import { useState } from "react";
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Stack, useRouter } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFieldNote } from "../../src/api/fieldNotes";

const TRIP_TYPES = [
  "hiking", "backpacking", "cycling", "running",
  "paddling", "fishing", "motorcycle", "climbing", "skiing", "other",
];

export default function NewFieldNote() {
  const router = useRouter();
  const qc = useQueryClient();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [selectedTypes, setSelectedTypes] = useState<string[]>(["hiking"]);

  const createMutation = useMutation({
    mutationFn: createFieldNote,
    onSuccess: (note) => {
      qc.invalidateQueries({ queryKey: ["field-notes"] });
      router.replace({ pathname: "/field-notes/[id]", params: { id: note.id } });
    },
    onError: () => Alert.alert("Error", "Failed to create field note."),
  });

  function save() {
    if (!title.trim()) return;
    createMutation.mutate({
      title: title.trim(),
      description: description.trim() || undefined,
      date: date.toISOString(),
      tripType: selectedTypes,
    });
  }

  function toggleType(t: string) {
    setSelectedTypes((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
    );
  }

  const dateLabel = date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const canSave = title.trim().length > 0 && !createMutation.isPending;

  return (
    <>
      <Stack.Screen
        options={{
          title: "New Field Note",
          headerRight: () => (
            <Pressable onPress={save} disabled={!canSave} style={{ marginRight: 8 }}>
              <Text style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}>
                Save
              </Text>
            </Pressable>
          ),
        }}
      />

      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>Title</Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="Trip title…"
            placeholderTextColor="#9A948E"
            autoFocus
            returnKeyType="next"
          />

          <Text style={styles.label}>Date</Text>
          <Pressable style={styles.dateButton} onPress={() => setShowDatePicker(true)}>
            <Text style={styles.dateText}>{dateLabel}</Text>
          </Pressable>

          <Text style={styles.label}>Description</Text>
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

          <Text style={styles.label}>Trip type</Text>
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

      {/* Date picker modal (iOS) */}
      <Modal
        visible={showDatePicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowDatePicker(false)}
      >
        <Pressable style={styles.dateOverlay} onPress={() => setShowDatePicker(false)}>
          <View style={styles.dateSheet}>
            <View style={styles.dateSheetHeader}>
              <Text style={styles.dateSheetTitle}>Select date</Text>
              <Pressable onPress={() => setShowDatePicker(false)}>
                <Text style={styles.dateSheetDone}>Done</Text>
              </Pressable>
            </View>
            <DateTimePicker
              value={date}
              mode="date"
              display={Platform.OS === "ios" ? "spinner" : "default"}
              maximumDate={new Date()}
              onChange={(_, selected) => {
                if (Platform.OS === "android") setShowDatePicker(false);
                if (selected) setDate(selected);
              }}
              style={styles.datePicker}
            />
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F5F0E8" },
  content: { padding: 20, paddingBottom: 60 },
  label: {
    fontSize: 12,
    color: "#6B6560",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    marginTop: 20,
    marginBottom: 6,
  },
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
  inputMulti: { minHeight: 88 },
  dateButton: {
    backgroundColor: "#FDFAF5",
    borderWidth: 1,
    borderColor: "#E8E2D6",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  dateText: { fontSize: 15, color: "#1a1815" },
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
  saveBtn: { fontSize: 15, fontWeight: "700", color: "#1a1815" },
  saveBtnDisabled: { opacity: 0.35 },
  // Date modal
  dateOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  dateSheet: {
    backgroundColor: "#F5F0E8",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 32,
  },
  dateSheetHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#E8E2D6",
  },
  dateSheetTitle: { fontSize: 15, fontWeight: "600", color: "#1a1815" },
  dateSheetDone: { fontSize: 15, fontWeight: "700", color: "#1a1815" },
  datePicker: { backgroundColor: "#F5F0E8" },
});
