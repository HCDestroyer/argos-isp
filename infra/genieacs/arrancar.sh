#!/bin/bash
# Arranca los cuatro servicios de GenieACS; si uno termina, el contenedor termina (y Docker lo reinicia).
set -e
genieacs-cwmp &
genieacs-nbi &
genieacs-fs &
genieacs-ui &
wait -n
exit 1
