"use client";

import * as Select from "@radix-ui/react-select";
import { LiveRunJournal } from "./live-run-journal";
import { createPortal } from "react-dom";
import { Check, ChevronDown, ChevronUp, X, PanelRight } from "./icons";
import { createContext, useContext, useEffect, useId, useRef, useState, useSyncExternalStore, type ButtonHTMLAttributes, type CSSProperties, type PointerEvent, type ReactNode } from "react";

const ModalContainer = createContext<HTMLDialogElement | null>(null);

export function useModalContainer() {
  return useContext(ModalContainer);
}

export function Button({ className = "", variant = "outline", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "outline" | "ghost" | "danger" }) {
  return <button type="button" className={`button button-${variant} ${className}`} {...props} />;
}

export type SelectOption<T extends string = string> = { value: T; label: string };

export function SelectField<T extends string>({ label, value, options, onChange, placeholder = "Выбрать", className = "", disabled = false }: {
  label: string; value: T; options: readonly SelectOption<T>[]; onChange: (value: T) => void; placeholder?: string; className?: string; disabled?: boolean;
}) {
  const container = useModalContainer();
  return <Select.Root value={value} onValueChange={(entry) => onChange(entry as T)}>
    <Select.Trigger className={`control select-trigger ${className}`} aria-label={label} disabled={disabled || options.length === 0}>
      <span className="select-value"><Select.Value placeholder={placeholder} /></span>
      <Select.Icon asChild><ChevronDown size={15} aria-hidden="true" /></Select.Icon>
    </Select.Trigger>
    <Select.Portal container={container}>
      <Select.Content className="select-content" position="popper" align="start" sideOffset={4} collisionPadding={8}>
        <Select.ScrollUpButton className="select-scroll"><ChevronUp size={14} /></Select.ScrollUpButton>
        <Select.Viewport className="select-viewport">
          {options.map((option) => <Select.Item key={option.value} value={option.value} className="select-item">
            <Select.ItemText>{option.label}</Select.ItemText>
            <Select.ItemIndicator asChild><Check size={15} aria-hidden="true" /></Select.ItemIndicator>
          </Select.Item>)}
        </Select.Viewport>
        <Select.ScrollDownButton className="select-scroll"><ChevronDown size={14} /></Select.ScrollDownButton>
      </Select.Content>
    </Select.Portal>
  </Select.Root>;
}

export function Checkbox({ label, checked, onChange, className = "" }: { label: string; checked: boolean; onChange: () => void; className?: string }) {
  return <button type="button" className={`checkbox ${className}`} role="checkbox" aria-label={label} aria-checked={checked} onClick={onChange}>
    {checked && <Check size={15} aria-hidden="true" />}
  </button>;
}

export function Status({ tone = "neutral", children }: { tone?: "neutral" | "green" | "blue" | "amber" | "red"; children: ReactNode }) {
  return <span className={`status tone-${tone}`}><span className="status-dot" aria-hidden="true" />{children}</span>;
}

export const HeaderActions = createContext<HTMLDivElement | null>(null);

const inspectorWidthKey = "hashpix-inspector-width";
const widthListeners = new Set<() => void>();

export function watchViewport(listener: () => void) {
  window.addEventListener("resize", listener);
  return () => window.removeEventListener("resize", listener);
}

function watchInspectorWidth(listener: () => void) {
  widthListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => { widthListeners.delete(listener); window.removeEventListener("storage", listener); };
}

let inspectorWidthSession: number | null = null;

function savedInspectorWidth() {
  if (inspectorWidthSession !== null) return inspectorWidthSession;
  try {
    const width = Number(window.localStorage.getItem(inspectorWidthKey));
    return width >= 248 && width <= 560 ? width : null;
  } catch { return null; }
}

function rememberInspectorWidth(width: number) {
  try {
    window.localStorage.setItem(inspectorWidthKey, String(width));
    inspectorWidthSession = null;
  } catch { inspectorWidthSession = width; }
  widthListeners.forEach((listener) => listener());
}

