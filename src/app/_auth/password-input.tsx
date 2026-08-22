"use client";

import { useState } from "react";

type PasswordInputProps = {
  id: string;
  name: string;
  autoComplete: "current-password" | "new-password";
  required?: boolean;
  minLength?: number;
};

/**
 * Campo de contraseña con botón de mostrar/ocultar (ícono de ojo) dentro del
 * mismo input -- reutilizado por login y signup. Alterna type="password" /
 * type="text"; el ícono es un SVG inline igual que el resto del sistema de
 * diseño (icons.tsx de la landing), sin librería nueva.
 */
export function PasswordInput({ id, name, autoComplete, required, minLength }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        id={id}
        name={name}
        type={visible ? "text" : "password"}
        required={required}
        minLength={minLength}
        autoComplete={autoComplete}
        className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 pr-10 text-sm outline-none focus:border-brand-teal"
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
        aria-pressed={visible}
        tabIndex={-1}
        className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-zinc-400 hover:text-zinc-600"
      >
        {visible ? <EyeOffIcon className="h-4.5 w-4.5" /> : <EyeIcon className="h-4.5 w-4.5" />}
      </button>
    </div>
  );
}

type IconProps = { className?: string };

function EyeIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="2.75" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function EyeOffIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M3.5 3.5l17 17M9.9 5.7c.68-.14 1.4-.2 2.1-.2 6 0 9.5 6.5 9.5 6.5a15.6 15.6 0 0 1-3.2 4M6.5 6.9C4 8.6 2.5 12 2.5 12S6 18.5 12 18.5c1.4 0 2.66-.35 3.75-.9M14.6 14.6a2.75 2.75 0 0 1-4.2-3.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
