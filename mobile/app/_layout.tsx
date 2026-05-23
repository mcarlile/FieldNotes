import { useEffect } from "react";
import { Stack } from "expo-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore } from "../src/auth/store";
import LoadingView from "../src/components/LoadingView";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

export default function RootLayout() {
  const { loadToken, isLoading } = useAuthStore();

  useEffect(() => {
    loadToken();
  }, []);

  if (isLoading) return <LoadingView />;

  return (
    <QueryClientProvider client={queryClient}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="login" />
        <Stack.Screen name="auth-callback" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="field-notes/[id]"
          options={{ headerShown: true, title: "", headerBackTitle: "Notes" }}
        />
      </Stack>
    </QueryClientProvider>
  );
}
