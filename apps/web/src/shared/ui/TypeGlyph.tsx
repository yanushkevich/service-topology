/** Per-type glyphs from docs/ui-frontend-mock/Foundations.dc.html. Decorative; type is always also shown as text. */
const GLYPH: Record<string, string> = {
  gateway: 'glyph-gw',
  database: 'glyph-db',
  'search-index': 'glyph-db',
  cache: 'glyph-ca',
  topic: 'glyph-tp',
  queue: 'glyph-qu',
  exchange: 'glyph-xc',
  broker: 'glyph-cl',
  cluster: 'glyph-cl',
  namespace: 'glyph-ns',
  'external-resource': 'glyph-ex',
  connection: 'glyph-cn',
};

export function TypeGlyph({ type, size = 18 }: { type: string; size?: number }) {
  return (
    <span className="grid w-[1.45em] flex-none place-items-center" style={{ fontSize: size }} aria-hidden="true">
      <span className={`glyph ${GLYPH[type] ?? 'glyph-sv'}`} />
    </span>
  );
}
