import { CalendarPlus } from "lucide-react";

export function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty-state">
      <CalendarPlus size={28} strokeWidth={1.5} />
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}
