"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, X } from "lucide-react";
import { SearchableSelect } from "./searchable-select";

type Choice = { value: string; label: string; group?: string };

export function ConfirmationDialog({ title, description, confirmLabel, onConfirm, onClose, busy = false, error = "" }: {
  title: string; description: string; confirmLabel: string;
  onConfirm: () => void; onClose: () => void; busy?: boolean; error?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const descriptionId = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    cancelButton.current?.focus({ preventScroll: true });
    return () => dialog?.close();
  }, []);
  return (
    <dialog ref={ref} className="task-dialog confirmation-dialog" aria-label={title} aria-describedby={descriptionId}
      onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
      <header>
        <h2>{title}</h2>
        <button type="button" className="icon-button" aria-label="关闭" disabled={busy} onClick={onClose}><X size={20} /></button>
      </header>
      <p id={descriptionId} className="confirmation-description">{description}</p>
      {error && <p className="task-error" role="alert">{error}</p>}
      <footer className="confirmation-actions">
        <button ref={cancelButton} type="button" className="button secondary" disabled={busy} onClick={onClose}>取消</button>
        <button type="button" className="button danger" disabled={busy} onClick={onConfirm}>{busy ? "处理中…" : confirmLabel}</button>
      </footer>
    </dialog>
  );
}

export function SelectControl(props: {
  label: string; value: string; options: Choice[]; onChange: (value: string) => void; disabled?: boolean; searchable?: boolean; searchLabel?: string;
}) {
  return props.searchable || props.options.length > 15
    ? <SearchableSelect {...props} />
    : <SimpleSelectControl {...props} />;
}

