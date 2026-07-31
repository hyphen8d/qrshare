const STEPS = ['Connect', 'Transfer', 'Done'];

interface Props {
  current: 0 | 1 | 2;
}

export default function StepIndicator({ current }: Props) {
  return (
    <div className="step-indicator">
      {STEPS.map((label, i) => (
        <div key={label} className={i === current ? 'step step-current' : i < current ? 'step step-done' : 'step'}>
          <span className="step-dot">{i < current ? '✓' : i + 1}</span>
          <span className="step-label">{label}</span>
        </div>
      ))}
    </div>
  );
}
