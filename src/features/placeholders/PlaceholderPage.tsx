import styles from './placeholder.module.css';

interface PlaceholderPageProps {
  title: string;
  description: string;
  milestone: string;
}

/** Clearly labeled stand-in for sections that are not built yet, so no route leads to a broken page. */
export function PlaceholderPage({ title, description, milestone }: PlaceholderPageProps) {
  return (
    <div className={styles.page}>
      <p className={styles.tag}>Not yet available · {milestone}</p>
      <h1 className={styles.title}>{title}</h1>
      <p className={styles.description}>{description}</p>
    </div>
  );
}
