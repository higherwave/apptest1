import {
  Button,
  Tile,
  DataTable,
  Table,
  TableHead,
  TableRow,
  TableHeader,
  TableBody,
  TableCell,
} from '@carbon/react';
import styles from './ChangeWorkspace.module.scss';
import ProvenanceTag from '../ProvenanceTag';
import { STAGES_BASE, SPEC_ROWS, ENTITIES, CONNECTORS } from '../../data';

const headers = [
  { key: 'sys', header: 'System' },
  { key: 'change', header: 'Proposed change' },
  { key: 'basis', header: 'Basis' },
];

export default function ChangeWorkspace({ approved, verified, onOpenPackets, onOpenGraph }) {
  const stages = STAGES_BASE.map((s) => {
    if (s.state === 'checkpoint') {
      return { ...s, status: approved ? 'Approved' : verified ? 'Ready to approve' : 'Awaiting you', state: approved ? 'done' : 'now' };
    }
    if (s.state === 'coding') {
      return { ...s, status: approved ? 'Running' : 'Queued', state: approved ? 'now' : 'queued' };
    }
    return s;
  });

  const rows = SPEC_ROWS.map((r, i) => ({
    id: String(i),
    sys: r.sys,
    change: r.change,
    basis: <ProvenanceTag provenance={r.provenance} />,
  }));

  return (
    <>
      <div className={styles.page}>
        <div className={styles.topBar}>
          <div>
            <div className={styles.topBarMeta}>HR · CHG-0142</div>
            <div className={styles.topBarTitle}>Add Contractor worker type to hiring flow</div>
          </div>
          <div className={styles.topBarActions}>
            <Button kind="secondary" size="sm">Pause agents</Button>
            <Button kind="secondary" size="sm">Share</Button>
          </div>
        </div>

        <div className={styles.stageStrip}>
          {stages.map((s) => (
            <Tile key={s.name} className={`${styles.stageTile} ${s.state === 'now' ? styles.current : ''}`}>
              <div className={styles.stageKind}>{s.kind}</div>
              <div className={styles.stageName}>{s.name}</div>
              {s.status && <div className={styles.stageStatus}>{s.status}</div>}
            </Tile>
          ))}
        </div>

        <div className={styles.body}>
          <Tile className={styles.checkpointTile}>
            <div>
              <div className={styles.checkpointLabel}>Human checkpoint · before coding</div>
              <div className={styles.checkpointText}>
                Design agent proposes 8 changes across 4 systems. One relies on an inferred rule.
              </div>
            </div>
            <Button kind="tertiary" size="md" onClick={onOpenPackets}>
              Review packet
            </Button>
          </Tile>

          <div className={styles.specSection}>
            <div className={styles.specHeader}>
              <div className={styles.specTitle}>Design spec</div>
              <div className={styles.specMeta}>Generated 09:42 · context snapshot ctx-7f3a</div>
            </div>
            <div className={styles.specTable}>
              <DataTable rows={rows} headers={headers} isSortable={false}>
                {({ rows, headers, getTableProps, getHeaderProps, getRowProps }) => (
                  <Table {...getTableProps()} size="md">
                    <TableHead>
                      <TableRow>
                        {headers.map((header) => (
                          <TableHeader {...getHeaderProps({ header })} key={header.key}>
                            {header.header}
                          </TableHeader>
                        ))}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {rows.map((row) => (
                        <TableRow {...getRowProps({ row })} key={row.id}>
                          {row.cells.map((cell) => (
                            <TableCell key={cell.id}>{cell.value}</TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </DataTable>
            </div>
          </div>
        </div>
      </div>

      <div className={styles.rightRail}>
        <div className={styles.railSection}>
          <div className={styles.railHeader}>
            <div className={styles.railSectionTitle}>Entities in scope</div>
            <Button kind="ghost" size="sm" className={styles.railLink} onClick={onOpenGraph}>
              Open graph
            </Button>
          </div>
          {ENTITIES.map((e) => (
            <Tile key={e.name} className={styles.entityTile}>
              <div className={styles.entityMeta}>{e.sys} · {e.type}</div>
              <div className={styles.entityRow}>
                <div className={styles.entityName}>{e.name}</div>
                <ProvenanceTag provenance={e.provenance} />
              </div>
            </Tile>
          ))}
        </div>
        <div className={styles.connectors}>
          <div className={styles.connectorsHeading}>Connectors · read-only</div>
          <div className={styles.connectorList}>
            {CONNECTORS.map((c) => (
              <div key={c.name} className={styles.connectorRow}>
                <span className={styles.connectorName}>
                  <span className={`${styles.dot} ${styles[c.status]}`} />
                  {c.name}
                </span>
                <span className={styles.connectorWhen}>{c.when}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
