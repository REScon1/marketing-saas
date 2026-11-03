// Dočasný vstup pro vizuální QA render enginu (vite → /lab.html). Není součástí aplikace.
import { createRoot } from 'react-dom/client';
import { StudioLab } from './pages/StudioLab';
import './styles.css';
import './studio/studio.css';

createRoot(document.getElementById('root')!).render(<StudioLab />);
