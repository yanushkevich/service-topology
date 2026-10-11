import { Link } from 'react-router';
import styles from './placeholder.module.css';

export function NotFoundPage() {
  return (
    <div className={styles.page}>
      <p className={styles.tag}>404</p>
      <h1 className={styles.title}>Page not found</h1>
      <p className={styles.description}>
        This address does not match any section. <Link to="/map">Go to the Service Map</Link>.
      </p>
    </div>
  );
}
