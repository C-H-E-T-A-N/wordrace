// Game pictures are shown as Twemoji SVG images (copied into /emoji by scripts/copy-emoji.mjs), not as text:
// colour-emoji fonts aren't drawn the same way on every phone/browser, images are.

// Twemoji file name: lowercase hex code points joined by "-"; the FE0F variation selector is dropped unless the
// emoji is a ZWJ sequence (same rule as Twemoji's own parser).
export function emojiFile(char) {
  const cps = [...char].map(c => c.codePointAt(0));
  const keep = cps.includes(0x200d) ? cps : cps.filter(cp => cp !== 0xfe0f);
  return keep.map(cp => cp.toString(16)).join('-');
}

// Emoji that rain down when the winner is announced.
export const RAIN = ['🎉', '🥳', '🎊', '🏆', '⭐', '✨', '🎈', '👑', '💥', '🪅'];
