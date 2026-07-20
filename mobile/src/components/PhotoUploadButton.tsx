import { useState } from "react";
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { useQueryClient } from "@tanstack/react-query";
import { uploadPhoto, type UploadAsset } from "../api/photos";

interface Props {
  fieldNoteId: string;
}

export default function PhotoUploadButton({ fieldNoteId }: Props) {
  const [uploading, setUploading] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const qc = useQueryClient();

  async function processAssets(assets: UploadAsset[]) {
    setUploading(true);
    setRemaining(assets.length);
    let done = 0;
    try {
      for (const asset of assets) {
        await uploadPhoto(fieldNoteId, asset);
        done++;
        setRemaining(assets.length - done);
      }
      qc.invalidateQueries({ queryKey: ["field-note", fieldNoteId] });
    } catch {
      Alert.alert("Upload failed", "One or more photos could not be uploaded.");
    } finally {
      setUploading(false);
      setRemaining(0);
    }
  }

  async function fromLibrary() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert(
        "Permission required",
        "Allow photo library access in Settings to upload photos."
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsMultipleSelection: true,
      mediaTypes: ["images"],
      quality: 0.85,
    });
    if (!result.canceled) {
      processAssets(
        result.assets.map((a) => ({
          uri: a.uri,
          filename: a.fileName ?? `photo_${Date.now()}.jpg`,
          mimeType: a.mimeType ?? "image/jpeg",
        }))
      );
    }
  }

  async function fromCamera() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      Alert.alert(
        "Permission required",
        "Allow camera access in Settings to take photos."
      );
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.85 });
    if (!result.canceled) {
      processAssets(
        result.assets.map((a) => ({
          uri: a.uri,
          filename: a.fileName ?? `photo_${Date.now()}.jpg`,
          mimeType: a.mimeType ?? "image/jpeg",
        }))
      );
    }
  }

  async function fromFiles() {
    const result = await DocumentPicker.getDocumentAsync({
      type: "image/*",
      multiple: true,
      copyToCacheDirectory: true,
    });
    if (!result.canceled) {
      processAssets(
        result.assets.map((a) => ({
          uri: a.uri,
          filename: a.name,
          mimeType: a.mimeType ?? "image/jpeg",
        }))
      );
    }
  }

  function show() {
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ["Cancel", "Photo Library", "Files", "Camera"],
          cancelButtonIndex: 0,
          title: "Add photos",
        },
        (index) => {
          if (index === 1) fromLibrary();
          else if (index === 2) fromFiles();
          else if (index === 3) fromCamera();
        }
      );
    } else {
      Alert.alert("Add photos", undefined, [
        { text: "Photo Library", onPress: fromLibrary },
        { text: "Files", onPress: fromFiles },
        { text: "Camera", onPress: fromCamera },
        { text: "Cancel", style: "cancel" },
      ]);
    }
  }

  if (uploading) {
    return (
      <Pressable style={[styles.btn, styles.btnUploading]} disabled>
        <ActivityIndicator size="small" color="#9A948E" />
        <Text style={styles.label}>
          {remaining > 0 ? `Uploading ${remaining}…` : "Finishing…"}
        </Text>
      </Pressable>
    );
  }

  return (
    <Pressable style={styles.btn} onPress={show}>
      <Text style={styles.label}>+ Add photos</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    borderWidth: 1,
    borderColor: "#E8E2D6",
    borderStyle: "dashed",
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  btnUploading: { borderStyle: "solid", backgroundColor: "#FDFAF5" },
  label: { fontSize: 14, color: "#6B6560" },
});
