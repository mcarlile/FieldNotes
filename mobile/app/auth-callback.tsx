import { useEffect } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useAuthStore } from "../src/auth/store";
import { apiJson } from "../src/api/client";
import LoadingView from "../src/components/LoadingView";

interface User {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  profile_image_url: string | null;
}

export default function AuthCallback() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { setToken, setUser } = useAuthStore();
  const router = useRouter();

  useEffect(() => {
    if (!token) {
      router.replace("/login");
      return;
    }

    (async () => {
      try {
        await setToken(token);
        // Verify token works and fetch user profile
        const user = await apiJson<User>("/api/me");
        setUser(user);
        router.replace("/(tabs)/notes");
      } catch {
        router.replace("/login");
      }
    })();
  }, [token]);

  return <LoadingView />;
}
