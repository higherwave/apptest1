import { Tag } from '@carbon/react';
import styles from './ProvenanceTag.module.scss';
import { PROVENANCE } from '../data';

export default function ProvenanceTag({ provenance }) {
  const p = PROVENANCE[provenance];
  if (!p) return null;
  return (
    <Tag type="outline" size="sm" className={styles[provenance]}>
      {p.label}
    </Tag>
  );
}
