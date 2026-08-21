/**
 * Firma XAdES + envío del e-CF al servicio web de la DGII — DELIBERADAMENTE
 * aislado y sin implementar. El certificado digital tributario (PSC/
 * INDOTEL) sigue en trámite (ver CLAUDE.md); esta función es el único
 * punto de entrada para esa pieza, así que cuando el certificado esté
 * listo el reemplazo es quirúrgico: nadie que llame a `signAndSubmitECF`
 * necesita cambiar.
 *
 * NO simular con datos falsos ni devolver un éxito ficticio — falla
 * siempre, con un error tipado y un mensaje claro, hasta que se implemente
 * de verdad (probable candidato a Edge Function, mismo motivo que
 * sign-consent: necesita una clave privada/certificado que no debe tocar
 * el navegador).
 */
export class ECFSigningNotConfiguredError extends Error {
  constructor() {
    super(
      "Certificado digital tributario (PSC/INDOTEL) pendiente de configurar. " +
        "Este e-CF quedó generado pero sin firmar ni enviar a la DGII."
    );
    this.name = "ECFSigningNotConfiguredError";
  }
}

export async function signAndSubmitECF(xmlUnsigned: string): Promise<never> {
  void xmlUnsigned;
  throw new ECFSigningNotConfiguredError();
}
