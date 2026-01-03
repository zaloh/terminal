import { useState, useEffect } from 'react';
import SessionList from './components/SessionList';
import TerminalView from './components/TerminalView';

function App() {
  const [sessionName, setSessionName] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const session = params.get('session');
    if (session) {
      setSessionName(session);
    }
  }, []);

  const handleSelectSession = (name: string) => {
    setSessionName(name);
    window.history.pushState({}, '', `?session=${name}`);
  };

  const handleBack = () => {
    setSessionName(null);
    window.history.pushState({}, '', '/');
  };

  useEffect(() => {
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      const session = params.get('session');
      setSessionName(session);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  if (!sessionName) {
    return <SessionList onSelectSession={handleSelectSession} />;
  }

  return <TerminalView sessionName={sessionName} onBack={handleBack} />;
}

export default App;
