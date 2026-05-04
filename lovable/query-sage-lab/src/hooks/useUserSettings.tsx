/**
 * LOCAL_MODE user settings.
 *
 * Theme and language preferences are persisted to the FastAPI backend
 * via /api/user-settings (which writes the user_settings table in the
 * local Postgres). On first load, fetched once; on save, PUT once and
 * apply locally. No Supabase auth state machine.
 */

import { ReactNode, createContext, useContext, useEffect, useState } from "react";
import { api } from "@/lib/api";
import i18n from "@/i18n/config";

interface UserSettings {
  darkMode: boolean;
  language: string;
}

interface UserSettingsContextType {
  settings: UserSettings;
  setSettings: (settings: UserSettings) => void;
  saveSettings: (settings: UserSettings) => Promise<void>;
  loading: boolean;
}

const defaultSettings: UserSettings = {
  darkMode: localStorage.getItem("darkMode") === "true",
  language: localStorage.getItem("i18nextLng")?.split("-")[0] || "en",
};

const UserSettingsContext = createContext<UserSettingsContextType | undefined>(undefined);

function applySettings(newSettings: UserSettings) {
  document.documentElement.classList.toggle("dark", newSettings.darkMode);
  localStorage.setItem("darkMode", String(newSettings.darkMode));
  window.dispatchEvent(new CustomEvent("themeChange", { detail: { dark: newSettings.darkMode } }));
  i18n.changeLanguage(newSettings.language);
}

export const UserSettingsProvider = ({ children }: { children: ReactNode }) => {
  const [settings, setSettingsState] = useState<UserSettings>(defaultSettings);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.userSettings
      .get()
      .then((data) => {
        if (cancelled) return;
        const next = { darkMode: !!data.dark_mode, language: data.language || "en" };
        setSettingsState(next);
        applySettings(next);
      })
      .catch(() => {
        // Backend unavailable, fall back to localStorage defaults.
        applySettings(defaultSettings);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setSettings = (s: UserSettings) => {
    setSettingsState(s);
    applySettings(s);
  };

  const saveSettings = async (newSettings: UserSettings) => {
    await api.userSettings.update({
      dark_mode: newSettings.darkMode,
      language: newSettings.language,
    });
    setSettings(newSettings);
  };

  return (
    <UserSettingsContext.Provider value={{ settings, setSettings: setSettingsState, saveSettings, loading }}>
      {children}
    </UserSettingsContext.Provider>
  );
};

export const useUserSettings = () => {
  const context = useContext(UserSettingsContext);
  if (!context) {
    throw new Error("useUserSettings must be used within a UserSettingsProvider");
  }
  return context;
};
