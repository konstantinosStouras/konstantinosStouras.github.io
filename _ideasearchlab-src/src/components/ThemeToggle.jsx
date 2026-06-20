import { useTheme } from '../context/ThemeContext'
import styles from './ThemeToggle.module.css'

// Round light/dark theme toggle for the participant-facing headers, mirroring
// the one in the admin header. The choice persists globally (ThemeContext writes
// localStorage + data-theme on <html>), so toggling here carries through the
// whole session flow.
export default function ThemeToggle() {
  const { dark, toggle } = useTheme()
  return (
    <button
      type="button"
      className={styles.themeBtn}
      onClick={toggle}
      title="Toggle dark mode"
      aria-label="Toggle dark mode"
    >
      {dark ? '☀' : '☾'}
    </button>
  )
}
