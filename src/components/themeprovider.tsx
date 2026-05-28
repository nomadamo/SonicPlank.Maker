import { createContext, useContext, useEffect, useState } from "react"

import { ThemeProps, useThemeContext } from "@radix-ui/themes";

type Theme = "dark" | "light" | "system"

type ThemeProviderProps = {
  children: React.ReactNode
  defaultTheme?: Theme
  defaultAppearance?: "inherit" | "light" | "dark"
  storageKey?: string
}

type ThemeProviderState = {
  theme: Theme
  setTheme: (theme: Theme) => void
  appearance: "inherit" | "light" | "dark",
  setAppearance: (theme: ThemeProps) => void
}

const initialState: ThemeProviderState = {
  theme: "system",
  setTheme: () => null,
  appearance: "inherit",
  setAppearance: () => null
}

const ThemeProviderContext = createContext<ThemeProviderState>(initialState)

export function ThemeProvider({
  children,
  defaultTheme = "system",
  defaultAppearance = "inherit",
  storageKey = "ui-theme",
  ...props
}: ThemeProviderProps) {

  const appear = useThemeContext().appearance

  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem(storageKey + "_theme") as Theme) || defaultTheme
  )

  const [appearance, setAppearance] = useState(
    () => (localStorage.getItem(storageKey + "_appearance") as "inherit" | "light" | "dark") || appear || defaultAppearance
  )

  useEffect(() => {
    const root = window.document.documentElement

    root.classList.remove("light", "dark")

    if (theme === "system") {
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
        .matches
        ? "dark"
        : "light"

      root.classList.add(systemTheme)
      return
    }

    root.classList.add(theme)
  }, [theme, appearance])

  const value = {
    theme,
    setTheme: (theme: Theme) => {
      localStorage.setItem(storageKey + "_theme", theme)
      setTheme(theme)
      setAppearance("inherit");
    },
    appearance,
    setAppearance: (themeProps: ThemeProps) => {
      if (themeProps.appearance === 'inherit') {
        localStorage.setItem(storageKey + "_appearance", theme)
        setTheme('system');
        setAppearance("inherit");
      }
    }
  }

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  )
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext)

  if (context === undefined)
    throw new Error("useTheme must be used within a ThemeProvider")

  return context
}
