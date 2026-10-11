import styles from './tags.module.css';

/** Marks where data comes from so mock inventory and simulated telemetry are never mistaken for observed data. */
export function DataSourceTag({ sourceLabel, isMock }: { sourceLabel: string; isMock: boolean }) {
  return (
    <span className={`${styles.tag} ${isMock ? styles.simulated : ''}`}>
      {sourceLabel}
      {isMock && ' · simulated telemetry'}
    </span>
  );
}

export function SimulatedTag({ simulated }: { simulated: boolean }) {
  return <span className={`${styles.tag} ${simulated ? styles.simulated : ''}`}>{simulated ? 'Simulated' : 'Observed'}</span>;
}