function SimpleSelectControl({ label, value, options, onChange, disabled = false }: {
  label: string; value: string; options: Choice[];
  onChange: (value: string) => void; disabled?: boolean;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const selected = options.findIndex((option) => option.value === value);

  useEffect(() => {
    const list = menu.current;
    if (!open || !list) return;
    function position() {
      const box = trigger.current?.getBoundingClientRect();
      if (!box || !list) return;
      const below = window.innerHeight - box.bottom - 12;
      const above = box.top - 12;
      const upwards = below < Math.min(240, list.scrollHeight) && above > below;
      list.style.width = `${box.width}px`;
      list.style.maxHeight = `${Math.max(80, Math.min(280, upwards ? above : below))}px`;
      list.style.left = `${box.left}px`;
      list.style.top = `${upwards ? Math.max(8, box.top - Math.min(list.scrollHeight, 280, above) - 6) : box.bottom + 6}px`;
    }
    list.showPopover();
    position();
    list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
    function outside(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      if (list.matches(":popover-open")) list.hidePopover();
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [open]);

  function choose(index: number) {
    if (!options[index]) return;
    onChange(options[index].value);
    setOpen(false);
    trigger.current?.focus();
  }
  function highlight(index: number) {
    setActive(index);
    menu.current?.children[index]?.scrollIntoView({ block: "nearest" });
  }
  return (
    <div ref={root} className="task-select">
      <button ref={trigger} type="button" className="task-select-trigger" role="combobox"
        aria-label={label} aria-expanded={open} aria-controls={id} aria-haspopup="listbox"
        aria-activedescendant={open ? `${id}-${active}` : undefined} disabled={disabled}
        onBlur={(event) => { if (!root.current?.contains(event.relatedTarget)) setOpen(false); }}
        onClick={() => { setActive(Math.max(0, selected)); setOpen(!open); }}
        onKeyDown={(event) => {
          if (event.key === "Tab" && open) {
            // Remove the popover before native focus navigation chooses the next field.
            menu.current?.hidePopover();
            setOpen(false);
            return;
          }
          if (["ArrowDown", "ArrowUp", "Home", "End", "Enter", " ", "Escape"].includes(event.key)) {
            if (event.key === "Escape" && !open) return;
            event.preventDefault(); event.stopPropagation();
            if (event.key === "Escape") { setOpen(false); return; }
            if (!open) { setActive(Math.max(0, selected)); setOpen(true); return; }
            if (event.key === "Enter" || event.key === " ") choose(active);
            else highlight(event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : (active + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
          } else if (open && event.key.length === 1) {
            const match = options.findIndex((option) => option.label.toLowerCase().startsWith(event.key.toLowerCase()));
            if (match >= 0) highlight(match);
          }
        }}>
        <span>{options[selected]?.label ?? "请选择"}</span><ChevronDown size={18} aria-hidden="true" />
      </button>
      <div ref={menu} id={id} role="listbox" aria-label={label} popover="manual" className="task-select-menu">
        {options.map((option, index) => (
          <div key={option.value} id={`${id}-${index}`} role="option" aria-selected={option.value === value}
            className={index === active ? "highlighted" : undefined}
            onPointerDown={(event) => event.preventDefault()} onPointerMove={() => setActive(index)}
            onClick={() => choose(index)}>
            <span>{option.label}</span>{option.value === value && <Check size={17} aria-hidden="true" />}
          </div>
        ))}
      </div>
    </div>
  );
}

function beijingToday() {
  return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
}
function dateAfter(date: string, days: number) {
  const stamp = new Date(`${date}T00:00:00Z`);
  stamp.setUTCDate(stamp.getUTCDate() + days);
  return stamp.toISOString().slice(0, 10);
}

export function TaskDeadline({ label, value, onChange, disabled = false }: {
  label: string; value: string; onChange: (value: string) => void; disabled?: boolean;
}) {
  const id = useId();
  const date = value.split("T")[0];
  const [hour, setHour] = useState(value.split("T")[1]?.split(":")[0] ?? "18");
  const [minute, setMinute] = useState(value.split("T")[1]?.split(":")[1] ?? "00");
  const [month, setMonth] = useState(() => (date || beijingToday()).slice(0, 7));
  const [open, setOpen] = useState(false);
  const calendar = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [year, monthNumber] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, monthNumber - 1, 1));
  const start = dateAfter(first.toISOString().slice(0, 10), -(first.getUTCDay() + 6) % 7);
  const dates = Array.from({ length: 42 }, (_, index) => dateAfter(start, index));
  const today = beijingToday();
  function update(dateValue: string, hourValue = hour, minuteValue = minute) {
    onChange(dateValue ? `${dateValue}T${hourValue ? hourValue.padStart(2, "0") : ""}:${minuteValue ? minuteValue.padStart(2, "0") : ""}` : "");
  }
  function choose(dateValue: string) {
    update(dateValue); setMonth(dateValue.slice(0, 7)); setOpen(false); trigger.current?.focus();
  }
  function changeMonth(offset: number) {
    setMonth(new Date(Date.UTC(year, monthNumber - 1 + offset, 1)).toISOString().slice(0, 7));
  }
  return (
    <fieldset className="task-deadline" disabled={disabled}>
      <legend>{label}</legend>
      <div className="task-deadline-row">
        <button ref={trigger} type="button" className="task-date-trigger" aria-label={`${label}：选择日期`}
          aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
          <CalendarDays size={18} aria-hidden="true" /><span>{date ? date.replaceAll("-", "/") : "选择日期"}</span>
        </button>
        <div className="task-time-inputs">
          <input aria-label={`${label}：小时`} type="number" inputMode="numeric" min={0} max={23} step={1}
            value={hour} disabled={!date || disabled} required={!!date}
            onChange={(event) => { setHour(event.target.value); update(date, event.target.value); }}
            onBlur={() => { if (hour) setHour(hour.padStart(2, "0")); }} />
          <span aria-hidden="true">:</span>
          <input aria-label={`${label}：分钟`} type="number" inputMode="numeric" min={0} max={59} step={1}
            value={minute} disabled={!date || disabled} required={!!date}
            onChange={(event) => { setMinute(event.target.value); update(date, hour, event.target.value); }}
            onBlur={() => { if (minute) setMinute(minute.padStart(2, "0")); }} />
        </div>
      </div>
      <div className="task-date-shortcuts">
        {[ ["今天", 0], ["明天", 1], ["一周后", 7] ].map(([text, offset]) => (
          <button key={text} type="button" onClick={() => choose(dateAfter(today, Number(offset)))}>{text}</button>
        ))}
        <button type="button" disabled={!date || disabled} onClick={() => { onChange(""); setOpen(false); setHour("18"); setMinute("00"); }}>清空</button>
      </div>
      {open && <div ref={calendar} id={id} className="task-calendar" role="group" aria-label="选择截止日期"
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
        }}>
        <header>
          <button type="button" aria-label="上个月" onClick={() => changeMonth(-1)}><ChevronLeft size={18} /></button>
          <SelectControl label="年份" value={String(year)} options={Array.from({ length: 11 }, (_, i) => ({ value: String(year - 5 + i), label: `${year - 5 + i}年` }))} onChange={(v) => setMonth(`${v}-${String(monthNumber).padStart(2, "0")}`)} />
          <SelectControl label="月份" value={String(monthNumber)} options={Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}月` }))} onChange={(v) => setMonth(`${year}-${v.padStart(2, "0")}`)} />
          <button type="button" aria-label="下个月" onClick={() => changeMonth(1)}><ChevronRight size={18} /></button>
        </header>
        <div className="task-calendar-weekdays" aria-hidden="true">{["一", "二", "三", "四", "五", "六", "日"].map((day) => <span key={day}>{day}</span>)}</div>
        <div className="task-calendar-days">
          {dates.map((day) => <button key={day} type="button" data-date={day}
            aria-label={day} aria-pressed={day === date} aria-current={day === today ? "date" : undefined}
            tabIndex={day === (date && dates.includes(date) ? date : `${month}-01`) ? 0 : -1}
            className={day.slice(0, 7) !== month ? "outside-month" : undefined}
            onClick={() => choose(day)} onKeyDown={(event) => {
              const shifts: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
              if (event.key in shifts) {
                event.preventDefault();
                const next = dateAfter(day, shifts[event.key]);
                const target = calendar.current?.querySelector<HTMLButtonElement>(`[data-date="${next}"]`);
                if (target) { event.currentTarget.tabIndex = -1; target.tabIndex = 0; target.focus(); }
              }
            }}>{Number(day.slice(-2))}</button>)}
        </div>
      </div>}
      <small className="task-muted">{date ? "时间按北京时间保存，小时 00–23，分钟 00–59。" : "未设置截止时间；选日期后可直接填写时、分。"}</small>
    </fieldset>
  );
}
