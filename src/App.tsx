import { AppShell } from './components/layout/AppShell';
import { ErrorBoundary } from './components/common/ErrorBoundary';

function App() {
  // Last net: the header, the panels and the dialogs sit outside the boundaries of each zone.
  return <ErrorBoundary section="la aplicación"><AppShell /></ErrorBoundary>;
}

export default App;
