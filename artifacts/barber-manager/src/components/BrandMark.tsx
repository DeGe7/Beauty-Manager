type BrandMarkProps = {
  className?: string;
};

export function BrandMark({ className }: BrandMarkProps) {
  return (
    <svg
      viewBox="0 0 120 120"
      fill="none"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <rect
        x="7"
        y="7"
        width="106"
        height="106"
        rx="23"
        fill="#17150F"
        stroke="#766338"
        strokeWidth="1.5"
      />
      <rect
        x="30"
        y="31"
        width="60"
        height="54"
        stroke="#D8B85F"
        strokeWidth="4"
      />
      <text
        x="60"
        y="68"
        textAnchor="middle"
        fill="#E6CB76"
        fontFamily="Arial, Helvetica, sans-serif"
        fontSize="21"
        fontWeight="700"
        letterSpacing="-1.3"
      >
        BM
      </text>
    </svg>
  );
}
