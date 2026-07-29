const STATUS_MAP = {
  PENDING:   { className: 'badge-pending',   label: 'Pending' },
  CONFIRMED: { className: 'badge-confirmed', label: 'Confirmed' },
  CANCELLED: { className: 'badge-cancelled', label: 'Cancelled' },
  COMPLETED: { className: 'badge-completed', label: 'Completed' },
}

export default function StatusBadge({ status }) {
  const config = STATUS_MAP[status] ?? STATUS_MAP.PENDING
  return <span className={config.className}>{config.label}</span>
}
