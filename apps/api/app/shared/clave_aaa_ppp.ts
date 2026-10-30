/**
 * Validación de `AAA_PPP_KEY` al arrancar (`start/env.ts`). Sin imports a propósito: la usa la
 * validación del entorno, antes de que exista nada más.
 *
 * Obligatoria y de 32 bytes en base64, la misma regla que `claveDesdeTexto` de `#shared/cifrado`:
 * sin ella el alta de servicios, los routers y el canje de los conectores respondían 500 a mitad de
 * una petición; ahora la API no arranca y dice qué falta.
 */

const GENERAR_CLAVE = `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`

export function validarClaveAaaPpp(nombre: string, valor?: string): string {
    if (!valor) {
        throw new Error(
            `Falta la variable de entorno ${nombre}: es la clave (32 bytes en base64) que cifra las ` +
                `contraseñas PPPoE y los secretos de routers e integraciones, la misma en aaa y coa. ` +
                `Genera una con ${GENERAR_CLAVE} y guárdala fuera del servidor (ver apps/api/.env.example).`,
        )
    }
    if (Buffer.from(valor, 'base64').length !== 32) {
        throw new Error(
            `${nombre} debe tener 32 bytes en base64 (44 caracteres terminados en "="). Genera una con ${GENERAR_CLAVE}.`,
        )
    }
    return valor
}
