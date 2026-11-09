import { CreateQueue } from './pages/CreateQueue.tsx';
import { Home } from './pages/Home.tsx';
import { HostPage } from './pages/HostPage.tsx';
import { StudentPage } from './pages/StudentPage.tsx';
import { useLocation } from './lib/router.ts';
import { hostedQueues } from './lib/storage.ts';
import './App.css';

/**
 * Routes
 *   /                     home: enter a join code, or start hosting
 *   /new                  create a queue (instructor)
 *   /q/:code              student page (the QR code / shared link)
 *   /host/:code?key=…     instructor dashboard (secret key in the link)
 */
function App() {
  const { path, params } = useLocation();
  const [, section, rawCode] = path.split('/');
  const code = (rawCode ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  if (section === 'new') return <CreateQueue />;
  if (section === 'q' && code) return <StudentPage key={code} code={code} />;
  if (section === 'host' && code) {
    const key = params.get('key') ?? hostedQueues.find(code)?.key ?? '';
    return <HostPage key={code} code={code} hostKey={key} justCreated={params.get('created') === '1'} />;
  }
  return <Home />;
}

export default App;
