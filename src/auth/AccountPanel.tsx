import { Activity, Logout, UserMultiple } from '@carbon/icons-react'
import { Button, Popover, PopoverContent, Tag } from '@carbon/react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Avatar } from './Avatar'
import { signOut } from './authClient'
import styles from './AccountPanel.module.scss'

type Props = { name: string; email: string; role: string; avatarUrl: string | null; statusLabel?: string; onStatus?: () => void }

// The signed-in person: their picture in the header; clicked, a panel with a larger picture, name, email and the account links.
export function AccountPanel({ name, email, role, avatarUrl, statusLabel, onStatus }: Props) {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const choose = (action: () => void) => () => {
    setOpen(false)
    action()
  }
  return (
    <Popover open={open} align="bottom-end" dropShadow onRequestClose={() => setOpen(false)}>
      <Button kind="ghost" size="sm" className={styles.trigger} aria-label="Account" aria-haspopup="true" aria-expanded={open} data-testid="account-button" onClick={() => setOpen((o) => !o)}>
        <Avatar url={avatarUrl} name={name} />
      </Button>
      <PopoverContent className={styles.panel}>
        <div className={styles.who} data-testid="account-panel">
          <Avatar url={avatarUrl} name={name} size="lg" />
          <p className={styles.name}>{name}</p>
          <p className={styles.email}>{email}</p>
          <Tag size="sm" type="gray">
            {role}
          </Tag>
        </div>
        <div className={styles.links}>
          <Button kind="ghost" size="md" className={styles.link} renderIcon={UserMultiple} onClick={choose(() => navigate('/members'))}>
            Members
          </Button>
          {onStatus && statusLabel && (
            <Button kind="ghost" size="md" className={styles.link} renderIcon={Activity} onClick={choose(onStatus)}>
              {statusLabel}
            </Button>
          )}
          <Button kind="ghost" size="md" className={styles.link} renderIcon={Logout} onClick={choose(signOut)}>
            Sign out
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
