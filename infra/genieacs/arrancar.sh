#!/bin/sh
# Arranca los cuatro servicios de GenieACS; si uno termina, el contenedor termina (y Docker lo reinicia).
set -e
genieacs-cwmp &
genieacs-nbi &
genieacs-fs &
genieacs-ui &
wait -n 2>/dev/null || wait
exit 1
