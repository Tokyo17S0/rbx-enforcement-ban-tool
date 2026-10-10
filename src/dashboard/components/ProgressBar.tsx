import { TONE_FILL, type Tone } from "./status";
import { cx } from "./utils";

export function ProgressBar({
  value,
  max,
  tone,
  animate = false,
  label,
}: {
  value: number;
  max: number;
  tone: Tone;
  animate?: boolean;
  label: string;
}) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;

  return (
    <div
      className="h-3 w-full overflow-hidden rounded-full bg-fg/8"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(ratio * 100)}
    >
      <div
        className={cx(
          "h-full rounded-full transition-[width] duration-1000 ease-linear motion-reduce:transition-none",
          TONE_FILL[tone],
          animate && "bar-live",
        )}
        style={{ width: `${Math.max(3, ratio * 100)}%` }}
      />
    </div>
  );
}
