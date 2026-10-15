"use client";

import { useEffect, useRef } from "react";
import { OTP_LENGTH, sanitizeOtpInput } from "@/lib/otp-flow";

interface OtpInputProps {
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  autoFocus?: boolean;
  /** Id of the element that labels the group (for screen readers). */
  labelledBy: string;
  /** Id of the element that describes the group or its error. */
  describedBy?: string;
  /** Increment to move focus back to the first empty box (after an error). */
  focusSignal?: number;
}

/**
 * Six one-digit boxes behaving as one field: typing advances, Backspace steps back, arrow keys move, Home/End jump, and a pasted code
 * (with spaces or a dash) fills all boxes. The first box carries autocomplete="one-time-code" so mobile keyboards offer the code from the
 * e-mail. The value is display state only; the server decides validity.
 */
export function OtpInput({ value, onChange, onComplete, disabled, invalid, autoFocus, labelledBy, describedBy, focusSignal }: OtpInputProps) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = Array.from({ length: OTP_LENGTH }, (_, i) => value[i] ?? "");

  const focusAt = (i: number) => {
    const el = refs.current[Math.max(0, Math.min(OTP_LENGTH - 1, i))];
    el?.focus();
    el?.select();
  };

  useEffect(() => {
    if (autoFocus) focusAt(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus]);

  useEffect(() => {
    if (focusSignal) focusAt(Math.min(value.length, OTP_LENGTH - 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSignal]);

  const commit = (next: string, focusIndex: number) => {
    const clean = sanitizeOtpInput(next);
    onChange(clean);
    if (clean.length === OTP_LENGTH) onComplete?.(clean);
    focusAt(focusIndex);
  };

  const handleChange = (i: number, raw: string) => {
    const typed = sanitizeOtpInput(raw);
    if (!typed) {
      commit(value.slice(0, i) + value.slice(i + 1), i);
      return;
    }
    // several characters at once (autofill, or a keyboard that sends the whole code to one box)
    const next = value.slice(0, i) + typed + value.slice(i + typed.length);
    commit(next, Math.min(i + typed.length, OTP_LENGTH - 1));
  };

  const handleKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !digits[i] && i > 0) {
      e.preventDefault();
      commit(value.slice(0, i - 1) + value.slice(i), i - 1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      focusAt(i - 1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      focusAt(i + 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      focusAt(0);
    } else if (e.key === "End") {
      e.preventDefault();
      focusAt(OTP_LENGTH - 1);
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = sanitizeOtpInput(e.clipboardData.getData("text"));
    if (!pasted) return;
    e.preventDefault();
    commit(pasted, Math.min(pasted.length, OTP_LENGTH - 1));
  };

  return (
    <div role="group" aria-labelledby={labelledBy} aria-describedby={describedBy} className="flex items-center justify-center gap-2 sm:gap-2.5">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={OTP_LENGTH}
          value={d}
          disabled={disabled}
          aria-label={`Digit ${i + 1} of ${OTP_LENGTH}`}
          aria-invalid={invalid || undefined}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          onFocus={(e) => e.target.select()}
          className={`h-12 w-10 sm:h-14 sm:w-12 rounded-lg border bg-transparent text-center text-xl font-semibold tabular-nums text-gray-900 dark:text-gray-50 focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-50 ${
            invalid
              ? "border-red-500 focus:ring-red-400"
              : "border-gray-300 dark:border-gray-700 focus:ring-zinc-400 dark:focus:ring-zinc-600"
          }`}
        />
      ))}
    </div>
  );
}
