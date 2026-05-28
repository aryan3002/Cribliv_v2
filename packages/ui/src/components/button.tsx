import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "tertiary";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  children: ReactNode;
}

const styles: Record<Variant, string> = {
  primary: "bg-brand text-white border border-brand",
  secondary: "bg-white text-brand border border-brand",
  tertiary: "bg-transparent text-brand border border-transparent"
};

export function Button({ variant = "primary", children, className = "", ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={`h-11 rounded-md px-4 text-sm font-semibold ${styles[variant]} ${className}`.trim()}
    >
      {children}
    </button>
  );
}
