interface StatusDotProps {
  color: "green" | "yellow" | "red" | "blue" | "purple" | "accent";
  pulse?: boolean;
  size?: number;
}

const colorMap: Record<StatusDotProps["color"], string> = {
  green: "bg-green",
  yellow: "bg-yellow",
  red: "bg-red",
  blue: "bg-blue",
  purple: "bg-tool-bash",
  accent: "bg-accent",
};

export default function StatusDot({
  color,
  pulse = false,
  size = 6,
}: StatusDotProps) {
  return (
    <span
      className={`inline-block rounded-full ${colorMap[color]} ${pulse ? "animate-pulse" : ""}`}
      style={{ width: size, height: size, minWidth: size }}
    />
  );
}
