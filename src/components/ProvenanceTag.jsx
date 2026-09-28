import { Tag } from '@carbon/react';
import { PROVENANCE } from '../data';

export default function ProvenanceTag({ provenance }) {
  const p = PROVENANCE[provenance];
  if (!p) return null;
  return (
    <Tag type={p.tagType} size="sm">
      {p.label}
    </Tag>
  );
}
