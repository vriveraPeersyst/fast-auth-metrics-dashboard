export function FastAuthLogo({ variant = "default" }: { variant?: "default" | "dark" }) {
  const color = variant === "dark" ? "var(--color-surface)" : "var(--color-ink)";

  return (
    <span className="fastAuthLogo" aria-label="FastAuth" role="img">
      <span className="fastAuthLogo__fast" style={{ color }}>Fast</span>
      <span className="fastAuthLogo__auth">Auth</span>
      <span className="fastAuthLogo__dot" style={{ color }}>.</span>
    </span>
  );
}
