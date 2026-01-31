import { ChevronDownIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type MultiSelectOption = {
  value: string;
  label: string;
};

type MultiSelectProps = {
  options: MultiSelectOption[];
  value: string[];
  onValueChange: (value: string[]) => void;
  placeholder?: string;
  className?: string;
  triggerClassName?: string;
  contentClassName?: string;
};

export function MultiSelect({
  options,
  value,
  onValueChange,
  placeholder = "Select",
  className,
  triggerClassName,
  contentClassName,
}: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const selectedOptions = options.filter((option) =>
    value.includes(option.value),
  );
  const displayValue =
    selectedOptions.length === 0
      ? placeholder
      : selectedOptions.length <= 2
        ? selectedOptions.map((option) => option.label).join(", ")
        : `${selectedOptions.length} selected`;

  function toggleValue(optionValue: string, checked: boolean) {
    if (checked) {
      onValueChange([...value, optionValue]);
      return;
    }

    onValueChange(value.filter((entry) => entry !== optionValue));
  }

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <button
        type="button"
        className={cn(
          "flex h-9 w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm shadow-xs",
          triggerClassName,
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="truncate">{displayValue}</span>
        <ChevronDownIcon className="size-4 opacity-50" />
      </button>
      {open ? (
        <div
          className={cn(
            "absolute left-0 z-50 mt-2 w-full min-w-[12rem] rounded-md border bg-white p-1 text-black shadow-md",
            contentClassName,
          )}
          role="listbox"
        >
          {options.map((option) => {
            const checked = value.includes(option.value);
            return (
              <label
                key={option.value}
                className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-black/5"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) =>
                    toggleValue(option.value, event.target.checked)
                  }
                  className="h-4 w-4 accent-black"
                />
                <span>{option.label}</span>
              </label>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
