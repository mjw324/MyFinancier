"use client";

import { Eye, EyeOff, type LucideIcon } from "lucide-react";
import { cloneElement, useState, ReactElement, isValidElement } from "react";

interface InputPasswordContainerProps {
  children: ReactElement<{ type?: string }>;
  startIcon?: LucideIcon;
}

export default function InputPasswordContainer({
  children,
  startIcon: StartIcon,
}: InputPasswordContainerProps) {
  const [isVisible, setIsVisible] = useState(false);

  const toggleVisibility = () => setIsVisible((prevState) => !prevState);

  return (
    <div className="space-y-2">
      <div className="relative">
        {isValidElement(children) &&
          cloneElement(children, {
            type: isVisible ? "text" : "password",
          })}
        {StartIcon && (
          <div className="pointer-events-none absolute inset-y-0 start-0 flex items-center justify-center ps-3 text-muted-foreground/80 peer-disabled:opacity-50">
            <StartIcon size={16} strokeWidth={2} aria-hidden="true" />
          </div>
        )}
        <button
          className="absolute inset-y-0 end-0 flex h-full w-9 items-center justify-center rounded-e-lg text-muted-foreground/80 outline-offset-2 transition-colors hover:text-foreground focus:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/70 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
          type="button"
          onClick={toggleVisibility}
          aria-label={isVisible ? "Hide password" : "Show password"}
          aria-pressed={isVisible}
        >
          {isVisible ? (
            <EyeOff size={16} strokeWidth={2} aria-hidden="true" />
          ) : (
            <Eye size={16} strokeWidth={2} aria-hidden="true" />
          )}
        </button>
      </div>
    </div>
  );
}
