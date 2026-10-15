/*
|--------------------------------------------------------------------------
| Rutas del libro contable y cajas (A3)
|--------------------------------------------------------------------------
*/
import { definirRuta, type Ruta } from '#shared/rutas'
import { lista, pagina } from '#shared/openapi/esquemas'
import * as v from '#ledger/validators'
import { Asiento, Caja, CajaTurno, Cuenta, Mayor } from '#ledger/esquemas'
import { libroDiario, libroMayor, listarCuentas } from '#ledger/consultas'

const cajas: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/cajas',
        operacion: 'cajasListar',
        resumen: 'Listar cajas con su turno abierto',
        etiqueta: 'cajas',
        permiso: 'cajas.ver',
        respuesta: { status: 200, descripcion: 'Cajas', esquema: lista(Caja) },
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
        respuesta: { status: 200, descripcion: 'Turno cerrado', esquema: CajaTurno },
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

export default [...cajas, ...libro]
