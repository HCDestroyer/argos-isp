/**
 * Código de corte de la pestaña (`utils/codigoCorte.ts`): `?c=` de la URL al entrar a `/corte` o el
 * guardado en la pestaña. Lo lee el cliente HTTP (`plugins/api.ts`) para mandarlo a la API.
 */
export function useCodigoCorte() {
    const codigo = useState<string | null>('portal:codigo-corte', () => null)

    /** Toma el `?c=` de la ruta (si trae uno) y lo guarda; si no, el que ya tenía la pestaña. */
    function tomarDeLaRuta(valor: unknown): string | null {
        const deLaRuta = codigoCorteValido(valor)
        if (deLaRuta) {
            codigo.value = deLaRuta
            guardarCodigo(deLaRuta)
        }
        else if (!codigo.value && import.meta.client) {
            codigo.value = leerCodigoGuardado()
        }
        return codigo.value
    }

    return { codigo, tomarDeLaRuta }
}
