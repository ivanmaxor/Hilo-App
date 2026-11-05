import '@xterm/xterm/css/xterm.css';
import './styles.css';
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { app, focusActive, initController, offerSetupGuide, useStore, view } from './controller';
import { ContextMenu, Modals, Toasts } from './ui/dialogs';
import { Sidebar } from './ui/sidebar';
import { Tabs, Workspace } from './ui/workspace';
import { terminalBackground } from './term/terminals';

const NARROW_WIDTH = 820;

function App() {
  const { state } = useStore(app);
  const v = useStore(view);
  const [narrow, setNarrow] = useState(window.innerWidth < NARROW_WIDTH);

  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < NARROW_WIDTH);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = state.settings.theme;
    document.documentElement.style.setProperty('--term-bg', terminalBackground(state.settings));
  }, [state.settings.theme, state.settings.terminalColors]);

  return (
    <div class={`app${v.focused ? '' : ' unfocused'}`}>
      <Sidebar narrow={narrow} />
      <main class="main">
        <Tabs />
        <Workspace />
      </main>
      <Modals />
      <ContextMenu />
      <Toasts />
    </div>
  );
}

/**
 * El ícono de "trabajando" alterna cada 550 ms, igual que el título de Claude. Con una animación
 * CSS, aun por pasos, el compositor repinta a la tasa de la pantalla: 4-6 % de un núcleo.
 */
setInterval(() => {
  const root = document.documentElement;
  if (document.hasFocus() && document.querySelector('.st-half')) root.classList.toggle('icon-tick');
}, 550);

void initController().then(() => {
  render(<App />, document.getElementById('root')!);
  focusActive();
  void offerSetupGuide();
});
