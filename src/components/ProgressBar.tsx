interface Props {
  received: number;
  total: number;
  missing?: number[];
}

export default function ProgressBar({ received, total, missing = [] }: Props) {
  const cells = Array.from({ length: total }, (_, i) => !missing.includes(i));
  return (
    <div className="progress-wrap">
      <div className="progress-label">{received} of {total} chunks</div>
      <div className="progress-cells" aria-hidden="true">
        {cells.map((got, i) => (
          <span key={i} className={got ? 'cell cell-got' : 'cell'} />
        ))}
      </div>
    </div>
  );
}
