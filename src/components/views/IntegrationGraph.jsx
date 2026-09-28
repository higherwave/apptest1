import { useState, useMemo } from 'react';
import { Button } from '@carbon/react';
import styles from './IntegrationGraph.module.scss';
import ProvenanceTag from '../ProvenanceTag';
import { LANES, LANE_X, NODES, EDGES, EDGE_DASH } from '../../data';

const CANVAS_WIDTH = 804;
const CANVAS_HEIGHT = 760;

function edgePath(a, b) {
  if (a.lane === b.lane) {
    return `M${a.x + 82} ${a.y + 64} L${b.x + 82} ${b.y}`;
  }
  const x1 = a.x + 164;
  const y1 = a.y + 32;
  const x2 = b.x;
  const y2 = b.y + 32;
  if (Math.abs(a.lane - b.lane) > 1) {
    return `M${x1} ${y1} C${x1 + 20} ${y1} ${x1 + 20} ${y2} ${x1 + 40} ${y2} L${x2} ${y2}`;
  }
  const mid = (x1 + x2) / 2;
  return `M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`;
}

export default function IntegrationGraph() {
  const [selId, setSelId] = useState('ap');
  const positions = useMemo(
    () => Object.fromEntries(NODES.map((n) => [n.id, { x: LANE_X[n.lane], y: n.y, lane: n.lane }])),
    []
  );
  const edges = EDGES.map(([a, b, kind]) => ({
    d: edgePath(positions[a], positions[b]),
    dash: EDGE_DASH[kind],
  }));
  const sel = NODES.find((n) => n.id === selId);

  return (
    <>
      <div className={styles.page}>
        <div className={styles.header}>
          <div className={styles.titleRow}>
            <div className={styles.titleWord}>Impact of</div>
            <div className={styles.scopeChip}>Workday · Worker Type</div>
            <div className={styles.scopeMeta}>scoped to CHG-0142 · 2 hops</div>
          </div>
          <div className={styles.legend}>
            <div className={styles.legendItem}>
              <svg width="28" height="8"><line x1="0" y1="4" x2="28" y2="4" stroke="var(--cds-text-primary)" strokeWidth="2" /></svg>
              Data flow
            </div>
            <div className={styles.legendItem}>
              <svg width="28" height="8"><line x1="0" y1="4" x2="28" y2="4" stroke="var(--cds-text-primary)" strokeWidth="2" strokeDasharray="6 4" /></svg>
              Trigger
            </div>
            <div className={styles.legendItem}>
              <svg width="28" height="8"><line x1="0" y1="4" x2="28" y2="4" stroke="var(--cds-text-primary)" strokeWidth="2" strokeDasharray="1 4" strokeLinecap="round" /></svg>
              Approval
            </div>
            <div className={styles.legendItem}>
              <span className={styles.legendSwatch} />
              Indirect
            </div>
          </div>
        </div>

        <div className={styles.canvasWrap}>
          <div className={styles.canvas}>
            <div className={styles.lanes}>
              {LANES.map((name) => (
                <div key={name} className={styles.lane}>{name}</div>
              ))}
            </div>
            <svg width={CANVAS_WIDTH} height={CANVAS_HEIGHT} style={{ position: 'absolute', inset: 0 }}>
              {edges.map((e, i) => (
                <path
                  key={i}
                  d={e.d}
                  fill="none"
                  stroke="var(--cds-text-primary)"
                  strokeWidth="2"
                  strokeDasharray={e.dash}
                  strokeLinecap="round"
                />
              ))}
            </svg>
            {NODES.map((n) => {
              const on = n.id === selId;
              const isSource = n.source;
              return (
                <Button
                  key={n.id}
                  kind="ghost"
                  className={styles.node}
                  onClick={() => setSelId(n.id)}
                  style={{
                    left: positions[n.id].x,
                    top: positions[n.id].y,
                    background: isSource ? 'var(--cds-support-error)' : on ? 'var(--cds-background-inverse)' : 'var(--cds-background)',
                    color: isSource || on ? 'var(--cds-text-inverse)' : 'var(--cds-text-primary)',
                    border: isSource || on ? '1.5px solid transparent' : n.indirect ? '1.5px dashed var(--cds-border-strong)' : '1.5px solid var(--cds-border-strong)',
                  }}
                >
                  <span className={styles.nodeType}>{n.type}</span>
                  <span className={styles.nodeName}>{n.name}</span>
                </Button>
              );
            })}
          </div>
        </div>
      </div>

      <div className={styles.rightRail}>
        <div>
          <div className={styles.selMeta}>{LANES[sel.lane]} · {sel.type}</div>
          <div className={styles.selName}>{sel.name}</div>
          <ProvenanceTag provenance={sel.provenance} />
        </div>
        <div className={styles.impactTile}>
          <div className={styles.impactLabel}>What this means for CHG-0142</div>
          <div className={styles.impactText}>{sel.impact}</div>
        </div>
        <div>
          <div className={styles.evidenceLabel}>Evidence</div>
          <div className={styles.evidenceText}>{sel.evidence}</div>
        </div>
        <div className={styles.hint}>Click any node to inspect it.</div>
      </div>
    </>
  );
}