export function Frame({ children, inspector, initialInspectorWidth = 320, className = "", canvasFocus = false }: {
  children: ReactNode; inspector: ReactNode; initialInspectorWidth?: number; className?: string; canvasFocus?: boolean;
}) {
  const header = useContext(HeaderActions);
  const inspectorId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const edgeTab = useRef<HTMLButtonElement>(null);
  const resize = useRef<{ x: number; start: number; width: number } | null>(null);
  const [open, setOpen] = useState<boolean | null>(null);
  const [drawer, setDrawer] = useState({ canvasFocus, hovered: false, toggled: false });
  if (drawer.canvasFocus !== canvasFocus) setDrawer({ canvasFocus, hovered: false, toggled: false });
  const peek = canvasFocus && (drawer.hovered || drawer.toggled);
  const [draftWidth, setDraftWidth] = useState<number | null>(null);
  const viewport = useSyncExternalStore(watchViewport, () => window.innerWidth, () => 1440);
  const docked = viewport >= 1100;
  const uiScale = useSyncExternalStore(watchViewport, () => Number.parseFloat(getComputedStyle(document.documentElement).fontSize) / 16, () => 1.1);
  const maxWidth = Math.max(248, Math.min(560, Math.floor(viewport * 0.43 / uiScale)));
  const savedWidth = useSyncExternalStore(watchInspectorWidth, savedInspectorWidth, () => null);
  const dockVisible = open ?? docked;
  const visible = canvasFocus ? peek : dockVisible;
  const width = draftWidth ?? savedWidth ?? initialInspectorWidth;

  useEffect(() => {
    if (!canvasFocus || !drawer.hovered) return;
    function clearHover() {
      setDrawer((previous) => ({ ...previous, hovered: false }));
    }
    function trackPointer(event: globalThis.PointerEvent) {
      if (event.pointerType !== "mouse" || !(event.target instanceof Element)) return;
      if (!panelRef.current?.contains(event.target) && !event.target.closest("[data-radix-popper-content-wrapper]")) clearHover();
    }
    // A popover can unmount while the pointer is over it, without a leave event on the drawer.
    window.addEventListener("pointermove", trackPointer);
    window.addEventListener("blur", clearHover);
    return () => {
      window.removeEventListener("pointermove", trackPointer);
      window.removeEventListener("blur", clearHover);
    };
  }, [canvasFocus, drawer.hovered]);

  function constrainWidth(value: number) {
    return Math.max(248, Math.min(maxWidth, Math.round(value)));
  }

  function endResize(event: PointerEvent<HTMLDivElement>, save: boolean) {
    const drag = resize.current;
    if (!drag) return;
    resize.current = null;
    if (save) rememberInspectorWidth(drag.width);
    setDraftWidth(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function dismissDrawer() {
    setDrawer({ canvasFocus, hovered: false, toggled: false });
  }

  return (
    <div className={`frame ${dockVisible && !canvasFocus ? "frame-open" : "frame-closed"} ${className}`}
      data-resizing={draftWidth !== null || undefined} data-inspector-requested={!canvasFocus && open === true || undefined}
      data-canvas-focus={canvasFocus || undefined} data-drawer-open={peek || undefined}
      style={{ "--preferred-inspector": `${width / 16}rem` } as CSSProperties}>
      {header && !canvasFocus && createPortal(<Button className="inspector-toggle" aria-controls={inspectorId} aria-expanded={visible} onClick={() => setOpen(!visible)}>
        <PanelRight size={16} className={visible ? undefined : "panel-arrow-reversed"} /> Инспектор
      </Button>, header)}
      <main className="workarea" id="workspace">{children}</main>
      <aside ref={panelRef} className="inspector" aria-label="Инспектор" inert={!canvasFocus && !visible}
        onPointerEnter={canvasFocus ? (event) => {
          if (event.pointerType === "mouse") setDrawer((previous) => ({ ...previous, hovered: true }));
        } : undefined}
        onPointerLeave={canvasFocus ? (event) => {
          if (event.pointerType === "mouse") setDrawer((previous) => ({ ...previous, hovered: false }));
        } : undefined}
        onKeyDown={canvasFocus ? (event) => {
          if (event.key !== "Escape" || !peek || event.defaultPrevented) return;
          event.preventDefault();
          edgeTab.current?.focus();
          dismissDrawer();
        } : undefined}>
        {canvasFocus && <button ref={edgeTab} type="button" className="inspector-edge-tab" aria-controls={inspectorId}
          aria-expanded={peek} onClick={(event) => {
            if (event.detail && drawer.hovered) dismissDrawer();
            else setDrawer((previous) => ({ ...previous, toggled: !previous.toggled }));
          }}>
          <PanelRight size={16} className={peek ? undefined : "panel-arrow-reversed"} aria-hidden="true" /><span>Инспектор</span>
        </button>}
        <div className="inspector-content" id={inspectorId} inert={!visible}>
          <div className="inspector-bar">Инспектор</div>
          <div className="inspector-body">{inspector}</div>
          <LiveRunJournal />
        </div>
      </aside>
      {!canvasFocus && visible && docked && <div className="inspector-resize" role="separator" aria-label="Ширина инспектора" aria-controls={inspectorId}
        aria-orientation="vertical" aria-valuemin={248} aria-valuemax={maxWidth} aria-valuenow={constrainWidth(width)} tabIndex={0}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          const start = panelRef.current ? panelRef.current.getBoundingClientRect().width / uiScale : width;
          event.currentTarget.setPointerCapture(event.pointerId);
          resize.current = { x: event.clientX, start, width: start };
          setDraftWidth(start);
        }}
        onPointerMove={(event) => {
          const drag = resize.current;
          if (!drag) return;
          drag.width = constrainWidth(drag.start + (drag.x - event.clientX) / uiScale);
          setDraftWidth(drag.width);
        }}
        onPointerUp={(event) => endResize(event, true)}
        onPointerCancel={(event) => endResize(event, false)}
        onLostPointerCapture={(event) => endResize(event, false)}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 48 : 16;
          const current = panelRef.current ? panelRef.current.getBoundingClientRect().width / uiScale : width;
          const next = { ArrowLeft: current + step, ArrowRight: current - step, Home: 248, End: 560 }[event.key];
          if (next === undefined) return;
          event.preventDefault();
          rememberInspectorWidth(constrainWidth(next));
        }} />}
    </div>
  );
}

