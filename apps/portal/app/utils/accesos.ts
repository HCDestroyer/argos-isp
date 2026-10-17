import Decimal from 'decimal.js'
import type { RouteLocationRaw } from 'vue-router'

/**
 * Accesos rápidos del inicio del cliente (`/cuenta`) y de `/corte`: tarjetas grandes con icono.
 *
 * Regla: **solo se ofrece lo que la API aceptaría ahora**. Cada acceso sale de un dato que la API
 * ya devolvió, nunca de una suposición:
 *
 * | Acceso | Aparece si | Por qué |
 * | --- | --- | --- |
 * | Pagar en línea | `empresa.pago_en_linea` y saldo > 0 y sin un pago en camino | `POST /portal/pagos/iniciar` responde 503 sin pasarela y 422 `sin_deuda` sin saldo |
 * | Subir comprobante | hay cuentas de depósito y el servicio no está retirado | `RegistrarComprobante` exige la cuenta de destino |
 * | Datos de depósito | hay cuentas o instrucciones de pago | si no, el modal no tendría nada que mostrar |
 * | Prometer pago | `GET /portal/promesas/condiciones` dice `disponible` y sin pago previo | la API rechaza (409/422) fuera de esas condiciones |
 * | Facturas | siempre (con sesión: la sección; por IP: entrar con el código) | |
 * | Vincular Telegram | con sesión, bot configurado (`disponible`) y aún sin vincular | |
 * | Contactar soporte | siempre | |
 *
 * Mientras un dato no se ha leído (`null`), el acceso que depende de él no aparece: mejor que
 * aparezca un momento después que ofrecer algo que falle.
 *
 * Multiempresa (contrato `.claude/integration/contratos/multiempresa.md`): los accesos marcados
 * `alcance: 'empresa'` se calculan por grupo de servicios de una misma empresa con los datos de
 * ESA empresa (`GET /portal/empresa?empresa_id=`: pago en línea, cuentas, instrucciones y
 * soporte); `alcance: 'cliente'` va una sola vez.
 */

export type IdAcceso = 'pagar' | 'comprobante' | 'deposito' | 'promesa' | 'facturas' | 'telegram' | 'soporte'

export interface AccesoRapido {
    id: IdAcceso
    titulo: string
    descripcion: string
    icono: string
    alcance: 'empresa' | 'cliente'
    /** Navega a esta ruta (enlace real: funciona con clic central, lector de pantalla y sin JS). */
    to?: RouteLocationRaw | string
    /** O abre algo en la misma página (modal de promesa, comprobante, depósito, pago). */
    accion?: 'pagar' | 'comprobante' | 'deposito' | 'promesa'
    externo?: boolean
}

export interface EntradaAccesos {
    /** `sesion`: cliente con código (`/cuenta`); `ip`: identificado por la conexión (`/corte`). */
    modo: 'sesion' | 'ip'
    /** Datos de la empresa leídos (`null` mientras carga o si falló). */
    empresa: Pick<EmpresaPublica, 'pago_en_linea' | 'cuentas_deposito' | 'instrucciones_pago'> | null
    /** Saldo pendiente del grupo (Dinero como texto) o `null` si no se pudo leer. */
    montoAdeudado: string | null
    /** Todos los servicios del grupo están retirados. */
    retirado: boolean
    /** Hay un pago en línea pendiente o confirmado (no ofrecer pagar otra vez). */
    pagoEnCamino?: boolean
    /** Resultado de las condiciones de promesa: `true` solo si se puede pedir ahora. */
    promesaDisponible: boolean | null
    /** `GET /portal/telegram` (solo con sesión). */
    telegram?: { disponible: boolean, vinculado: boolean } | null
    /** Contacto preferido de soporte (teléfono o `/contacto`). */
    soporte: { etiqueta: string, to: string, externo: boolean }
    /** Destino de "Facturas" con sesión (la sección de facturas de `/cuenta`). */
    rutaFacturas?: RouteLocationRaw | string
    /** Destino de "Vincular Telegram" con sesión. */
    rutaTelegram?: RouteLocationRaw | string
}

function conSaldo(monto: string | null): boolean {
    if (monto === null) {
        return false
    }
    try {
        return new Decimal(monto).greaterThan(0)
    }
    catch {
        return false
    }
}

