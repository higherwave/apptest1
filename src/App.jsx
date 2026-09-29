import { useEffect, useState } from 'react';
import styles from './App.module.scss';
import Sidebar from './components/Sidebar';
import ChangeWorkspace from './components/views/ChangeWorkspace';
import KnowledgeBase from './components/views/KnowledgeBase';
import IntegrationGraph from './components/views/IntegrationGraph';
import ReviewPackets from './components/views/ReviewPackets';
import { NAV_ITEMS } from './data';

// Hash routing: each view is deep-linkable as #/<view key> (e.g.
// #/knowledge). The hash is the source of truth — navigating writes it,
// and a hashchange listener reads it back, so back/forward and pasted
// links work with no server rewrites. Unknown or missing hashes fall back
// to the Change workspace.
const DEFAULT_VIEW = 'workspace';
const VIEW_KEYS = NAV_ITEMS.map((item) => item.key);

function viewFromHash() {
  const key = window.location.hash.replace(/^#\/?/, '');
  return VIEW_KEYS.includes(key) ? key : DEFAULT_VIEW;
}

export default function App() {
  const [view, setViewState] = useState(viewFromHash);

  useEffect(() => {
    const onHashChange = () => setViewState(viewFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const setView = (key) => {
    window.location.hash = `/${key}`;
  };
  const [verified, setVerified] = useState(false);
  const [approved, setApproved] = useState(false);

  const handleApprove = () => {
    if (verified) setApproved(true);
  };

  return (
    <div className={styles.shell}>
      <Sidebar view={view} onSelectView={setView} openChangeCount={approved ? 0 : 1} />
      <div className={styles.main}>
        {view === 'workspace' && (
          <ChangeWorkspace verified={verified} approved={approved} onOpenPackets={() => setView('packets')}
            onOpenGraph={() => setView('graph')}
          />
        )}
        {view === 'knowledge' && (
          <KnowledgeBase
            verified={verified}
            onVerify={() => setVerified(true)}
            onOpenWorkspace={() => setView('workspace')}
          />
        )}
        {view === 'graph' && <IntegrationGraph />}
        {view === 'packets' && (
          <ReviewPackets
            verified={verified}
            approved={approved}
            onApprove={handleApprove}
            onOpenWorkspace={() => setView('workspace')}
            onOpenKnowledge={() => setView('knowledge')}
          />
        )}
      </div>
    </div>
  );
}
