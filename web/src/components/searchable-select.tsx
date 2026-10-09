"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";

type Choice = { value: string; label: string; group?: string };

export function SearchableSelect({ label, value, options, onChange, disabled = false, searchLabel = `搜索${label}` }: {
  label: string; value: string; options: Choice[]; onChange: (value: string) => void; disabled?: boolean; searchLabel?: string;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const choices = options.filter(option => option.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const selected = options.find(option => option.value === value);

  useEffect(() => {
    const popup = panel.current;
    if (!open || !popup) return;
    function position() {
      const box = trigger.current?.getBoundingClientRect();
      if (!box || !popup) return;
      const below = innerHeight - box.bottom - 12, above = box.top - 12;
      const upwards = below < 240 && above > below;
      const height = Math.max(80, Math.min(360, upwards ? above : below));
      Object.assign(popup.style, { width: `${box.width}px`, left: `${box.left}px`, maxHeight: `${height}px`, top: `${upwards ? Math.max(8, box.top - Math.min(height, popup.scrollHeight) - 6) : box.bottom + 6}px` });
    }
    popup.showPopover(); position();
    search.current?.focus({ preventScroll: true });
    function outside(event: PointerEvent) { if (!root.current?.contains(event.target as Node)) setOpen(false); }
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      if (popup.matches(":popover-open")) popup.hidePopover();
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [open]);

  function choose(option: Choice) { onChange(option.value); setOpen(false); trigger.current?.focus({ preventScroll: true }); }
  function show() { setQuery(""); setActive(Math.max(0, options.findIndex(option => option.value === value))); setOpen(true); }
  function highlight(index: number) { setActive(index); panel.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" }); }
  return <div ref={root} className="task-select searchable-select" onBlur={event => { if (!root.current?.contains(event.relatedTarget)) setOpen(false); }}>
    <button ref={trigger} type="button" className="task-select-trigger" disabled={disabled} aria-label={label} aria-haspopup="dialog" aria-expanded={open} aria-controls={`${id}-panel`}
      onClick={() => open ? setOpen(false) : show()}
      onKeyDown={event => { if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); show(); } }}>
      <span>{selected?.label ?? "请选择"}</span><ChevronDown size={18} aria-hidden="true" />
    </button>
    <div ref={panel} id={`${id}-panel`} popover="manual" role="dialog" aria-label={`${label}选项`} tabIndex={-1} className="searchable-select-panel"
      onKeyDown={event => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
        if (["ArrowDown", "ArrowUp"].includes(event.key) && choices.length) { event.preventDefault(); highlight((active + (event.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length); }
        if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); if (choices[active]) choose(choices[active]); }
      }}>
      <div className="searchable-select-search"><Search size={16} aria-hidden="true" /><input ref={search} role="combobox" aria-label={searchLabel} placeholder={`${searchLabel}…`} value={query} aria-autocomplete="list" aria-controls={`${id}-list`} aria-expanded={open} aria-activedescendant={choices[active] ? `${id}-${active}` : undefined} onChange={event => { setQuery(event.target.value); setActive(0); }} /></div>
      <div id={`${id}-list`} role="listbox" aria-label={label} className="searchable-select-options">
        {choices.map((option, index) => <div key={option.value}>
          {option.group && option.group !== choices[index - 1]?.group && <div className="searchable-select-group">{option.group}</div>}
          <div id={`${id}-${index}`} data-index={index} role="option" aria-selected={option.value === value} className={`searchable-select-option${active === index ? " highlighted" : ""}`} onPointerMove={() => setActive(index)} onPointerDown={event => event.preventDefault()} onClick={() => choose(option)}>
            <span>{option.label}</span>{value === option.value && <Check size={17} aria-hidden="true" />}
          </div>
        </div>)}
        {!choices.length && <p className="searchable-select-empty" role="status">未找到匹配项，请换个关键词搜索。</p>}
      </div>
    </div>
  </div>;
}
