import { ref } from 'vue'

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'ztube-theme'
const theme = ref<Theme>('light')

function preferredTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    // Storage can be unavailable in private browsing contexts.
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(value: Theme) {
  theme.value = value
  document.documentElement.classList.toggle('dark', value === 'dark')
  document.documentElement.classList.toggle('light', value === 'light')
  document.documentElement.style.colorScheme = value
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', value === 'dark' ? '#1f2430' : '#f3f0e8')
}

export function initializeTheme() {
  applyTheme(preferredTheme())
}

export function useTheme() {
  function toggleTheme() {
    const next = theme.value === 'dark' ? 'light' : 'dark'
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // The active page still receives the requested theme.
    }
    applyTheme(next)
  }

  return { theme, toggleTheme }
}
