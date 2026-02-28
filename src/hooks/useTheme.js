import { useEffect, useState } from 'preact/hooks'

export function useTheme() {
  const [systemDark, setSystemDark] = useState(() => {
    try {
      return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
    } catch {
      return false
    }
  })

  const [theme, setTheme] = useState(() => {
    try {
      const saved = window.localStorage.getItem('ui-theme')
      if (saved === 'dark' || saved === 'light' || saved === 'system') {
        return saved
      }

      return 'system'
    } catch {
      return 'system'
    }
  })

  const isDark = theme === 'system' ? systemDark : theme === 'dark'

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark)
    try {
      window.localStorage.setItem('ui-theme', theme)
    } catch {
      // ignore storage failures
    }
  }, [isDark, theme])

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!media) {
      return undefined
    }

    const handleChange = (event) => {
      setSystemDark(event.matches)
    }

    setSystemDark(media.matches)
    media.addEventListener?.('change', handleChange)

    return () => {
      media.removeEventListener?.('change', handleChange)
    }
  }, [])

  return {
    theme,
    isDark,
    setTheme
  }
}

