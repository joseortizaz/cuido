import { AuthShell } from "../_auth/auth-shell";
import { ForgotPasswordForm } from "./forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <AuthShell title="Restablecer contraseña">
      <ForgotPasswordForm />
    </AuthShell>
  );
}
