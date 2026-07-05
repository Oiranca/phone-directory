import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { FieldError } from "./FieldError";
import { FieldHint } from "./FieldHint";

type ComboboxFieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Free-text suggestions (e.g. previously-used values). Selecting one sets the value, but typing anything else is always allowed. */
  suggestions: string[];
  placeholder?: string;
  helperText?: string;
  errorText?: string;
  invalid?: boolean;
  disabled?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
  /** Exposes the underlying input node (e.g. for post-add focus management), same pattern as the raw input refs used in PhonesSection/EmailsSection. */
  inputRef?: (element: HTMLInputElement | null) => void;
};

/**
 * Case- and accent-insensitive normalization for suggestion matching, so
 * typing "numero" still surfaces an existing "Número extranjero" key.
 */
const normalizeForMatch = (text: string): string =>
  text.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * Minimal free-text combobox with filtered suggestions (OIR-232).
 * Unlike SelectField (fixed single-select), this always accepts arbitrary
 * typed text — suggestions are offered as shortcuts, never enforced.
 * Used for the custom-field key name so a user can pick a previously-used
 * key (avoiding accidental near-duplicates) while still typing a new one.
 */
export const ComboboxField = ({
  id,
  label,
  value,
  onChange,
  suggestions,
  placeholder,
  helperText,
  errorText,
  invalid = false,
  disabled = false,
  onFocus,
  onBlur,
  inputRef: externalInputRef
}: ComboboxFieldProps) => {
  const listboxId = `${id}-listbox`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const getOptionId = (index: number) => `${listboxId}-option-${index}`;
  const rootRef = useRef<HTMLDivElement>(null);
  // MutableRefObject cast: this ref is written to from a custom callback ref
  // below (to merge with the externally-supplied inputRef), not attached
  // directly via `ref={inputRef}`, so it needs a writable `.current`.
  const inputRef = useRef<HTMLInputElement | null>(null) as MutableRefObject<HTMLInputElement | null>;
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const filteredSuggestions = useMemo(() => {
    const normalizedValue = normalizeForMatch(value);
    const deduped = Array.from(new Set(suggestions.filter((s) => s.trim().length > 0)));
    if (!normalizedValue) return deduped;
    return deduped.filter((suggestion) => normalizeForMatch(suggestion).includes(normalizedValue));
  }, [suggestions, value]);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isOpen]);

  useEffect(() => {
    if (activeIndex >= filteredSuggestions.length) {
      setActiveIndex(filteredSuggestions.length - 1);
    }
  }, [activeIndex, filteredSuggestions.length]);

  const commitValue = (nextValue: string) => {
    onChange(nextValue);
    setIsOpen(false);
    setActiveIndex(-1);
    inputRef.current?.focus();
  };

  const describedBy = [
    helperText ? hintId : null,
    errorText ? errorId : null
  ].filter(Boolean).join(" ") || undefined;

  const inputClassName = [
    "mt-2 w-full rounded-2xl border bg-white px-4 py-3 text-sm outline-none ring-scs-blue transition",
    invalid
      ? "border-scs-danger focus-visible:border-scs-danger focus-visible:ring-2 focus-visible:ring-scs-danger/20"
      : "border-slate-200 focus-visible:border-scs-blue focus-visible:ring-2",
    disabled ? "opacity-50 cursor-not-allowed bg-slate-50" : ""
  ].join(" ");

  return (
    <div ref={rootRef} className="relative">
      <label htmlFor={id} className="text-sm font-medium text-slate-700">
        {label}
      </label>
      <input
        ref={(element) => {
          inputRef.current = element;
          externalInputRef?.(element);
        }}
        id={id}
        type="text"
        role="combobox"
        autoComplete="off"
        disabled={disabled}
        placeholder={placeholder}
        value={value}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-controls={isOpen ? listboxId : undefined}
        aria-autocomplete="list"
        aria-invalid={invalid}
        aria-describedby={describedBy}
        aria-activedescendant={isOpen && activeIndex >= 0 ? getOptionId(activeIndex) : undefined}
        className={inputClassName}
        onFocus={() => {
          if (!disabled && filteredSuggestions.length > 0) {
            setIsOpen(true);
          }
          onFocus?.();
        }}
        onBlur={(event) => {
          const nextFocused = event.relatedTarget as Node | null;
          if (!nextFocused || !rootRef.current?.contains(nextFocused)) {
            setIsOpen(false);
          }
          onBlur?.();
        }}
        onChange={(event) => {
          const nextValue = event.target.value;
          onChange(nextValue);
          setIsOpen(!disabled);
          setActiveIndex(-1);
        }}
        onKeyDown={(event) => {
          if (disabled) return;
          switch (event.key) {
            case "ArrowDown":
              if (filteredSuggestions.length === 0) return;
              event.preventDefault();
              if (!isOpen) {
                setIsOpen(true);
                setActiveIndex(0);
                return;
              }
              setActiveIndex((current) => (current + 1) % filteredSuggestions.length);
              return;
            case "ArrowUp":
              if (filteredSuggestions.length === 0) return;
              event.preventDefault();
              if (!isOpen) {
                setIsOpen(true);
                setActiveIndex(filteredSuggestions.length - 1);
                return;
              }
              setActiveIndex((current) => (current - 1 + filteredSuggestions.length) % filteredSuggestions.length);
              return;
            case "Enter":
              if (isOpen && activeIndex >= 0) {
                event.preventDefault();
                commitValue(filteredSuggestions[activeIndex]!);
              }
              return;
            case "Escape":
              if (isOpen) {
                event.preventDefault();
                setIsOpen(false);
                setActiveIndex(-1);
              }
              return;
            default:
              return;
          }
        }}
      />

      {helperText && <FieldHint id={hintId}>{helperText}</FieldHint>}
      {errorText && <FieldError id={errorId} error={errorText} />}

      {isOpen && filteredSuggestions.length > 0 && (
        <div className="absolute inset-x-0 top-[calc(100%+0.5rem)] z-30 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_18px_50px_rgba(15,23,42,0.14)]">
          <ul id={listboxId} role="listbox" aria-label={label} className="max-h-64 overflow-auto py-2">
            {filteredSuggestions.map((suggestion, index) => {
              const isActive = index === activeIndex;

              return (
                <li key={suggestion} role="presentation" className="px-2">
                  <button
                    id={getOptionId(index)}
                    type="button"
                    role="option"
                    aria-selected={suggestion === value}
                    className={[
                      "flex min-h-11 w-full items-center rounded-xl px-3 py-2 text-left text-sm transition",
                      isActive ? "bg-slate-100 text-slate-900" : "text-slate-700 hover:bg-slate-50"
                    ].join(" ")}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => commitValue(suggestion)}
                  >
                    <span className="truncate">{suggestion}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
};
