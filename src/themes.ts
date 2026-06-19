// Palette shared between the page (CSS variables) and the canvases (real hex values).
// Three themes imported from the SoniChain design: graphite (default, warm), slate (cool), bone (light).

export interface Theme {
  desk: string;
  bg: string;
  titlebar: string;
  panel: string;
  panel2: string;
  elev: string;
  line: string;
  lineSoft: string;
  text: string;
  muted: string;
  faint: string;
  accent: string;
  accentSoft: string;
  up: string;
  down: string;
  grid: string;
}

export type ThemeName = 'graphite' | 'slate' | 'bone';

export const THEMES: Record<ThemeName, Theme> = {
  graphite: {
    desk: '#0a0a08', bg: '#100f0c', titlebar: '#1a1814', panel: '#1b1916', panel2: '#131210',
    elev: '#232019', line: '#2c2922', lineSoft: '#211e18', text: '#ece8df', muted: '#98938a',
    faint: '#5f5b53', accent: '#d68a4f', accentSoft: 'rgba(214,138,79,0.14)',
    up: '#8aa789', down: '#c47a63', grid: 'rgba(236,232,223,0.05)'
  },
  slate: {
    desk: '#070809', bg: '#0d0f12', titlebar: '#161a1f', panel: '#161a1f', panel2: '#0f1216',
    elev: '#1d232b', line: '#262d36', lineSoft: '#1c222a', text: '#e6e9ee', muted: '#8a929c',
    faint: '#565d67', accent: '#cf8a52', accentSoft: 'rgba(207,138,82,0.14)',
    up: '#7fa0a6', down: '#bd7a66', grid: 'rgba(230,233,238,0.05)'
  },
  bone: {
    desk: '#d8d3c6', bg: '#e7e3d9', titlebar: '#ece8de', panel: '#f1eee6', panel2: '#e7e3d8',
    elev: '#f6f3ec', line: '#d4cfc1', lineSoft: '#ddd8cb', text: '#211f1a', muted: '#6f6a5f',
    faint: '#9a9486', accent: '#bd7338', accentSoft: 'rgba(189,115,56,0.14)',
    up: '#5f7d5a', down: '#b06848', grid: 'rgba(33,31,26,0.06)'
  }
};

export const THEME_LABELS: { key: ThemeName; label: string }[] = [
  { key: 'graphite', label: 'Graphite' },
  { key: 'slate', label: 'Slate' },
  { key: 'bone', label: 'Bone' }
];

// Applies a theme by setting the CSS variables on the root element.
export function applyThemeVars(el: HTMLElement, theme: Theme): void {
  (Object.keys(theme) as (keyof Theme)[]).forEach((k) => {
    el.style.setProperty(`--${k}`, theme[k]);
  });
}