export function accesosRapidos(entrada: EntradaAccesos): AccesoRapido[] {
    const accesos: AccesoRapido[] = []
    const { empresa } = entrada
    const saldo = conSaldo(entrada.montoAdeudado)

    if (empresa?.pago_en_linea && saldo && !entrada.retirado && !entrada.pagoEnCamino) {
        accesos.push({
            id: 'pagar',
            titulo: 'Pagar en línea',
            descripcion: 'Con tarjeta, en la página segura del proveedor',
            icono: 'i-lucide-credit-card',
            alcance: 'empresa',
            accion: 'pagar',
        })
    }
    if (empresa && empresa.cuentas_deposito.length > 0 && !entrada.retirado) {
        accesos.push({
            id: 'comprobante',
            titulo: 'Subir comprobante',
            descripcion: 'Foto o PDF del depósito o transferencia',
            icono: 'i-lucide-upload',
            alcance: 'empresa',
            accion: 'comprobante',
        })
    }
    if (empresa && (empresa.cuentas_deposito.length > 0 || Boolean(empresa.instrucciones_pago))) {
        accesos.push({
            id: 'deposito',
            titulo: 'Ver datos de depósito',
            descripcion: 'Cuentas para pagar en el banco',
            icono: 'i-lucide-landmark',
            alcance: 'empresa',
            accion: 'deposito',
        })
    }
    if (entrada.promesaDisponible === true && saldo && !entrada.retirado) {
        accesos.push({
            id: 'promesa',
            titulo: 'Prometer pago',
            descripcion: 'Elige el día en que vas a pagar',
            icono: 'i-lucide-hand-coins',
            alcance: 'empresa',
            accion: 'promesa',
        })
    }
    accesos.push(entrada.modo === 'sesion'
        ? {
                id: 'facturas',
                titulo: 'Facturas',
                descripcion: 'Ver o descargar el aviso de cobro',
                icono: 'i-lucide-receipt',
                alcance: 'empresa',
                to: entrada.rutaFacturas ?? '/cuenta?seccion=facturas',
            }
        : {
                id: 'facturas',
                titulo: 'Mis facturas y pagos',
                descripcion: 'Te enviamos un código para entrar',
                icono: 'i-lucide-receipt',
                alcance: 'empresa',
                to: '/entrar?por_ip=1',
            })
    if (entrada.modo === 'sesion' && entrada.telegram?.disponible && !entrada.telegram.vinculado) {
        accesos.push({
            id: 'telegram',
            titulo: 'Vincular Telegram',
            descripcion: 'Recibe avisos y tu código por Telegram',
            icono: 'i-lucide-send',
            alcance: 'cliente',
            to: entrada.rutaTelegram ?? '/cuenta?seccion=cuenta',
        })
    }
    accesos.push({
        id: 'soporte',
        titulo: 'Contactar soporte',
        descripcion: entrada.soporte.etiqueta,
        icono: 'i-lucide-headset',
        alcance: 'empresa',
        to: entrada.soporte.to,
        externo: entrada.soporte.externo,
    })
    return accesos
}

/**
 * Soporte: llamar al primer teléfono de la empresa (funciona con el servicio cortado) o su página
 * de contacto (`/contacto`, o `/contacto?empresa=<id>` para una empresa concreta en `/cuenta`).
 */
export function soporteDe(
    empresa: Parameters<typeof enlacesContacto>[0],
    rutaContacto = '/contacto',
): EntradaAccesos['soporte'] {
    const telefono = enlacesContacto(empresa).find(enlace => enlace.tipo === 'telefono')
    return telefono
        ? { etiqueta: `Llamar al ${telefono.valor}`, to: telefono.to, externo: true }
        : { etiqueta: 'Teléfonos, correo y horario', to: rutaContacto, externo: false }
}

/** Página de contacto de una empresa concreta (`/cuenta` con varias empresas). */
export function rutaContactoEmpresa(empresaId: number | null | undefined): string {
    return empresaId ? `/contacto?empresa=${empresaId}` : '/contacto'
}

/**
 * Lo que dicen las condiciones de promesa, reducido a "se puede pedir ahora": `disponible` y sin
 * pago previo pendiente (abono inicial o deuda máxima), que la API rechazaría.
 */
export function promesaPermitida(condiciones: Pick<CondicionesPromesa, 'disponible' | 'pago_previo'> | null): boolean | null {
    if (condiciones === null) {
        return null
    }
    return condiciones.disponible && !condiciones.pago_previo
}
