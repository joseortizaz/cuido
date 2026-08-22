import { AuthShell } from "../_auth/auth-shell";
import { SignupForm } from "./signup-form";

export default function SignupPage() {
  return (
    <AuthShell title="Crear cuenta">
      <SignupForm />
    </AuthShell>
  );
}
