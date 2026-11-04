import { useState } from 'react'
import styles from './Avatar.module.scss'

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')

// A person's picture in a circle. Without a picture, or when it will not load, the initials stand in. Google's picture
// address checks the referrer, so none is sent.
export function Avatar({ url, name, size = 'sm' }: { url: string | null | undefined; name: string; size?: 'sm' | 'lg' }) {
  const [failed, setFailed] = useState(false)
  const showPicture = !!url && !failed
  return (
    <span className={`${styles.avatar} ${size === 'lg' ? styles.large : styles.small}`} data-testid="avatar">
      {showPicture ? <img className={styles.picture} src={url} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <span aria-hidden>{initials(name) || '?'}</span>}
    </span>
  )
}
