import { AuthShell } from "../_auth/auth-shell";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <AuthShell title="Iniciar sesión">
      <LoginForm />
    </AuthShell>
  );
}
