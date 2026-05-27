import { create } from "zustand";
import * as SecureStore from "expo-secure-store";

const TOKEN_KEY = "bigmiles_token";

interface User {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  profile_image_url: string | null;
}

interface AuthState {
  token: string | null;
  user: User | null;
  isLoading: boolean;
  setToken: (token: string) => Promise<void>;
  loadToken: () => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: User) => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: null,
  user: null,
  isLoading: true,

  setToken: async (token: string) => {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    set({ token });
  },

  loadToken: async () => {
    try {
      const token = await SecureStore.getItemAsync(TOKEN_KEY);
      set({ token, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  logout: async () => {
    const { token } = get();
    if (token) {
      try {
        await fetch("https://bigmiles.app/api/auth/mobile-logout", {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        // best-effort
      }
    }
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    set({ token: null, user: null });
  },

  setUser: (user: User) => set({ user }),
}));
