import { Redirect } from "expo-router";
import { useAuthStore } from "../src/auth/store";
import LoadingView from "../src/components/LoadingView";

export default function Index() {
  const { token, isLoading } = useAuthStore();

  if (isLoading) return <LoadingView />;
  if (token) return <Redirect href="/(tabs)/notes" />;
  return <Redirect href="/login" />;
}
