import { Logout, TaskView } from '@carbon/icons-react'
import { Button, Popover, PopoverContent, Tag } from '@carbon/react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Avatar } from './Avatar'
import { signOut } from './authClient'
import styles from './AccountPanel.module.scss'

type Props = { name: string; email: string; role: string; avatarUrl: string | null }

// The signed-in person: their picture in the header; clicked, a panel with a larger picture, name, email, role and Sign out.
export function AccountPanel({ name, email, role, avatarUrl }: Props) {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
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
          <Button kind="ghost" size="md" className={styles.link} renderIcon={TaskView} data-testid="my-reviews" onClick={() => {
              setOpen(false)
              navigate('/launches')
            }}>
            My reviews
          </Button>
          <Button kind="ghost" size="md" className={styles.link} renderIcon={Logout} onClick={() => {
              setOpen(false)
              void signOut()
            }}>
            Sign out
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
