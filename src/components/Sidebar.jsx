import { Button } from '@carbon/react';
import styles from './Sidebar.module.scss';
import { NAV_ITEMS, DOMAINS } from '../data';

export default function Sidebar({ view, onSelectView, openChangeCount }) {
  return (
    <div className={styles.sidebar}>
      <div className={styles.wordmark}>whirl</div>
      <div className={styles.nav}>
        {NAV_ITEMS.map((item) => (
          <Button
            key={item.key}
            kind="ghost"
            size="md"
            className={`${styles.navItem} ${item.key === view ? styles.active : ''}`}
            onClick={() => onSelectView(item.key)}
          >
            {item.label}
            {item.key === 'packets' && openChangeCount > 0 && (
              <span className={styles.navBadge}>{openChangeCount}</span>
            )}
          </Button>
        ))}
      </div>
      <div>
        <div className={styles.domainsHeading}>Domains</div>
        <div className={styles.domains}>
          {DOMAINS.map((d) => (
            <div key={d.name} className={`${styles.domainRow} ${d.active ? styles.active : ''}`}>
              {d.name}
              <span>{d.count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
