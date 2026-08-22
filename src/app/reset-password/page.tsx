import { AuthShell } from "../_auth/auth-shell";
import { ResetPasswordForm } from "./reset-password-form";

/**
 * Nota de verificación (pedida explícitamente): el flujo de recuperación de
 * contraseña de Supabase Auth (resetPasswordForEmail / updateUser) NO
 * requeria ninguna activación de proyecto aparte de lo que ya estaba
 * funcionando -- reutiliza el mismo proveedor de envío de correo que ya
 * usa la confirmación de signup (emailRedirectTo en
 * src/app/signup/actions.ts). No hay un toggle "activar recuperación" en
 * Supabase Auth separado del auth por email/password general, que este
 * proyecto ya tenía habilitado desde la Fase 0. Lo único que faltaba
 * construir era la UI/rutas de la app (/forgot-password, /reset-password) y
 * el soporte de `next` en /auth/callback -- ver ese archivo.
 *
 * Esta página se deja FUERA de PUBLIC_PATHS (src/lib/supabase/middleware.ts)
 * a propósito: un visitante legítimo llega aquí ya con una sesión de
 * recuperación válida (establecida por /auth/callback al canjear el código
 * del enlace del correo), así que el middleware la deja pasar como
 * cualquier ruta autenticada. Una visita directa sin ese enlace rebota
 * correctamente a /login.
 */
export default function ResetPasswordPage() {
  return (
    <AuthShell title="Nueva contraseña">
      <ResetPasswordForm />
    </AuthShell>
  );
}
