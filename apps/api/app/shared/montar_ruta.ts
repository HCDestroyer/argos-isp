import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'
import {
    PREFIJO_API,
    despachar,
    esParametroEntero,
    idempotenciaPorActorIris,
    parametrosDeRuta,
    validarActuacionVinculada,
    type Ruta,
} from '#shared/rutas'

/**
 * Monta una ruta del registro en el router de AdonisJS con su cadena de middleware:
 * auth → empresa (X-Empresa-Id) → autorizar(permiso) → actuarComoVinculado (solo si la ruta lo
 * declara) → idempotencia → validación VineJS → handler (o 501). La usan `start/routes.ts` y las
 * pruebas que necesitan una ruta propia con la misma cadena.
 */
export function montarRuta(ruta: Ruta) {
    // falla al arrancar si una ruta declara `actuarComoVinculado` fuera de lo permitido
    validarActuacionVinculada(ruta)
    const seguridad = ruta.seguridad ?? 'sesion'
    const cadena = []
    if (seguridad === 'sesion' && ruta.nodoPortal) {
        // sesión (auth + empresa) o, sin ella, el token de un nodo portal (contrato nodo-portal.md)
        cadena.push(middleware.sesionONodo())
    } else if (seguridad === 'sesion') {
        cadena.push(middleware.auth())
        // multiempresa: `X-Empresa-Id` → ctx.empresa (403 empresa_no_permitida)
        cadena.push(middleware.empresa())
        if (ruta.permiso) cadena.push(middleware.autorizar({ permiso: ruta.permiso }))
        // Iris 0.7.0 (A23): actuar como el usuario vinculado, antes de idempotencia (sin replay
        // para una vinculación revocada o un usuario desactivado)
        if (ruta.actuarComoVinculado) {
            cadena.push(middleware.actuarComoVinculado({ permiso: ruta.actuarComoVinculado }))
        }
    }
    if (seguridad === 'interno') cadena.push(middleware.interno())
    if (ruta.idempotente) {
        cadena.push(middleware.idempotencia({ actorIris: idempotenciaPorActorIris(ruta) }))
    }

    const montada = router[ruta.metodo](PREFIJO_API + ruta.ruta, (ctx) => despachar(ruta, ctx))
        .as(ruta.operacion)
        .use(cadena)

    for (const nombre of parametrosDeRuta(ruta.ruta)) {
        if (esParametroEntero(nombre)) montada.where(nombre, router.matchers.number())
    }
    return montada
}
