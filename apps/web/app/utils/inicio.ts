/**
 * Página de inicio de cada usuario. El rol `cajero` (sin `admin`) entra directo a su caja: es donde
 * abre el turno, ve sus cobros y cierra con arqueo. El resto, al tablero.
 */
export function rutaInicio(usuario: { roles: string[], permisos: string[] } | null): string {
    if (usuario && usuario.roles.includes('cajero') && !usuario.roles.includes('admin') && usuario.permisos.includes('cajas.ver')) {
        return '/caja'
    }
    return '/'
}
