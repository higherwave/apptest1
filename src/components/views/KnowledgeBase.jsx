import { useState } from 'react';
import { Breadcrumb, BreadcrumbItem, Tabs, TabList, Tab, TextInput, Tile, Button } from '@carbon/react';
import styles from './KnowledgeBase.module.scss';
import ProvenanceTag from '../ProvenanceTag';
import { LENS_NAMES, ALL_FACTS, HISTORY_BASE } from '../../data';

export default function KnowledgeBase({ verified, onVerify, onOpenWorkspace }) {
  const [lens, setLens] = useState(0);
  const facts = ALL_FACTS.filter((f) => f.lenses.includes(lens));
  const history = verified
    ? [{ what: 'Step 3 contractor skip confirmed', who: 'You', when: 'just now' }, ...HISTORY_BASE]
    : HISTORY_BASE;

  return (
    <>
      <div className={styles.page}>
        <div className={styles.header}>
          <Breadcrumb noTrailingSlash>
            <BreadcrumbItem href="#">Intelligence</BreadcrumbItem>
            <BreadcrumbItem href="#">Processes</BreadcrumbItem>
            <BreadcrumbItem href="#">HR</BreadcrumbItem>
            <BreadcrumbItem href="#" isCurrentPage>Approval chains</BreadcrumbItem>
          </Breadcrumb>

          <div className={styles.titleRow}>
            <div>
              <div className={styles.title}>New hire requisition approval</div>
              <div className={styles.subtitle}>
                Workday business process · 4 steps · last verified against config 12 minutes ago
              </div>
            </div>
            <Tabs selectedIndex={lens} onChange={({ selectedIndex }) => setLens(selectedIndex)}>
              <TabList aria-label="Audience lens">
                {LENS_NAMES.map((name) => (
                  <Tab key={name}>{name}</Tab>
                ))}
              </TabList>
            </Tabs>
          </div>

          <TextInput
            id="scoped-ask"
            labelText=""
            hideLabel
            placeholder="Ask · scoped to this chain — What happens if the hiring manager is also the cost center owner?"
            className={styles.askInput}
          />
        </div>

        <div className={styles.body}>
          <div className={styles.bodyTitle}>
            How it works today · <span className={styles.lensLabel}>{LENS_NAMES[lens]} lens</span>
          </div>
          {facts.map((f) => (
            <Tile key={f.n} className={`${styles.factTile} ${f.ask && !verified ? styles.ask : ''}`}>
              <div className={styles.factTop}>
                <div className={styles.factLeft}>
                  <div className={styles.factNumber}>{f.n}</div>
                  <div>
                    <div className={styles.factText}>{f.text}</div>
                    <div className={styles.factSource}>{f.source}</div>
                  </div>
                </div>
                <ProvenanceTag provenance={verified && f.ask ? 'confirmed' : f.provenance} />
              </div>
              {f.ask && !verified && (
                <div className={styles.factActions}>
                  <Button kind="primary" size="sm" onClick={onVerify}>Confirm</Button>
                  <Button kind="secondary" size="sm">Correct</Button>
                  <Button kind="tertiary" size="sm">Add why</Button>
                </div>
              )}
            </Tile>
          ))}
        </div>
      </div>

      <div className={styles.rightRail}>
        <Tile className={styles.usedByTile}>
          <div className={styles.usedByLabel}>Used by open changes</div>
          <Button kind="ghost" size="sm" className={styles.usedByLink} onClick={onOpenWorkspace}>
            CHG-0142 · Contractor worker type
          </Button>
          <div className={styles.usedByNote}>Step 3 is on this change&rsquo;s critical path.</div>
        </Tile>

        <div className={styles.historySection}>
          <div className={styles.historyTitle}>Change history</div>
          {history.map((h, i) => (
            <div key={i} className={styles.historyRow}>
              <div className={styles.historyDot} />
              <div>
                <div className={styles.historyWhat}>{h.what}</div>
                <div className={styles.historyMeta}>{h.who} · {h.when}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
