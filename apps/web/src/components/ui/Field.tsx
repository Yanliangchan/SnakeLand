"use client";

import { AnimatePresence, motion } from "framer-motion";
import { forwardRef, useId } from "react";
import { cn } from "@/lib/cn";
import { expoOut } from "@/lib/motion";

export interface FieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string | null;
  hint?: string;
}

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, error, hint, className, id, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const msgId = `${inputId}-msg`;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={inputId} className="text-[13px] text-fg-muted">
        {label}
      </label>
      <input
        ref={ref}
        id={inputId}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={error || hint ? msgId : undefined}
        className={cn(
          "h-12 rounded-[var(--radius-ui)] bg-surface px-4 text-[15px] text-fg hairline outline-none transition-colors placeholder:text-fg-disabled focus:border-hairline-strong focus-visible:outline-none",
          error && "border-loss/60 focus:border-loss/80",
          className,
        )}
        {...rest}
      />
      <AnimatePresence initial={false} mode="wait">
        {error ? (
          <motion.p
            key="error"
            id={msgId}
            role="alert"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: expoOut }}
            className="text-[13px] text-loss"
          >
            {error}
          </motion.p>
        ) : hint ? (
          <motion.p
            key="hint"
            id={msgId}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: expoOut }}
            className="text-[13px] text-fg-disabled"
          >
            {hint}
          </motion.p>
        ) : null}
      </AnimatePresence>
    </div>
  );
});
