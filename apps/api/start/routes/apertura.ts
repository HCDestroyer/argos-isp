/*
|--------------------------------------------------------------------------
| Rutas del cierre de los saldos de apertura (A3, localización fiscal §23)
|--------------------------------------------------------------------------
|
| Las monta `start/routes/ledger.ts`.
|
*/
import { definirRuta, type Ruta } from '#shared/rutas'
import { resolverEmpresaActiva } from '#core/empresas'
import { hoyGuatemala } from '#ledger/fechas'
import * as v from '#ledger/validators_apertura'
import { CierreApertura, EstadoApertura } from '#ledger/esquemas_apertura'
import { estadoApertura } from '#ledger/apertura'
import CerrarApertura from '#ledger/actions/cerrar_apertura'

const apertura: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/libro/apertura',
        operacion: 'libroApertura',
        resumen: 'Saldo de 2.9.01 Saldos de apertura y sus cierres',
        etiqueta: 'libro',
        permiso: 'libro.ver',
        query: v.estadoAperturaValidator,
        respuesta: { status: 200, descripcion: 'Saldo de apertura', esquema: EstadoApertura },
        handler: async (ctx, { query }) => {
            const contexto = ctx.contextoAccion()
            const empresaId = await resolverEmpresaActiva(
                query.empresa_id ? { ...contexto, empresaId: query.empresa_id } : contexto,
            )
            return estadoApertura(empresaId, query.fecha ?? hoyGuatemala())
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/libro/apertura/cerrar',
        operacion: 'libroCerrarApertura',
        resumen: 'Cerrar los saldos de apertura (2.9.01 → patrimonio)',
        etiqueta: 'libro',
        permiso: 'libro.cerrar_apertura',
        cuerpo: v.cerrarAperturaValidator,
        idempotente: true,
        descripcion:
            'Terminada la importación, traslada el saldo neto de 2.9.01 con fecha hasta fecha a la cuenta de patrimonio elegida (3.3.01 por defecto, o 3.1.01): asiento ajuste del diario VAR. Con el saldo en 0.00 no escribe nada (asiento: null). Respeta cierres y bloqueos: 422 periodo_cerrado, 409 bloqueo_duro, 422 periodo_bloqueado. Se corrige revirtiendo su asiento (POST /libro/asientos/:id/revertir).',
        respuesta: { status: 200, descripcion: 'Saldos de apertura cerrados', esquema: CierreApertura },
        handler: (ctx, { cuerpo }) => new CerrarApertura().execute(cuerpo, ctx.contextoAccion()),
    }),
]

export default apertura
