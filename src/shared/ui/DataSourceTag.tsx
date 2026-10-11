/** Marks where data comes from so mock inventory and simulated telemetry are never mistaken for observed data. */
export function DataSourceTag({ sourceLabel, isMock }: { sourceLabel: string; isMock: boolean }) {
  return (
    <span className={`tag ${isMock ? 'tag-simulated' : ''}`}>
      {sourceLabel}
      {isMock && ' · simulated telemetry'}
    </span>
  );
}

export function SimulatedTag({ simulated }: { simulated: boolean }) {
  return <span className={`tag ${simulated ? 'tag-simulated' : ''}`}>{simulated ? 'Simulated' : 'Observed'}</span>;
}
