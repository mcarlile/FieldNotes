import { Tabs } from "expo-router";
import { Text } from "react-native";

function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  return (
    <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.4 }}>{label}</Text>
  );
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarStyle: {
          backgroundColor: "#F5F0E8",
          borderTopColor: "#E8E2D6",
        },
        tabBarActiveTintColor: "#1a1815",
        tabBarInactiveTintColor: "#9A948E",
        tabBarLabelStyle: {
          fontSize: 11,
          letterSpacing: 0.3,
        },
        headerStyle: { backgroundColor: "#F5F0E8" },
        headerShadowVisible: false,
        headerTitleStyle: { color: "#1a1815", fontWeight: "700", fontSize: 18 },
      }}
    >
      <Tabs.Screen
        name="notes"
        options={{
          title: "Notes",
          headerTitle: "Field Notes",
          tabBarIcon: ({ focused }) => <TabIcon label="📓" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="inbox"
        options={{
          title: "Inbox",
          headerTitle: "GPX Inbox",
          tabBarIcon: ({ focused }) => <TabIcon label="📥" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Account",
          headerTitle: "Account",
          tabBarIcon: ({ focused }) => <TabIcon label="⚙️" focused={focused} />,
        }}
      />
    </Tabs>
  );
}
