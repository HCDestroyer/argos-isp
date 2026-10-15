/*
|--------------------------------------------------------------------------
| Rutas del portal del cliente (A5)
|--------------------------------------------------------------------------
*/
import { definirRuta, type Ruta } from '#shared/rutas'
import { QuienSoy } from '#portal/esquemas'

const portal: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/portal/quien-soy',
        operacion: 'portalQuienSoy',
        resumen: 'Identifica al cliente por la IP de origen (página de corte)',
        descripcion: 'Sin login. Solo devuelve nombre parcial, estado y monto adeudado.',
        etiqueta: 'portal',
        seguridad: 'publico',
        permiso: null,
        respuesta: { status: 200, descripcion: 'Identificación mínima', esquema: QuienSoy },
    }),
]

export default portal
