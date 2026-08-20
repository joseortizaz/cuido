import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <h1 className="mb-8 text-2xl font-semibold">Iniciar sesión — Cuido</h1>
      <LoginForm />
    </div>
  );
}
