import { useState } from 'react';
import SenderView from './components/SenderView';
import ReceiverView from './components/ReceiverView';

type Mode = 'home' | 'send' | 'receive';

export default function App() {
  const [mode, setMode] = useState<Mode>('home');

  if (mode === 'send') return <SenderView onBack={() => setMode('home')} />;
  if (mode === 'receive') return <ReceiverView onBack={() => setMode('home')} />;

  return (
    <div className="view home">
      <h1>QR Share</h1>
      <p className="tagline">Send a file to another device with QR codes and a camera. No network, no server, no account.</p>
      <div className="home-buttons">
        <button className="big-btn" onClick={() => setMode('send')}>Send</button>
        <button className="big-btn" onClick={() => setMode('receive')}>Receive</button>
      </div>
    </div>
  );
}
