import {
  Alert,
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Image } from "expo-image";
import MapView, { Polyline } from "react-native-maps";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { getFieldNote, deleteFieldNote } from "../../src/api/fieldNotes";
import TypeBadge from "../../src/components/TypeBadge";
import LoadingView from "../../src/components/LoadingView";
import PhotoUploadButton from "../../src/components/PhotoUploadButton";

const SCREEN_WIDTH = Dimensions.get("window").width;
const PHOTO_SIZE = Math.floor((SCREEN_WIDTH - 20 * 2 - 10) / 2);

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
  const [lightboxPhoto, setLightboxPhoto] = useState<string | null>(null);

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

  const coords = useMemo(() => {
    if (!note?.gpxData) return null;
    try {
      const data = note.gpxData as any;
      const raw: [number, number][] = data.coordinates ?? null;
      if (!raw?.length) return null;
      return raw.map(([lng, lat]) => ({ latitude: lat, longitude: lng }));
    } catch {
      return null;
    }
  }, [note?.gpxData]);

  const mapRegion = useMemo(() => {
    if (!coords?.length) return null;
    const lats = coords.map((c) => c.latitude);
    const lngs = coords.map((c) => c.longitude);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
      latitudeDelta: (maxLat - minLat) * 1.5 + 0.005,
      longitudeDelta: (maxLng - minLng) * 1.5 + 0.005,
    };
  }, [coords]);

  if (isLoading) return <LoadingView />;
  if (error || !note) {
    return (
      <View style={styles.errorWrap}>
        <Text style={styles.errorText}>Field note not found.</Text>
      </View>
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
        { text: "Delete", style: "destructive", onPress: () => deleteMutation.mutate() },
      ]
    );
  }

  const lightboxIndex = note.photos?.findIndex((p) => p.url === lightboxPhoto) ?? -1;

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
        {/* Map */}
        {mapRegion && coords && (
          <View style={styles.mapContainer}>
            <MapView
              style={styles.map}
              initialRegion={mapRegion}
              scrollEnabled={false}
              zoomEnabled={false}
              rotateEnabled={false}
              pitchEnabled={false}
            >
              <Polyline
                coordinates={coords}
                strokeColor="#1a1815"
                strokeWidth={3}
              />
            </MapView>
          </View>
        )}

        <View style={styles.body}>
          {/* Type + date */}
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
                <StatBox label="Elevation" value={`${note.elevationGain} ft`} />
              )}
              {note.photos && note.photos.length > 0 && (
                <StatBox label="Photos" value={String(note.photos.length)} />
              )}
            </View>
          )}

          {/* Description */}
          {!!note.description && (
            <Text style={styles.description}>{note.description}</Text>
          )}

          {/* Photos grid */}
          <View style={styles.photosSection}>
            {note.photos && note.photos.length > 0 && (
              <>
                <Text style={styles.sectionHeader}>Photos · {note.photos.length}</Text>
                <View style={styles.photoGrid}>
                  {note.photos.map((photo) => (
                    <Pressable
                      key={photo.id}
                      onPress={() => setLightboxPhoto(photo.url)}
                      style={styles.photoThumb}
                    >
                      <Image
                        source={{ uri: photo.url }}
                        style={styles.photoImage}
                        contentFit="cover"
                        transition={200}
                      />
                    </Pressable>
                  ))}
                </View>
              </>
            )}
            <PhotoUploadButton fieldNoteId={id!} />
          </View>
        </View>
      </ScrollView>

      {/* Lightbox */}
      <Modal
        visible={!!lightboxPhoto}
        transparent
        animationType="fade"
        onRequestClose={() => setLightboxPhoto(null)}
      >
        <Pressable style={styles.lightboxOverlay} onPress={() => setLightboxPhoto(null)}>
          <Image
            source={{ uri: lightboxPhoto ?? undefined }}
            style={styles.lightboxImage}
            contentFit="contain"
          />
          {note.photos && note.photos.length > 1 && lightboxIndex >= 0 && (
            <View style={styles.lightboxNav}>
              <Pressable
                onPress={(e) => {
                  e.stopPropagation();
                  const prev = (lightboxIndex - 1 + note.photos!.length) % note.photos!.length;
                  setLightboxPhoto(note.photos![prev].url);
                }}
                style={styles.lightboxNavBtn}
              >
                <Text style={styles.lightboxNavText}>‹</Text>
              </Pressable>
              <Text style={styles.lightboxCounter}>
                {lightboxIndex + 1} / {note.photos.length}
              </Text>
              <Pressable
                onPress={(e) => {
                  e.stopPropagation();
                  const next = (lightboxIndex + 1) % note.photos!.length;
                  setLightboxPhoto(note.photos![next].url);
                }}
                style={styles.lightboxNavBtn}
              >
                <Text style={styles.lightboxNavText}>›</Text>
              </Pressable>
            </View>
          )}
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  scroll: { backgroundColor: "#F5F0E8" },
  content: { paddingBottom: 60 },
  errorWrap: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#F5F0E8" },
  errorText: { fontSize: 16, color: "#9A948E" },
  mapContainer: { width: "100%", height: 260, backgroundColor: "#E8E2D6" },
  map: { flex: 1 },
  body: { padding: 20, gap: 16 },
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
  photosSection: { gap: 8 },
  sectionHeader: {
    fontSize: 11,
    color: "#9A948E",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  photoGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  photoThumb: {
    width: PHOTO_SIZE,
    height: PHOTO_SIZE,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "#E8E2D6",
  },
  photoImage: { width: PHOTO_SIZE, height: PHOTO_SIZE },
  deleteBtn: { fontSize: 15, color: "#DC2626" },
  // Lightbox
  lightboxOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.92)",
    justifyContent: "center",
    alignItems: "center",
  },
  lightboxImage: { width: SCREEN_WIDTH, height: SCREEN_WIDTH * 1.2 },
  lightboxNav: {
    position: "absolute",
    bottom: 60,
    flexDirection: "row",
    alignItems: "center",
    gap: 24,
  },
  lightboxNavBtn: { padding: 12 },
  lightboxNavText: { color: "#fff", fontSize: 36, lineHeight: 40 },
  lightboxCounter: { color: "rgba(255,255,255,0.6)", fontSize: 14, fontWeight: "500" },
});
