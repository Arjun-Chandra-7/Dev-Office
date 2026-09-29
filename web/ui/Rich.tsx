import { mdInline } from '../store';

/** Renders curated text with **bold** and `code` (no HTML injection: plain React nodes only). */
export function Rich({ text }: { text: string }) {
  return (
    <>
      {mdInline(text).map((part, i) =>
        typeof part === 'string' ? <span key={i}>{part}</span> : part.b ? <strong key={i}>{part.b}</strong> : <code key={i}>{part.code}</code>,
      )}
    </>
  );
}
