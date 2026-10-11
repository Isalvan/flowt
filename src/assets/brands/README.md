# Logos de marcas

Estos ficheros identifican a cada servicio o banco en la interfaz. Son marcas de sus respectivos titulares; Flowt no está afiliado a ninguno de ellos.

## Procedencia

| Fichero | Origen |
|---|---|
| `spotify.svg`, `netflix.svg`, `googleplay.svg`, `googlegemini.svg`, `revolut.svg`, `caixabank.svg`, `n26.svg` | [Simple Icons](https://simpleicons.org) |
| `chatgpt.svg` | Marca oficial de OpenAI |
| `unicaja.png` | Icono de la web de Unicaja (`unicajabanco.es`) |
| `bbva.png` | Icono de la web de BBVA (`bbva.es`) |
| `santander.png` | Icono de la web de Banco Santander (`bancosantander.es`) |
| `ing.png` | Icono de la web de ING (`ing.es`) |
| `sabadell.png` | Icono de la web de Banco Sabadell (`bancsabadell.com`) |
| `traderepublic.png` | Icono de la web de Trade Republic (`traderepublic.com`) |

Los PNG se han reducido a un máximo de 128 px de lado, sin otros cambios.

## Añadir un banco

1. Añade su entrada a `tracker-backend/prompts/banks.json`.
2. Guarda aquí su icono y regístralo en `src/components/common/BankBadge.tsx`.
