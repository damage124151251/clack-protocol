import React, { useEffect, useRef, useState, useId } from "react";
import { X, ArrowUpRight, Copy, Check, SkipForward } from "lucide-react";
import { drawIntro } from "./art.mjs";
export function Canvas({ draw, label, className = "", animated = false }) {
  const ref = useRef(),
    fn = useRef(draw);
  fn.current = draw;
  useEffect(() => {
    const el = ref.current,
      c = el.getContext("2d"),
      mq = matchMedia("(prefers-reduced-motion: reduce)");
    let frame,
      size,
      start = performance.now();
    function paint(t) {
      const d = Math.min(devicePixelRatio || 1, 2);
      c.setTransform(d, 0, 0, d, 0, 0);
      c.imageSmoothingEnabled = false;
      fn.current(
        c,
        size.width,
        size.height,
        mq.matches ? 0 : (t - start) / 1000,
      );
      if (animated && !mq.matches && !document.hidden)
        frame = requestAnimationFrame(paint);
    }
    function resize() {
      size = el.getBoundingClientRect();
      const d = Math.min(devicePixelRatio || 1, 2);
      el.width = Math.max(1, Math.round(size.width * d));
      el.height = Math.max(1, Math.round(size.height * d));
      cancelAnimationFrame(frame);
      paint(performance.now());
    }
    function visible() {
      cancelAnimationFrame(frame);
      if (!document.hidden) paint(performance.now());
    }
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    document.addEventListener("visibilitychange", visible);
    mq.addEventListener("change", resize);
    resize();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", visible);
      mq.removeEventListener("change", resize);
    };
  }, [animated]);
  return (
    <canvas ref={ref} className={className} role="img" aria-label={label} />
  );
}
export function Icon({ title, children, ...props }) {
  return (
    <button
      className="icon"
      title={title}
      aria-label={title}
      type="button"
      {...props}
    >
      {children}
    </button>
  );
}
export function CopyButton({ value }) {
  const [ok, set] = useState(false);
  return (
    <Icon
      title={ok ? "Copied" : "Copy"}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          set(true);
          setTimeout(() => set(false), 1800);
        } catch {
          set(false);
        }
      }}
    >
      {ok ? <Check size={15} /> : <Copy size={15} />}
    </Icon>
  );
}
export function External({ href, children, title, className = "" }) {
  return (
    <a
      href={href}
      title={title}
      className={`external ${className}`}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
      <ArrowUpRight size={13} />
    </a>
  );
}
export function Modal({ title, children, close, wide = false }) {
  const ref = useRef(),
    id = useId();
  useEffect(() => {
    const prior = document.activeElement,
      before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = () =>
      [
        ...ref.current.querySelectorAll(
          'button:not([disabled]),a[href],input:not([disabled]),select,textarea,[tabindex="0"]',
        ),
      ].filter((e) => e.getClientRects().length);
    focusable()[0]?.focus();
    function key(e) {
      if (e.key === "Escape") close();
      if (e.key === "Tab") {
        const list = focusable(),
          first = list[0],
          last = list.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    }
    document.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = before;
      document.removeEventListener("keydown", key);
      prior?.focus();
    };
  }, []);
  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <section
        ref={ref}
        className={`modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
      >
        <header>
          <h2 id={id}>{title}</h2>
          <Icon title="Close" onClick={close}>
            <X size={19} />
          </Icon>
        </header>
        {children}
      </section>
    </div>
  );
}
export function Intro({ finish }) {
  const [started] = useState(performance.now());
  useEffect(() => {
    const timeout = setTimeout(finish, 4000);
    const key = (e) => {
      if (e.key === "Escape") finish();
    };
    document.addEventListener("keydown", key);
    return () => {
      clearTimeout(timeout);
      document.removeEventListener("keydown", key);
    };
  }, []);
  return (
    <div className="intro">
      <Canvas
        label="CLACK receipt machine opening"
        draw={(c, w, h) =>
          drawIntro(c, w, h, (performance.now() - started) / 1000)
        }
        animated
      />
      <button onClick={finish}>
        <SkipForward size={15} />
        Skip opening
      </button>
    </div>
  );
}
export function download(data, name, type = "application/json") {
  const url = URL.createObjectURL(
    new Blob(
      [typeof data === "string" ? data : JSON.stringify(data, null, 2)],
      { type },
    ),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
