import React, { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

export interface DropdownOption<T extends string | number> {
  value: T;
  label: string;
  icon?: React.ReactNode;
  badge?: string;
}

interface CustomDropdownProps<T extends string | number> {
  value: T;
  onChange: (value: T) => void;
  options: readonly DropdownOption<T>[];
  title?: string;
  placeholder?: string;
  icon?: React.ReactNode;
  className?: string;
  buttonClassName?: string;
  menuClassName?: string;
  align?: "left" | "right";
  ariaLabel?: string;
  disabled?: boolean;
}

export function CustomDropdown<T extends string | number>({
  value,
  onChange,
  options,
  title,
  placeholder = "Selecione...",
  icon,
  className = "",
  buttonClassName = "",
  menuClassName = "",
  align = "right",
  ariaLabel,
  disabled = false,
}: CustomDropdownProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const [effectiveAlign, setEffectiveAlign] = useState<"left" | "right">(align);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedIndex = options.findIndex((opt) => opt.value === value);
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  useEffect(() => {
    if (isOpen && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      setOpenUp(spaceBelow < 280 && spaceAbove > spaceBelow);

      // Verificação de colisão horizontal com a borda da janela
      const estimatedWidth = 260;
      if (align === "left" && rect.left + estimatedWidth > window.innerWidth - 16) {
        setEffectiveAlign("right");
      } else if (align === "right" && rect.right - estimatedWidth < 16 && rect.left + estimatedWidth <= window.innerWidth - 16) {
        setEffectiveAlign("left");
      } else {
        setEffectiveAlign(align);
      }

      setFocusedIndex(selectedIndex >= 0 ? selectedIndex : 0);
    }
  }, [isOpen, align, selectedIndex]);

  // Fecha o dropdown ao clicar fora ou teclado
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIndex((prev) => (prev < options.length - 1 ? prev + 1 : 0));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIndex((prev) => (prev > 0 ? prev - 1 : options.length - 1));
      } else if (e.key === "Enter" && focusedIndex >= 0 && focusedIndex < options.length) {
        e.preventDefault();
        handleSelect(options[focusedIndex].value);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, focusedIndex, options]);

  const handleSelect = (val: T) => {
    onChange(val);
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className={`custom-dropdown-container ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={ariaLabel ?? title ?? selectedOption?.label}
        className={`custom-dropdown-trigger ${isOpen ? "is-open" : ""} ${buttonClassName}`}
      >
        <div className="custom-dropdown-trigger-content">
          {icon && <span className="custom-dropdown-icon">{icon}</span>}
          {selectedOption?.icon && <span className="custom-dropdown-icon">{selectedOption.icon}</span>}
          <span className="custom-dropdown-label">{selectedOption ? selectedOption.label : placeholder}</span>
          {selectedOption?.badge && (
            <span className="custom-dropdown-badge">{selectedOption.badge}</span>
          )}
        </div>
        <ChevronDown
          className={`custom-dropdown-arrow ${isOpen ? "rotate-180" : ""}`}
          size={14}
        />
      </button>

      {isOpen && (
        <div
          role="listbox"
          className={`custom-dropdown-popover ${effectiveAlign === "left" ? "align-left" : "align-right"} ${openUp ? "open-up" : ""} ${menuClassName}`}
        >
          {title && (
            <div className="custom-dropdown-header">
              <span>{title}</span>
              <span className="custom-dropdown-count">{options.length} opções</span>
            </div>
          )}

          <div className="custom-dropdown-options-list">
            {options.map((opt, idx) => {
              const isSelected = opt.value === value;
              const isFocused = idx === focusedIndex;
              return (
                <button
                  key={String(opt.value)}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => handleSelect(opt.value)}
                  className={`custom-dropdown-option ${isSelected ? "is-selected" : ""} ${isFocused ? "is-focused" : ""}`}
                >
                  <div className="custom-dropdown-option-left">
                    {opt.icon && <span className="custom-dropdown-icon">{opt.icon}</span>}
                    <span className="custom-dropdown-option-text">{opt.label}</span>
                    {opt.badge && <span className="custom-dropdown-badge">{opt.badge}</span>}
                  </div>
                  {isSelected && <Check className="custom-dropdown-check" size={14} />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
