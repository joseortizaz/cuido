# Procedimiento: restablecer el 2FA de un usuario

Cuando alguien pierde el teléfono con su app de autenticación no puede iniciar sesión (la base de
datos le niega todo sin el segundo paso). Cuido no tiene códigos de recuperación propios: la
recuperación la hace un operador de plataforma.

## Pasos

1. **Verifica la identidad por un medio distinto al correo de la cuenta.** Quien controla el
   correo es justamente quien podría estar atacando la cuenta. Opciones: llamada al teléfono ya
   registrado de la clínica, mensaje de WhatsApp al número conocido, confirmación del admin de la
   clínica por otro canal. Para un médico o recepcionista, confirmarlo con el admin de su clínica.
2. Entra a **Operador → Restablecer 2FA** (`/operator/security`).
3. Escribe el correo del usuario, el motivo y cómo verificaste la identidad (mínimo 10
   caracteres), marca la casilla de confirmación y envía.
4. Avisa a la persona: puede entrar con su contraseña y volver a activar el 2FA en **Seguridad**
   con su teléfono nuevo.

Cada restablecimiento queda en `mfa_reset_log` (quién lo hizo, a quién, motivo y fecha); el
registro se ve en la misma pantalla y no se puede editar.

## Límites

- Un operador **no puede** restablecer su propio 2FA desde esa pantalla. Debe hacerlo otro
  operador, o él mismo desde **Mi seguridad** (`/security`) con un código vigente.
- Si el **único** operador pierde su 2FA, no hay otro que lo restablezca: hay que hacerlo con la
  `service_role` (desde un script o el panel de Supabase → Authentication → usuario → Factors),
  y anotar el motivo en `mfa_reset_log` a mano. Por eso, antes de exigir el 2FA a los operadores,
  conviene tener al menos dos operadores.
