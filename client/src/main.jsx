import { createRoot } from 'react-dom/client';
// Fonts ship with the game (no CDN), so every phone and PC shows the same letters and emoji, even offline on LAN.
import '@fontsource-variable/nunito';
import '@fontsource-variable/fredoka';
import twemojiUrl from 'twemoji-colr-font/twemoji.woff2';
import App from './App.jsx';
import './styles.css';

// Twemoji color emoji (COLR font: Chrome, Safari, Firefox, Edge). Only for emoji code points, so normal text stays
// in Nunito; `swap` shows system emoji for the moment it takes to load instead of blank boxes.
const twemoji = new FontFace('Twemoji', `url(${twemojiUrl}) format('woff2')`, {
  display: 'swap',
  unicodeRange: 'U+00A9, U+00AE, U+203C-3299, U+FE0F, U+200D, U+20E3, U+1F000-1FAFF, U+E0020-E007F',
});
document.fonts.add(twemoji);
twemoji.load().catch(() => { /* fall back to the system's emoji */ });

createRoot(document.getElementById('root')).render(<App />);
