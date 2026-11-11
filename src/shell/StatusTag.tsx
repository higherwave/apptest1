import { Tag } from '@carbon/react'
import styles from './StatusTag.module.scss'

// The badge beside a project's name: Analyzed in a light, quiet green, Draft in gray.
export function StatusTag({ status }: { status: string }) {
  return status === 'analyzed' ? (
    <Tag size="sm" type="green" className={styles.analyzed}>
      Analyzed
    </Tag>
  ) : (
    <Tag size="sm" type="gray">
      Draft
    </Tag>
  )
}
