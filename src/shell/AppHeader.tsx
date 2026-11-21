import { ChevronDown, Help, Launch, Settings as SettingsIcon } from '@carbon/icons-react'
import { Button, Popover, PopoverContent } from '@carbon/react'
import { useState, type MouseEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useMe } from '../api/hooks'
import { AccessBar } from '../auth/AccessBar'
import { AiBadge } from '../auth/AiBadge'
import { useTour } from '../tour/tourContext'
import { AppMark, LauncherDots } from './AppIcons'
import { APPS, appFor, HOME, type AppDef } from './apps'
import styles from './AppHeader.module.scss'
import brand from '../../brand/brand.json'

const cx = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(' ')

// The dark bar across the top of every app: the launcher (all the apps and the suite home), the current app's mark and name, its top-level items, and at the
// far right what is the same everywhere (the AI badge, the tour, Admin, the account). On a narrow screen the items fold into one menu.
// Links carry data-label so tests and scripts find them by name, not by their markup.
export function AppHeader() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const me = useMe()
  const tour = useTour()
  const [menuOpen, setMenuOpen] = useState(false)
  const [launcherOpen, setLauncherOpen] = useState(false)

  const app = appFor(pathname)
  const settings = pathname.startsWith('/settings')
  // Admin is for owners and editors; a viewer does not see it at all.
  const canSettings = me.data?.role === 'owner' || me.data?.role === 'editor'
  // Pulse is a preview: the server says whether this person may see it, and nobody else gets even a launcher card.
  const apps: AppDef[] = [APPS['signal-flow'], ...(me.data?.features.pulse ? [APPS.pulse] : [])]
  const items = app.items.map((i) => ({ ...i, active: !settings && i.match(pathname) }))
  const current = settings ? 'Admin' : (items.find((i) => i.active)?.label ?? app.name)
  // The links out of the app are brand settings; with none, they are not shown.
  const external = [
    { label: 'Prototype gallery', href: brand.galleryUrl as string | undefined },
    { label: 'Decision Guides', href: brand.decisionGuidesUrl as string | undefined },
  ].filter((l): l is { label: string; href: string } => !!l.href)

  const go = (to: string) => (event: MouseEvent) => {
    event.preventDefault()
    setMenuOpen(false)
    setLauncherOpen(false)
    navigate(to)
  }

  return (
    <header className={styles.bar}>
      <div className={styles.launcherWrap} onKeyDown={(e) => e.key === 'Escape' && setLauncherOpen(false)}>
        <Popover open={launcherOpen} align="bottom-start" dropShadow onRequestClose={() => setLauncherOpen(false)}>
          <Button kind="ghost" size="md" className={cx(styles.launcher, launcherOpen && styles.launcherOpen)} aria-label="All apps" aria-haspopup="true" aria-expanded={launcherOpen} data-testid="app-launcher" onClick={() => setLauncherOpen((o) => !o)}>
            <LauncherDots />
          </Button>
          <PopoverContent className={styles.panel}>
            <div data-testid="launcher-panel">
              <p className={styles.panelTitle}>Your apps</p>
              <div className={styles.cards}>
                <a href={HOME.to} data-label="Platform Insights home" className={styles.card} onClick={go(HOME.to)}>
                  <img className={styles.cardIcon} src={HOME.icon} alt="" width={44} height={44} />
                  <span className={styles.cardName}>{HOME.label}</span>
                  <span className={styles.cardBlurb}>{HOME.blurb}</span>
                </a>
                {apps.map((a) => (
                  <a key={a.key} href={a.items[0].to} data-label={a.name} aria-current={a.key === app.key ? 'true' : undefined} className={cx(styles.card, a.key === app.key && styles.cardCurrent)} onClick={go(a.items[0].to)}>
                    <img className={styles.cardIcon} src={a.icon} alt="" width={44} height={44} />
                    <span className={styles.cardName}>{a.name}</span>
                    <span className={styles.cardBlurb}>{a.blurb}</span>
                  </a>
                ))}
              </div>
              {external.length > 0 && (
                <div className={styles.more}>
                  {external.map((l) => (
                    <a key={l.label} href={l.href} data-label={l.label} target="_blank" rel="noopener noreferrer" className={styles.moreLink}>
                      {l.label}
                      <Launch size={16} aria-hidden />
                      <span className={styles.srOnly}> (opens in a new tab)</span>
                    </a>
                  ))}
                </div>
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <a href={app.items[0].to} className={styles.appBrand} data-testid="app-brand" aria-label={`${app.name} home`} onClick={go(app.items[0].to)}>
        <span className={styles.mark}>
          <AppMark app={app.key} />
        </span>
        <span className={styles.appName}>{app.name}</span>
      </a>

      <nav className={styles.items} aria-label="Navigation" data-nav>
        {items.map((i) => (
          <a key={i.to} href={i.to} data-label={i.label} aria-current={i.active ? 'page' : undefined} className={cx(styles.item, i.active && styles.itemActive)} onClick={go(i.to)}>
            {i.label}
          </a>
        ))}
      </nav>

      <div className={styles.menu} data-menu>
        <Button kind="ghost" size="sm" className={styles.menuButton} renderIcon={ChevronDown} aria-haspopup="true" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
          {current}
        </Button>
        {menuOpen && (
          <div className={styles.menuList} role="menu">
            {items.map((i) => (
              <a key={i.to} href={i.to} role="menuitem" aria-current={i.active ? 'page' : undefined} className={cx(styles.menuItem, i.active && styles.menuItemActive)} onClick={go(i.to)}>
                {i.label}
              </a>
            ))}
            {canSettings && (
              <a href="/settings/categories" role="menuitem" aria-current={settings ? 'page' : undefined} className={cx(styles.menuItem, settings && styles.menuItemActive)} onClick={go('/settings/categories')}>
                Admin
              </a>
            )}
            {apps
              .filter((a) => a.key !== app.key)
              .map((a) => (
                <a key={a.key} href={a.items[0].to} role="menuitem" className={styles.menuItem} onClick={go(a.items[0].to)}>
                  {a.name}
                </a>
              ))}
            {external.map((l) => (
              <a key={l.label} href={l.href} role="menuitem" target="_blank" rel="noopener noreferrer" className={styles.menuItem}>
                {l.label}
              </a>
            ))}
          </div>
        )}
      </div>

      <div className={styles.right}>
        <span className={styles.aiBadge}>
          <AiBadge />
        </span>
        <Button kind="ghost" size="sm" className={styles.tour} renderIcon={Help} aria-label="Take a tour" data-testid="take-a-tour" onClick={tour.openWelcome}>
          <span className={styles.tourText}>Take a tour</span>
        </Button>
        {canSettings && (
          <nav className={styles.admin} aria-label="Admin" data-nav>
            <a href="/settings/categories" data-label="Admin" aria-current={settings ? 'page' : undefined} className={cx(styles.item, settings && styles.itemActive)} onClick={go('/settings/categories')}>
              Admin
              <SettingsIcon size={16} aria-hidden />
            </a>
          </nav>
        )}
        <div className={styles.access}>
          <AccessBar />
        </div>
      </div>
    </header>
  )
}
