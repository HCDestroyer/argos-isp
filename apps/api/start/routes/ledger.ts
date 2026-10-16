/*
|--------------------------------------------------------------------------
| Rutas del libro contable y cajas (A3)
|--------------------------------------------------------------------------
*/
import { definirRuta, type Ruta } from '#shared/rutas'
import { lista, pagina } from '#shared/openapi/esquemas'
import * as v from '#ledger/validators'
import { Asiento, Caja, CajaTurno, CategoriaEgreso, Cuenta, Egreso, Mayor } from '#ledger/esquemas'
import { dimensionesDeEgreso, listarCategoriasEgreso, listarEgresos, verEgreso } from '#ledger/egresos'
import { cajaPrincipalId } from '#billing/pagos'
import RegistrarEgreso from '#ledger/actions/registrar_egreso'
import AnularEgreso from '#ledger/actions/anular_egreso'
import { libroDiario, libroMayor, listarCuentas } from '#ledger/consultas'
import { cajaDelCajero, existeCaja, listarCajas, listarTurnos } from '#ledger/cajas'
import { exigirAlcance } from '#core/acl'
import AbrirCaja from '#ledger/actions/abrir_caja'
import CerrarCaja from '#ledger/actions/cerrar_caja'

const cajas: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/cajas',
        operacion: 'cajasListar',
        resumen: 'Listar cajas con su turno abierto',
        etiqueta: 'cajas',
        permiso: 'cajas.ver',
        respuesta: { status: 200, descripcion: 'Cajas', esquema: lista(Caja) },
        handler: (ctx) => listarCajas(ctx.alcance),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/cajas/:id/abrir',
        operacion: 'cajasAbrir',
        resumen: 'Abrir turno de caja',
        etiqueta: 'cajas',
        permiso: 'cajas.abrir',
        cuerpo: v.abrirCajaValidator,
        idempotente: true,
        respuesta: { status: 201, descripcion: 'Turno abierto', esquema: CajaTurno },
        handler: async (ctx, { cuerpo, params }) => {
            const id = Number(params.id)
            await existeCaja(id)
            exigirAlcance(ctx.alcance, { caja: [id] })
            return new AbrirCaja().execute(
                { caja_id: id, fondo_inicial: cuerpo.fondo_inicial },
                ctx.contextoAccion(),
            )
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/cajas/:id/cerrar',
        operacion: 'cajasCerrar',
        resumen: 'Cerrar turno de caja (esperado vs contado)',
        etiqueta: 'cajas',
        permiso: 'cajas.cerrar',
        cuerpo: v.cerrarCajaValidator,
        idempotente: true,
        descripcion:
            'esperado = fondo_inicial + pagos vigentes del turno; diferencia = contado − esperado. Con diferencia ≠ 0 el motivo es obligatorio (422) y queda un asiento cierre_caja (faltante o sobrante). Emite caja.cerrada. 409 si no hay turno abierto.',
        respuesta: { status: 200, descripcion: 'Turno cerrado', esquema: CajaTurno },
        handler: async (ctx, { cuerpo, params }) => {
            const id = Number(params.id)
            await existeCaja(id)
            exigirAlcance(ctx.alcance, { caja: [id] })
            return new CerrarCaja().execute(
                { caja_id: id, contado: cuerpo.contado, motivo: cuerpo.motivo },
                ctx.contextoAccion(),
            )
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/cajas/:id/turnos',
        operacion: 'cajasTurnos',
        resumen: 'Turnos de una caja',
        etiqueta: 'cajas',
        permiso: 'cajas.ver',
        query: v.listarTurnosValidator,
        respuesta: { status: 200, descripcion: 'Página de turnos', esquema: pagina(CajaTurno) },
        handler: async (ctx, { query, params }) => {
            const id = Number(params.id)
            await existeCaja(id)
            exigirAlcance(ctx.alcance, { caja: [id] })
            return listarTurnos(id, query)
        },
    }),
]

