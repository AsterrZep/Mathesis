// i18n.ts — inicialización de i18next (Fase 2: ES/EN)
// Idioma = preferencia de APP en localStorage ("mathesis.lang"), no del
// documento (un documento puede abrirse en cualquier idioma).

import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { en } from "./locales/en";
import { es } from "./locales/es";

const LS_LANG = "mathesis.lang";

export function currentLang(): string {
  try {
    const saved = localStorage.getItem(LS_LANG);
    if (saved === "es" || saved === "en") return saved;
  } catch {
    // sin localStorage (entorno raro) → idioma del sistema
  }
  return navigator.language.startsWith("es") ? "es" : "en";
}

export function setLang(lang: "es" | "en"): void {
  try {
    localStorage.setItem(LS_LANG, lang);
  } catch {
    // ignorar
  }
  void i18n.changeLanguage(lang);
}

void i18n.use(initReactI18next).init({
  resources: {
    es: { translation: es },
    en: { translation: en },
  },
  lng: currentLang(),
  fallbackLng: "es",
  interpolation: { escapeValue: false },
});

export default i18n;