export function PageHeading({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) {
  return <div className="page-heading"><div><h1>{title}</h1><p>{description}</p></div>{actions && <div className="heading-actions">{actions}</div>}</div>;
}

export function PanelHeading({ title, description, icon }: { title: string; description?: string; icon?: ReactNode }) {
  return <div className="panel-heading">{icon && <span className="panel-icon">{icon}</span>}<div><h2>{title}</h2>{description && <p>{description}</p>}</div></div>;
}

export function Details({ entries }: { entries: [string, ReactNode][] }) {
  return <dl className="details">{entries.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}

export function Empty({ title, detail }: { title: string; detail: string }) {
  return <div className="empty"><strong>{title}</strong><p>{detail}</p></div>;
}

export function Modal({ title, children, onClose, className = "" }: { title: string; children: ReactNode; onClose: () => void; className?: string }) {
  const [container, setContainer] = useState<HTMLDialogElement | null>(null);
  useEffect(() => { if (container && !container.open) container.showModal(); }, [container]);
  return <dialog className={`dialog ${className}`} ref={setContainer} aria-label={title} onClose={onClose}>
    <ModalContainer value={container}>
      <div className="dialog-heading"><h2>{title}</h2><Button variant="ghost" className="icon-button" aria-label="Закрыть окно" onClick={onClose}><X size={18} /></Button></div>
      {children}
    </ModalContainer>
  </dialog>;
}
