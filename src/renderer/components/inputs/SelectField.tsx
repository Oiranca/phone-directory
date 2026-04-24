import { useEffect, useId, useMemo, useRef, useState } from "react";
import { FieldError } from "./FieldError";
import { FieldHint } from "./FieldHint";

type SelectOption = {
  label: string;
  value: string;
};

type SelectFieldProps = {
  id: string;
  label: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  value: string;
  helperText?: string;
  errorText?: string;
  invalid?: boolean;
  disabled?: boolean;
};

export const SelectField = ({
  id,
  label,
  onChange,
  options,
  value,
  helperText,
  errorText,
  invalid = false,
  disabled = false,
}: SelectFieldProps) => {
  const instanceId = useId();
  const labelId = `${id}-label`;
  const valueId = `${id}-value`;
  const listboxId = `${id}-listbox`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const getOptionId = (index: number) => `${listboxId}-option-${index}`;
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const selectedIndex = useMemo(
    () => options.findIndex((option) => option.value === value),
    [options, value]
  );
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : options[0] ?? null;

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !rootRef.current) {
      return;
    }

    const rootElement = rootRef.current;
    const handleFocusOut = (event: FocusEvent) => {
      const nextFocusedElement = event.relatedTarget as Node | null;

      if (!nextFocusedElement || !rootElement.contains(nextFocusedElement)) {
        setIsOpen(false);
      }
    };

    rootElement.addEventListener("focusout", handleFocusOut);
    return () => rootElement.removeEventListener("focusout", handleFocusOut);
  }, [isOpen]);

  useEffect(() => {
    if (options.length === 0) {
      setActiveIndex(-1);
      setIsOpen(false);
      return;
    }

    if (activeIndex >= options.length) {
      setActiveIndex(options.length - 1);
    }
  }, [activeIndex, options, options.length]);

  const commitValue = (nextValue: string) => {
    if (disabled) return;
    onChange(nextValue);
    setIsOpen(false);
    buttonRef.current?.focus();
  };

  const openListbox = () => {
    if (options.length === 0 || disabled) {
      return;
    }

    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    setIsOpen(true);
  };

  const moveActiveIndex = (direction: 1 | -1) => {
    if (options.length === 0 || disabled) {
      return;
    }

    const nextIndex =
      activeIndex < 0
        ? selectedIndex >= 0
          ? selectedIndex
          : 0
        : (activeIndex + direction + options.length) % options.length;

    setActiveIndex(nextIndex);
  };

  const describedBy = [
    valueId,
    helperText ? hintId : null,
    errorText ? errorId : null,
  ]
    .filter(Boolean)
    .join(" ");

  const triggerClassName = [
    "mt-2 flex min-h-12 w-full items-center justify-between gap-3 rounded-2xl border bg-white px-4 py-3 text-left text-sm transition outline-none ring-scs-blue",
    invalid
      ? "border-scs-danger focus:border-scs-danger focus:ring-scs-danger/20"
      : "border-slate-200 hover:border-slate-300 focus:border-scs-blue focus:ring-2",
    disabled
      ? "opacity-50 cursor-not-allowed bg-slate-50 border-slate-200"
      : "text-slate-900",
    isOpen ? "border-scs-blue ring-2" : "",
  ].join(" ");

  return (
    <div ref={rootRef} className="relative">
      <span id={labelId} className="text-sm font-medium text-slate-700">
        {label}
      </span>
      <button
        ref={buttonRef}
        id={id}
        type="button"
        role="combobox"
        disabled={disabled}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        aria-labelledby={labelId}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        aria-activedescendant={isOpen && activeIndex >= 0 ? getOptionId(activeIndex) : undefined}
        className={triggerClassName}
        onClick={() => {
          if (disabled) return;
          if (isOpen) {
            setIsOpen(false);
            return;
          }

          openListbox();
        }}
        onKeyDown={(event) => {
          if (disabled) return;
          switch (event.key) {
            case "ArrowDown":
              event.preventDefault();
              if (!isOpen) {
                openListbox();
                return;
              }
              moveActiveIndex(1);
              return;
            case "ArrowUp":
              event.preventDefault();
              if (!isOpen) {
                openListbox();
                return;
              }
              moveActiveIndex(-1);
              return;
            case "Home":
              if (!isOpen) {
                return;
              }
              event.preventDefault();
              setActiveIndex(0);
              return;
            case "End":
              if (!isOpen) {
                return;
              }
              event.preventDefault();
              setActiveIndex(options.length - 1);
              return;
            case "Enter":
            case " ":
              event.preventDefault();
              if (!isOpen) {
                openListbox();
                return;
              }
              if (activeIndex >= 0) {
                const activeOption = options[activeIndex];
                if (activeOption) {
                  commitValue(activeOption.value);
                }
              }
              return;
            case "Escape":
              if (!isOpen) {
                return;
              }
              event.preventDefault();
              setIsOpen(false);
              return;
            case "Tab":
              if (isOpen) {
                setIsOpen(false);
              }
              return;
            default:
              return;
          }
        }}
      >
        <span id={valueId} className="truncate">
          {selectedOption?.label ?? ""}
        </span>
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          className={[
            "h-4 w-4 shrink-0 text-slate-500 transition-transform",
            isOpen ? "rotate-180" : "",
          ].join(" ")}
        >
          <path
            d="M5.5 7.5 10 12l4.5-4.5"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
          />
        </svg>
      </button>

      {helperText && <FieldHint id={hintId}>{helperText}</FieldHint>}
      {errorText && <FieldError id={errorId} error={errorText} />}

      {isOpen && (
        <div className="absolute inset-x-0 top-[calc(100%+0.5rem)] z-30 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_18px_50px_rgba(15,23,42,0.14)]">
          <ul
            id={listboxId}
            role="listbox"
            aria-labelledby={labelId}
            className="max-h-64 overflow-auto py-2"
          >
            {options.map((option, index) => {
              const isSelected = option.value === value;
              const isActive = index === activeIndex;

              return (
                <li key={`${instanceId}-${option.value}`} role="presentation" className="px-2">
                  <button
                    id={getOptionId(index)}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className={[
                      "flex min-h-11 w-full items-center rounded-xl px-3 py-2 text-left text-sm transition",
                      isSelected
                        ? "bg-scs-mist text-scs-blueDark"
                        : "text-slate-700 hover:bg-slate-50",
                      isActive && !isSelected ? "bg-slate-100 text-slate-900" : "",
                    ].join(" ")}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => commitValue(option.value)}
                  >
                    <span className="truncate">{option.label}</span>
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
