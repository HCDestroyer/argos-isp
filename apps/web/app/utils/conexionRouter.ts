import type { Schema, paths } from '@argosisp/contracts'
import * as z from 'zod'

type RouterApi = Schema<'Router'>
type CambiosRouterApi = paths['/api/v1/routers/{id}']['put']['requestBody']['content']['application/json']

/** Qué hacer con la CA en PEM: nunca se muestra de vuelta, solo se reemplaza o se quita. */
export type AccionCa = 'mantener' | 'reemplazar' | 'quitar'

const API_URL = /^https?:\/\/[^\s/]+(:\d{1,5})?\/?$/
const PEM = /^-----BEGIN CERTIFICATE-----/

/**
 * Espejo de `camposConexionApi` (A1, `apps/api/app/network/validators.ts`): los cinco campos de
 * conexión de la API REST de RouterOS (`contratos/routeros.md`). Un texto vacío viaja como `null`
 * (la API usa entonces su valor por defecto). La CA solo viaja al reemplazarla o quitarla.
 */
export const esquemaConexionRouter = z.object({
    api_url: z.string()
        .trim()
        .max(300, 'Máximo 300 caracteres')
        .refine(valor => valor === '' || API_URL.test(valor), 'Escribe https://host o https://host:puerto, sin ruta'),
    api_tls_verificar: z.boolean(),
    accion_ca: z.enum(['mantener', 'reemplazar', 'quitar']),
    api_ca: z.string().trim().max(20_000, 'Máximo 20 000 caracteres'),
    dhcp_servidor: z.string().trim().max(100, 'Máximo 100 caracteres'),
    interfaz_clientes: z.string().trim().max(100, 'Máximo 100 caracteres'),
}).superRefine((datos, ctx) => {
    if (datos.accion_ca === 'reemplazar' && !PEM.test(datos.api_ca)) {
        ctx.addIssue({ code: 'custom', path: ['api_ca'], message: 'Pega el certificado en PEM: empieza con -----BEGIN CERTIFICATE-----' })
    }
})

export type EntradaConexionRouter = z.input<typeof esquemaConexionRouter>
export type SalidaConexionRouter = z.output<typeof esquemaConexionRouter>

/** Estado inicial del formulario: la CA nunca se copia al formulario, solo si existe. */
export function entradaConexionRouter(router: Pick<RouterApi, 'api_url' | 'api_tls_verificar' | 'dhcp_servidor' | 'interfaz_clientes'>): EntradaConexionRouter {
    return {
        api_url: router.api_url ?? '',
        api_tls_verificar: router.api_tls_verificar,
        accion_ca: 'mantener',
        api_ca: '',
        dhcp_servidor: router.dhcp_servidor ?? '',
        interfaz_clientes: router.interfaz_clientes ?? '',
    }
}

/** Cuerpo de `PUT /routers/:id` con la `version` leída: vacío → `null`; la CA solo si cambia. */
export function cambiosConexionRouter(datos: SalidaConexionRouter, version: number): CambiosRouterApi {
    const cambios: CambiosRouterApi = {
        version,
        api_url: datos.api_url || null,
        api_tls_verificar: datos.api_tls_verificar,
        dhcp_servidor: datos.dhcp_servidor || null,
        interfaz_clientes: datos.interfaz_clientes || null,
    }
    if (datos.accion_ca === 'reemplazar') {
        cambios.api_ca = datos.api_ca
    }
    if (datos.accion_ca === 'quitar') {
        cambios.api_ca = null
    }
    return cambios
}
