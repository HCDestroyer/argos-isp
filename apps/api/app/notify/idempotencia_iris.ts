/**
 * Clasificación de los `409` de Iris (contrato Iris §3.1). Iris responde `409` cuando la primera
 * petición con la misma `Idempotency-Key` sigue en curso, pero el nombre no es uniforme: la
 * mensajería usa `idempotencia_en_curso` y el resto de su API `idempotencia_en_proceso` (iris#104).
 * Argos no depende del nombre: cualquiera de los dos, en el `type`, el `code` o el cuerpo, se
 * reintenta con la misma clave. Un `409` de otro tipo (`servicio_no_pendiente`, `conflicto_version`…)
 * es de negocio y sigue siendo permanente.
 */

const EN_CURSO = /idempotencia_en_(?:curso|proceso)(?!\w)/

/** ¿Es un `409` de idempotencia en curso o en proceso (se reintenta con la misma clave)? */
export function esIdempotenciaEnCursoIris(status: number, cuerpo: string): boolean {
    return status === 409 && EN_CURSO.test(cuerpo)
}

/** ¿La respuesta de Iris es transitoria? `5xx`, `429` y `409` de idempotencia en curso o en proceso. */
export function esTransitorioIris(status: number, cuerpo: string): boolean {
    return status >= 500 || status === 429 || esIdempotenciaEnCursoIris(status, cuerpo)
}
