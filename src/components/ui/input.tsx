import type { InputHTMLAttributes, TextareaHTMLAttributes, LabelHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-11 w-full rounded-[var(--radius-sm)] bg-elevated px-3 text-base text-fg placeholder:text-subtle shadow-[var(--shadow-border)] outline-none transition-[box-shadow] duration-150 focus:shadow-[var(--shadow-border-hover)] focus:ring-2 focus:ring-primary/50",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "min-h-32 w-full rounded-[var(--radius-md)] bg-elevated px-3 py-2.5 text-base text-fg placeholder:text-subtle shadow-[var(--shadow-border)] outline-none transition-[box-shadow] duration-150 focus:shadow-[var(--shadow-border-hover)] focus:ring-2 focus:ring-primary/50",
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("block text-xs font-medium tracking-wide text-muted", className)}
      {...props}
    />
  );
}
