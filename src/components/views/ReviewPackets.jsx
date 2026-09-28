import { useState } from 'react';
import { Button, Tabs, TabList, Tab } from '@carbon/react';
import styles from './ReviewPackets.module.scss';
import ProvenanceTag from '../ProvenanceTag';
import { SYS_TABS, DIFFS, AUDIT_BASE } from '../../data';

export default function ReviewPackets({ verified, approved, onApprove, onOpenWorkspace, onOpenKnowledge }) {
  const [sysTab, setSysTab] = useState(0);

  const gate = approved
    ? { text: 'Packet approved. Handed off to ServiceNow and Jira; coding agent is running.', link: 'Back to workspace', tone: 'ready', go: onOpenWorkspace }
    : verified
    ? { text: 'All claims verified. This packet can be approved.', link: 'View knowledge page', tone: 'ready', go: onOpenKnowledge }
    : { text: 'Approval blocked: 1 change relies on an inferred rule (cost center approval skip).', link: 'Verify in knowledge base', tone: 'blocked', go: onOpenKnowledge };

  const audit = [
    ...(approved ? [{ what: 'You approved packet v3', when: 'just now', snap: 'ctx-7f3a' }] : []),
    ...(verified ? [{ what: 'You confirmed step 3 contractor skip', when: 'just now', snap: 'ctx-7f3a' }] : []),
    ...AUDIT_BASE,
  ];

  return (
    <>
      <div className={styles.page}>
        <div className={styles.header}>
          <div className={styles.headerTop}>
            <div>
              <div className={styles.headerMeta}>Change packet · CHG-0142 · v3</div>
              <div className={styles.headerTitle}>Add Contractor worker type to hiring flow</div>
            </div>
            <div className={styles.headerActions}>
              <Button kind="secondary">Request changes</Button>
              <Button kind="primary" disabled={!verified || approved} onClick={onApprove}>
                {approved ? 'Approved' : 'Approve packet'}
              </Button>
            </div>
          </div>
          <Tabs selectedIndex={sysTab} onChange={({ selectedIndex }) => setSysTab(selectedIndex)}>
            <TabList aria-label="System">
              {SYS_TABS.map((t) => (
                <Tab key={t.name}>{t.name} {t.count}</Tab>
              ))}
            </TabList>
          </Tabs>
        </div>

        <div className={styles.body}>
          <div className={`${styles.gate} ${styles[gate.tone]}`}>
            <div>{gate.text}</div>
            <Button kind="ghost" size="sm" onClick={gate.go}>{gate.link}</Button>
          </div>

          {DIFFS.map((d) => (
            <div key={d.title} className={styles.diff}>
              <div className={styles.diffHead}>
                <div className={styles.diffTitle}>{d.title}</div>
                <ProvenanceTag provenance={d.provenance} />
              </div>
              <div className={styles.diffLines}>
                {d.lines.map((line, i) => (
                  <div
                    key={i}
                    className={`${styles.diffLine} ${line.sign === '+' ? styles.add : line.sign === '-' ? styles.remove : ''}`}
                  >
                    <span className={styles.diffSign}>{line.sign}</span>
                    <span>{line.text}</span>
                  </div>
                ))}
              </div>
              <div className={styles.diffEvidence}>
                <span className={styles.diffEvidenceLabel}>Evidence</span>
                <span>{d.evidence}</span>
              </div>
              {d.comment && (
                <div className={styles.diffComment}>
                  <div className={styles.commentAvatar}>PR</div>
                  <div>
                    <div className={styles.commentAuthor}>Priya R. · HRIS</div>
                    <div>{d.comment}</div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className={styles.rightRail}>
        <div>
          <div className={styles.railTitle}>Handoff</div>
          <div className={styles.handoffTile}>
            <div className={styles.handoffTitle}>ServiceNow change request</div>
            <div className={styles.handoffMeta}>Normal change · CAB Thursday</div>
          </div>
          <div className={styles.handoffTile}>
            <div className={styles.handoffTitle}>Jira · HRIS-2210</div>
            <div className={styles.handoffMeta}>Workday build tasks, 3 subtasks</div>
          </div>
          <div className={styles.handoffNote}>
            Whirl is read-only. Approved packets are handed off; your team applies them.
          </div>
        </div>
        <div>
          <div className={styles.railTitle}>Audit trail</div>
          {audit.map((a, i) => (
            <div key={i} className={styles.auditRow}>
              <div className={styles.auditWhat}>{a.what}</div>
              <div className={styles.auditMeta}>{a.when} · {a.snap}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
