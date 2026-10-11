import styles from './glyphs.module.css';

/** Per-type glyphs from docs/ui-frontend-mock/Foundations.dc.html. Decorative; type is always also shown as text. */
const GLYPH: Record<string, string | undefined> = {
  gateway: styles.gw,
  database: styles.db,
  'search-index': styles.db,
  cache: styles.ca,
  topic: styles.tp,
  queue: styles.qu,
  exchange: styles.xc,
  broker: styles.cl,
  cluster: styles.cl,
  namespace: styles.ns,
  'external-resource': styles.ex,
  connection: styles.cn,
};

export function TypeGlyph({ type, size = 18 }: { type: string; size?: number }) {
  return (
    <span className={styles.glyphBox} style={{ fontSize: size }} aria-hidden="true">
      <span className={`${styles.sh} ${GLYPH[type] ?? styles.sv}`} />
    </span>
  );
}
