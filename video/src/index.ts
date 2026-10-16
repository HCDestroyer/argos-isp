import { registerRoot } from 'remotion'
import puntos from '../public/capturas/puntos.json'
import { type PuntoExterno, aplicarPuntos } from './guion'
import { Root } from './Root'

// Coordenadas medidas sobre las capturas reales (si las hay). Se aplican antes
// del primer render; una lista vacía deja los puntos del guion tal cual.
for (const aviso of aplicarPuntos(puntos as PuntoExterno[])) {
    console.warn(aviso)
}

registerRoot(Root)
