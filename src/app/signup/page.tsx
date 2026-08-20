import { SignupForm } from "./signup-form";

export default function SignupPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <h1 className="mb-8 text-2xl font-semibold">Crear cuenta — Cuido</h1>
      <SignupForm />
    </div>
  );
}
