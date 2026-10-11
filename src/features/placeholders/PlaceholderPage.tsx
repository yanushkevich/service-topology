
interface PlaceholderPageProps {
  title: string;
  description: string;
  milestone: string;
}

/** Clearly labeled stand-in for sections that are not built yet, so no route leads to a broken page. */
export function PlaceholderPage({ title, description, milestone }: PlaceholderPageProps) {
  return (
    <div className="max-w-[620px] px-6.5 py-8">
      <p className="m-0 mb-2 font-mono text-xs tracking-[0.06em] text-fg-3 uppercase">Not yet available · {milestone}</p>
      <h1 className="m-0 mb-2 text-2xl font-semibold tracking-[-0.01em]">{title}</h1>
      <p className="m-0 text-fg-2">{description}</p>
    </div>
  );
}
