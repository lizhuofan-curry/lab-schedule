"use client";

import { Palette } from "lucide-react";
import { useSyncExternalStore } from "react";

const themes = [
  { id: "neural", label: "神经信号", colors: ["#e87078", "#4c78b5"] },
  { id: "ocean", label: "深海脑电", colors: ["#12a1ad", "#164e75"] },
  { id: "green", label: "脑电绿", colors: ["#d46b47", "#245c4d"] },
  { id: "night", label: "夜间实验", colors: ["#78989d", "#1b2635"] },
] as const;

type ThemeId = typeof themes[number]["id"];

function isTheme(value: string | null): value is ThemeId {
  return themes.some((item) => item.id === value);
}

function subscribe(callback: () => void) {
  window.addEventListener("bci-theme-change", callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener("bci-theme-change", callback);
    window.removeEventListener("storage", callback);
  };
}

function getThemeSnapshot(): ThemeId {
  const current = document.documentElement.getAttribute("data-theme");
  return isTheme(current) ? current : "neural";
}

function selectStoredTheme(next: ThemeId) {
  document.documentElement.setAttribute("data-theme", next);
  window.localStorage.setItem("bci-schedule-theme", next);
  window.dispatchEvent(new Event("bci-theme-change"));
}

export function ThemeSwitcher({ compact = false }: { compact?: boolean }) {
  const theme = useSyncExternalStore(subscribe, getThemeSnapshot, () => "neural");

  return (
    <section className={compact ? "theme-switcher compact-theme-switcher" : "theme-switcher"} aria-label="界面主题">
      <div className="theme-heading"><Palette size={15} /><span>主题风格</span></div>
      <div className="theme-options">
        {themes.map((item) => (
          <button
            key={item.id}
            type="button"
            className={theme === item.id ? "theme-option active" : "theme-option"}
            onClick={() => selectStoredTheme(item.id)}
            aria-pressed={theme === item.id}
            title={item.label}
          >
            <span className="theme-swatch" style={{ background: `linear-gradient(135deg, ${item.colors[0]} 0 49%, ${item.colors[1]} 51% 100%)` }} />
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
