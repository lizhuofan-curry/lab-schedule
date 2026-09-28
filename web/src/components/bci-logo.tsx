export function BciLogo({ className = "" }: { className?: string }) {
  return (
    <span className={`bci-logo ${className}`} aria-hidden="true">
      <svg viewBox="0 0 64 64" role="img">
        <path className="brain-half" d="M29.5 10.5c-4.8-3.4-11.3.2-10.8 6.1-5.6-.5-9.1 5.7-6.1 10.3-4.6 2.4-4.6 9.2 0 11.6-2.1 5.4 2.7 10.8 8.1 9.5.2 5.4 6.1 8.2 10.3 4.8V12.4c0-.8-.6-1.5-1.5-1.9Z" />
        <path className="brain-fold" d="M20 18c4.1-.7 7.3 2.5 6.7 6.4M13.8 29.2c4.3-1.7 8.7.8 9.3 5.1M20.4 47.6c-1-4.6 2.3-8.5 6.8-8.5M12.9 39c3.5-.6 6.3 1.2 7.4 4.2" />
        <path className="circuit-half" d="M35 10.2h7.2l10.3 10.4v22.8L42.2 53.8H35V10.2Z" />
        <path className="circuit-line" d="M36 18h6l4 4v5h6M35 31h9l4-4M35 42h7l4-4h6M42 53v-6l4-4M42 18v-5" />
        <circle className="circuit-node" cx="42" cy="18" r="2.2" />
        <circle className="circuit-node" cx="48" cy="27" r="2.2" />
        <circle className="circuit-node" cx="42" cy="42" r="2.2" />
        <circle className="circuit-node" cx="46" cy="47" r="2.2" />
      </svg>
    </span>
  );
}
