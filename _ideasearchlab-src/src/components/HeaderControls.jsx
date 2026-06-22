import ThemeToggle from './ThemeToggle'
import ProfileMenu from './ProfileMenu'
import styles from './HeaderControls.module.css'

// The participant-facing top-right controls: the light/dark theme toggle and
// the account/profile menu. Bundled together so every page shows the exact same
// cluster, keeping them present (and the theme + signed-in account reachable)
// throughout the whole session flow — not just on the Join screen.
export default function HeaderControls() {
  return (
    <div className={styles.controls}>
      <ThemeToggle />
      <ProfileMenu />
    </div>
  )
}