const libro: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/libro/cuentas',
        operacion: 'libroCuentas',
        resumen: 'Plan de cuentas',
        etiqueta: 'libro',
        permiso: 'libro.ver',
        respuesta: { status: 200, descripcion: 'Cuentas', esquema: lista(Cuenta) },
        handler: () => listarCuentas(),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/libro/diario',
        operacion: 'libroDiario',
        resumen: 'Libro diario: asientos con sus movimientos',
        etiqueta: 'libro',
        permiso: 'libro.ver',
        query: v.diarioValidator,
        respuesta: { status: 200, descripcion: 'Página de asientos', esquema: pagina(Asiento) },
        handler: (_ctx, { query }) => libroDiario(query),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/libro/mayor',
        operacion: 'libroMayor',
        resumen: 'Libro mayor de una cuenta (o auxiliar de un cliente)',
        etiqueta: 'libro',
        permiso: 'libro.ver',
        query: v.mayorValidator,
        respuesta: { status: 200, descripcion: 'Mayor de la cuenta', esquema: Mayor },
        handler: (_ctx, { query }) => libroMayor(query),
    }),
]

const egresos: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/egresos/categorias',
        operacion: 'egresosCategorias',
        resumen: 'Categorías de egreso con su cuenta de gasto',
        etiqueta: 'egresos',
        permiso: 'egresos.ver',
        respuesta: { status: 200, descripcion: 'Categorías', esquema: lista(CategoriaEgreso) },
        handler: () => listarCategoriasEgreso(),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/egresos',
        operacion: 'egresosListar',
        resumen: 'Listar egresos',
        etiqueta: 'egresos',
        permiso: 'egresos.ver',
        query: v.listarEgresosValidator,
        respuesta: { status: 200, descripcion: 'Página de egresos', esquema: pagina(Egreso) },
        handler: (ctx, { query }) => listarEgresos(query, ctx.alcance),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/egresos/:id',
        operacion: 'egresosVer',
        resumen: 'Ver egreso',
        etiqueta: 'egresos',
        permiso: 'egresos.ver',
        respuesta: { status: 200, descripcion: 'Egreso', esquema: Egreso },
        handler: async (ctx, { params }) => {
            const id = Number(params.id)
            exigirAlcance(ctx.alcance, await dimensionesDeEgreso(id))
            return verEgreso(id)
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/egresos',
        operacion: 'egresosRegistrar',
        resumen: 'Registrar egreso (asiento Gasto / Caja o Banco)',
        etiqueta: 'egresos',
        permiso: 'egresos.registrar',
        cuerpo: v.registrarEgresoValidator,
        idempotente: true,
        descripcion:
            'La categoría decide la cuenta de gasto. Con metodo caja el efectivo sale del turno abierto de la caja (baja el esperado del cierre); sin caja_id, la caja del turno abierto del usuario o la principal. 422 con un error por campo (no_aplica si se manda el origen de otro método).',
        respuesta: { status: 201, descripcion: 'Egreso registrado', esquema: Egreso },
        handler: async (ctx, { cuerpo }) => {
            const cajaId =
                cuerpo.metodo === 'caja'
                    ? (cuerpo.caja_id ??
                      (await cajaDelCajero(ctx.auth.user?.id ?? null, ctx.alcance)) ??
                      (await cajaPrincipalId()))
                    : cuerpo.caja_id
            if (cuerpo.metodo === 'caja' && cajaId) exigirAlcance(ctx.alcance, { caja: [cajaId] })
            return new RegistrarEgreso().execute({ ...cuerpo, caja_id: cajaId }, ctx.contextoAccion())
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/egresos/:id/anular',
        operacion: 'egresosAnular',
        resumen: 'Anular egreso (asiento de reverso)',
        etiqueta: 'egresos',
        permiso: 'egresos.anular',
        cuerpo: v.anularEgresoValidator,
        idempotente: true,
        descripcion: 'El reverso va con fecha de hoy (periodo abierto). 409 egreso_anulado si ya lo estaba.',
        respuesta: { status: 200, descripcion: 'Egreso anulado', esquema: Egreso },
        handler: async (ctx, { cuerpo, params }) => {
            const id = Number(params.id)
            exigirAlcance(ctx.alcance, await dimensionesDeEgreso(id))
            return new AnularEgreso().execute({ egreso_id: id, motivo: cuerpo.motivo }, ctx.contextoAccion())
        },
    }),
]

export default [...cajas, ...libro, ...egresos]
