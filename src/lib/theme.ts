// Astryx theme for the app: dark, calm, one accent. The accent is per studio (from the DB),
// so the theme is created at runtime with defineTheme — documented for dynamic branding.
import { defineTheme } from '@astryxdesign/core/theme';
import { themes, defaultThemeSlug } from '../astryx-themes';

const base = themes[defaultThemeSlug];
const cache = new Map<string, ReturnType<typeof defineTheme>>();

function readableOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.35 ? '#140F12' : '#FFFFFF';
}

export function studioTheme(accent = '#E8A598') {
  const key = accent.toUpperCase();
  const hit = cache.get(key);
  if (hit) return hit;
  const theme = defineTheme({
    name: `studio-${key.slice(1).toLowerCase()}`,
    extends: base,
    color: { accent: [key, key], neutralStyle: 'warm' },
    typography: {
      scale: { base: 15, ratio: 1.2 },
      body: { family: 'Manrope Variable', fallbacks: "Manrope, -apple-system, 'Segoe UI', Roboto, sans-serif" },
      heading: { family: 'Manrope Variable', fallbacks: "Manrope, -apple-system, 'Segoe UI', sans-serif" },
    },
    radius: { base: 4, multiplier: 1.5 },
    tokens: {
      '--color-background-body': ['#0B0A0C', '#0B0A0C'],
      '--color-background-surface': ['#141215', '#141215'],
      '--color-background-card': ['#161417', '#161417'],
      '--color-background-popover': ['#1C191D', '#1C191D'],
      '--color-background-muted': ['#1E1B1F', '#1E1B1F'],
      '--color-border': ['rgba(255,255,255,0.08)', 'rgba(255,255,255,0.08)'],
      '--color-border-emphasized': ['rgba(255,255,255,0.16)', 'rgba(255,255,255,0.16)'],
      '--color-text-primary': ['#F5EFF1', '#F5EFF1'],
      '--color-text-secondary': ['#A9A0A6', '#A9A0A6'],
      '--color-on-accent': [readableOn(key), readableOn(key)],
    },
  });
  cache.set(key, theme);
  return theme;
}
