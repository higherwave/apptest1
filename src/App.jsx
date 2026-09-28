import { useState } from 'react';
import styles from './App.module.scss';
import Sidebar from './components/Sidebar';
import ChangeWorkspace from './components/views/ChangeWorkspace';
import KnowledgeBase from './components/views/KnowledgeBase';
import IntegrationGraph from './components/views/IntegrationGraph';
import ReviewPackets from './components/views/ReviewPackets';

export default function App() {
  const [view, setView] = useState('workspace');
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
