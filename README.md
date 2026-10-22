# Tincho Challenge — leaderboard

Página con el rango, winrate e historial de SoloQ de cada participante del torneo.
Todo corre gratis en **Cloudflare Pages** (sitio + funciones de servidor).

## Qué APIs usa

| Para qué | API | ¿Necesita key? |
|---|---|---|
| Riot ID → PUUID | Riot `account-v1` (`americas`) | Sí |
| Rango, LP, victorias y derrotas | Riot `league-v4` `entries/by-puuid` (`la2`) | Sí |
| Ícono de la cuenta | Riot `summoner-v4` `summoners/by-puuid` (`la2`) | Sí |
| Historial de partidas del torneo | Riot `match-v5` (`americas`, cola 420 = SoloQ) | Sí |
| Imágenes de campeones e íconos de cuenta | Data Dragon (CDN de Riot) | No |
| Emblema de cada rango | Community Dragon (archivos del cliente del juego) | No |
| Perfil completo de cada jugador | Link a OP.GG | No |

### ¿Y la API de OP.GG?
OP.GG **no tiene una API REST pública** para sitios web. Lo que sí publicó es el
**OP.GG MCP Server** (`https://mcp-api.op.gg/mcp`), pensado para conectar sus datos
a asistentes de IA (por ejemplo, Claude), no para alimentar una página pública.
Por eso los datos salen de la API oficial de Riot (que es la misma fuente que usa
OP.GG) y cada Riot ID enlaza a su perfil en OP.GG.

## Estructura

```
public/               ← el sitio (HTML, CSS, JS) + participants.json
  index.html, app.js  página principal
  podio.html, podio.js  podio final por categoría y podio de Pickems
  reglas.html, reglas.js  reglas del torneo
  pickems.html, pickems.js  Pickems: predicciones antes del torneo
  admin.html, admin.js  panel privado del organizador
  shared.js           lo que comparten las páginas (escudo, íconos, podios, Kick)
functions/api/        ← endpoints que corren en Cloudflare (esconden la API key)
  leaderboard.js      GET /api/leaderboard
  player/[puuid].js   GET /api/player/:puuid
  diag.js             GET /api/diag (revisa la API key sin mostrarla)
  admin.js            GET /api/admin (panel del organizador, pide clave)
  pickems.js          GET y POST /api/pickems (votar y ver resultados)
lib/riot.js           cliente de Riot con caché (KV + Cache API)
lib/lp.js             LP por partida (fotos del rango en Cloudflare KV)
lib/duo.js            posibles dúos (últimas 12 partidas) e histórico de alertas
lib/pickems.js        preguntas, puntos y resultados de los Pickems
lib/demo.js           datos de ejemplo
```

La API key **nunca llega al navegador**: el navegador le pide a `/api/...` y la
función de Cloudflare es la que habla con Riot. Además se cachean las respuestas
para no pasarse de los límites (ver "Límites del plan gratis").

## Configurar el torneo

Editá `public/participants.json`:

```json
{
  "title": "Tincho Challenge",
  "edition": "Edición II",
  "start": "2026-10-16T18:00:00-03:00",   // viernes 16/10 a las 18:00
  "end":   "2026-11-16T00:00:00-03:00",   // medianoche del día 31
  "platform": "la2",        // LAS. LAN = la1, BR = br1, NA = na1, EUW = euw1
  "region": "americas",     // europe para EUW, asia para KR
  "opggRegion": "las",
  "dailyLimit": 8,          // partidas que suma el banco por día
  "freeLastDays": 3,        // últimos días con el cupo liberado
  "advance": 2,             // partidas que se pueden adelantar (opcional, 2 por defecto)
  "penalty": 8,             // penalización por pasarse del adelanto (opcional, = dailyLimit)
  "duo": { "streak": 2, "highStreak": 3, "perDay": 4, "neverAgainst": 5 },
  "highEloFrom": { "tier": "DIAMOND", "rank": "III" },   // corte High / Low Elo
  "pickems": { "closes": "2026-10-17T18:00:00-03:00" }, // cierre de la votación
  "players": [
    { "riotId": "NombreEnJuego#TAG" },
    { "riotId": "TDG Kairo#TDG", "kick": "nkairoo" },
    { "riotId": "Otro#LAS", "alias": "Nacho", "baseline": { "wins": 12, "losses": 9 } }
  ]
}
```

Cada opción está explicada en su sección: "Banco de partidas" (`dailyLimit`,
`freeLastDays`, `advance`, `penalty`), "Panel del organizador" (`duo`), "Top 3 y
podio final" (`highEloFrom`), "Pickems" (`pickems`) y "Canal de Kick" (`kick`).

- De cada jugador alcanza con el `riotId`, que es el `Nombre#TAG` real. En la tabla se
  muestra **el mismo nick, sin el `#TAG`** ("TDG Kairo#TDG" se ve como "TDG Kairo").
  `alias` es opcional: solo hace falta si querés mostrar otro nombre.
- La Edición II tiene **19 participantes**, todos de LAS: `TDG KiwiMau#love`,
  `TDG Kairo#TDG`, `TDG Maomao#TDG`, `TDG Martin#TDG`, `TDG AngeloPe#TDG`,
  `TDG Dark Matter#TDG`, `TDG WeepingAngel#TDG`, `TDG Meleys#TDG`,
  `TDG Esponjaa#TDG`, `TDG Lævatæn#TDG`, `tdg ASOLutosex#TDG`,
  `TDG Anti Lucky#TDG`, `TDG Minerva#TDG`, `TDG Yun te amo#TDG`,
  `TDG Minikeen#1207`, `TDG TeCjo#TDG`, `TDGfasito#TDG`, `TDG LILIAMPAYNE#TDG` y
  `TDG troglodita#TDG`. Para sumar o
  cambiar jugadores, editá la lista `players`, una línea por cada uno. El `#TAG`
  tiene que ser exacto. No uses Riot IDs inventados de relleno: pueden coincidir
  con cuentas reales de otra gente.
- Con la lista vacía el sitio funciona igual: la tabla dice "Los participantes se
  anuncian pronto" y el Top 3 muestra los tres lugares como "Por definir".
- Al sacar a alguien de la lista, lo que el sitio tenía guardado de esa cuenta (LP
  por partida, banco, alertas) se borra solo la próxima vez que se abre el panel
  del organizador.
- `baseline` (opcional): las victorias/derrotas que tenía el jugador **el día que
  empezó el torneo**. Si lo cargás, el V–D y el winrate cuentan solo lo jugado
  durante el torneo. Si no, se muestra el total de la temporada.

## Conseguir la API key de Riot

1. Entrá a https://developer.riotgames.com con tu cuenta de Riot.
2. Para probar, copiá la **Development API Key** (vence cada 24 h).
3. Para dejar la página online, registrá un producto → **Personal API Key**.
   No vence, alcanza para un torneo entre amigos y Riot no permite mantener un
   sitio público con la key de desarrollo. La aprobación puede tardar unos días,
   así que pedila apenas puedas.

## Publicarla gratis en Cloudflare Pages

1. El código ya está en GitHub: https://github.com/Naueru-AR/Tincho-Challenge
   (ver [Repositorio](#repositorio)).
2. En https://dash.cloudflare.com → **Workers & Pages** → **Create** → **Pages** →
   **Connect to Git** y elegí el repo.
3. Configuración del build:
   - Framework preset: **None**
   - Build command: *(vacío)*
   - Build output directory: `public`
4. **Settings → Variables and Secrets** → agregá `RIOT_API_KEY` como *Secret*
   (en Production y Preview).
5. Deploy. Te queda una URL tipo `https://soloq-challenge.pages.dev`.

Cada vez que hagas push (por ejemplo, para cambiar participantes) se republica sola.

Sin `RIOT_API_KEY`, o agregando `?demo` a la URL, la página muestra datos de ejemplo.
Si la lista de participantes está vacía, el modo de ejemplo usa seis jugadores
inventados ("Ejemplo Uno"…), para poder ver igual cómo queda todo.

### Si la tabla muestra "Riot respondió 401" o 403

Abrí `https://TU-SITIO.pages.dev/api/diag`. No muestra la key, solo su forma y lo
que contesta Riot:

- `present: false` → la variable no existe en ese entorno (o falta redeployar).
- `validFormat: false` → el valor guardado no es una key limpia. Tiene que medir 42
  caracteres (`length`), empezar con `RGAPI-` y no tener espacios, comillas ni `=`.
- `riotStatus: 401` con formato válido → Riot no reconoce esa key (se regeneró otra
  después, o se copió una vieja).
- `riotStatus: 403` → la key venció (la de desarrollo dura 24 h).

### Al cambiar de API key

Riot cifra los PUUID con cada key: uno obtenido con una key da **400** si se usa con
otra. Por eso la caché se guarda separada por key (`lib/riot.js`) y al cambiarla no
hay que hacer nada más. Lo único que se pierde son los LP por partida ya guardados
en KV, porque quedan asociados a los PUUID de la key anterior.

## Probarla en tu computadora

Necesitás **Node.js** (trae `npm`). En Windows se instala con:

```bash
winget install --id OpenJS.NodeJS.LTS -e
```

Después de instalarlo abrí una terminal nueva, para que reconozca `node` y `npm`.
El proyecto está probado con Node 24 LTS y wrangler 4.

```bash
npm install
npm run dev        # abre http://localhost:8788
```

`npm install` baja `wrangler` (el servidor de prueba de Cloudflare) a `node_modules/`.
Las versiones exactas quedan fijadas en `package-lock.json`, que sí va al repo.

Así como está muestra los datos de ejemplo. Para ver datos reales, creá a mano un
archivo `.dev.vars` en la raíz del proyecto (podés copiar `.dev.vars.example`) con
tu key:

```
RIOT_API_KEY=RGAPI-tu-key
```

Ahí también va `ADMIN_KEY`, la clave del panel del organizador para pruebas locales.

- `.dev.vars` **no viene con el proyecto** y está en el `.gitignore`: guarda tu key
  y nunca se sube a GitHub. Cada uno crea el suyo.
- Solo sirve para probar en local. El sitio publicado usa el secret `RIOT_API_KEY`
  de Cloudflare.
- En Windows crealo desde el editor y no con `echo ... > .dev.vars`: PowerShell
  puede guardarlo en una codificación que wrangler no lee bien.

## Repositorio

El proyecto vive en https://github.com/Naueru-AR/Tincho-Challenge, rama `main`.
La carpeta local ya está conectada a ese repositorio (`origin`).

Para guardar y publicar un cambio:

```bash
git add -A
git commit -m "Descripción del cambio"
git push
```

La primera vez que hacés push desde una PC, Git abre una ventana para iniciar
sesión en GitHub; después queda guardado.

### Backups de producción

Antes de un cambio grande se guarda una copia de lo que está publicado como
*tag* de Git. Los que hay:

- `backup-produccion-2026-10-09`: el sitio antes del rediseño (Top 3, menú, podio
  final, límite diario).
- `backup-produccion-2026-10-09-b`: el sitio con el rediseño, antes de agregar el
  panel del organizador y el botón Admin.
- `backup-produccion-2026-10-09-c`: con el panel del organizador, antes de pasar la
  caché a KV (el panel fallaba con "Too many subrequests").
- `backup-produccion-2026-10-09-d`: con la caché en KV y el panel revisando las
  últimas 12 partidas, antes de los refuerzos para 20 jugadores.
- `backup-produccion-2026-10-09-e`: con el ícono de la pestaña, las seis cuentas de
  prueba y la página de Premios, antes de pasar a Reglas, banco de partidas y
  fechas reales.
- `backup-produccion-2026-10-09-f`: con Reglas, banco de partidas, fechas reales y la
  lista de participantes vacía, antes de cambiar el panel a "jugadores sin banco"
  y el texto del inicio.
- `backup-produccion-2026-10-09-g`: con el panel de "jugadores sin banco" y el texto
  nuevo del inicio, antes de pasar a Edición II y sumar la regla de la prenda.
- `backup-produccion-2026-10-21`: el torneo en curso con Pickems, banco con adelanto y
  penalización, Kick, total en la columna Winrate y los datos de cada partida (carril,
  P/Kill, CS, elo promedio, MVP/ACE y rachas), antes de completar el carril de las
  partidas del día y de abrir cada partida en League of Graphs.

Para ver los backups y volver a uno:

```bash
git tag -l "backup-*"
```

```bash
git revert --no-commit backup-produccion-2026-10-09..HEAD
```

El segundo comando deja el proyecto como estaba en ese backup, sin borrar el
historial; después hay que hacer `git commit` y `git push` para publicarlo.

No se suben al repo (están en el `.gitignore`): `node_modules/`, `.wrangler/`,
`.dev.vars` y `.claude/` (configuración local de Claude Code).

## Top 3 y podio final

**Top 3** (página principal, arriba de la tabla): los tres primeros de la tabla
general, sin separar por categoría. Cada tarjeta muestra el ícono de la cuenta, con
una corona en la esquina para el primero, una medalla de plata para el segundo y
una de bronce para el tercero. Si hay menos de tres jugadores con
rango, los lugares que faltan dicen "Por definir".

**Podio final** (`podio.html`): una página aparte con **seis lugares**: los tres
primeros de High Elo y los tres primeros de Low Elo, con las mismas tarjetas que el
Top 3 del inicio (ícono de la cuenta, corona y medallas). Se habilita sola cuando termina el torneo (fecha `end`): recién ahí aparece
el botón "Ver el podio final" en el encabezado. Antes de esa fecha la página solo
avisa cuándo se habilita. Para verla antes y probarla, abrí `/podio?preview`.
Al final de esa página va también el **podio de Pickems** (los tres que más puntos
sacaron), que aparece cuando termina el recuento (ver "Pickems").

### Ícono de la cuenta

En el Top 3, en el podio final y en la tabla de posiciones cada jugador aparece
con el **ícono de invocador** que tiene puesto en su cuenta de LoL (Riot
`summoner-v4`, en caché 6 horas; la imagen sale de Data Dragon). Al pasar el
mouse se resalta y al hacer clic abre su perfil en OP.GG en otra pestaña. Si el
ícono no se puede cargar, se muestra la inicial del jugador.

El corte entre las dos categorías (High Elo y Low Elo) se define en `participants.json`:

```json
"highEloFrom": { "tier": "DIAMOND", "rank": "III" }
```

- **High Elo**: desde ese rango inclusive (Diamante III o más).
- **Low Elo**: todo lo que esté por debajo (Diamante IV o menos).
- La categoría se calcula con el **rango actual**. Para dejar fijo a un jugador,
  agregale `"bracket": "high"` o `"bracket": "low"`.
- Los jugadores sin rango no entran en ningún podio.

El orden de la página principal es: encabezado, Top 3, tabla de posiciones y, al
final, la escalera.

### Égida de Valor

Arriba, en la esquina del ícono de cada jugador, aparece el **ícono oficial de la Égida de
Valor** (`public/aegis.png`, una copia chica del que publica Community Dragon:
`valor-aegis-emblem-priority-role-medium.png`) con la cantidad de **Égidas** que lleva (la protección que da Riot por autofill o carril
prioritario). Si no tiene ninguna, no aparece.

Riot no informa en su API si una partida tuvo Égida, así que se **deduce por los LP**:
la Égida da el **doble** de LP en una victoria. Como lo que se gana va cambiando a
medida que el jugador se acerca a su elo, se compara con la **mediana de sus últimas 5
victorias normales** (sin Égida): si viene ganando +30, cuenta una de +60; si viene
ganando +20, una de +40 (desde 1,8 veces, por si varía 1 o 2 LP). Se usa la mediana y no
solo la última victoria porque una victoria rara (por ejemplo +15 por un cambio de
división) no tiene que mover la referencia: con la última sola, a TDG Lævatæn todas las
+30 siguientes le contaban como Égida (llegó a 17 en lugar de 1). Las derrotas no se
tienen en cuenta, y las **primeras 5 victorias** registradas de cada jugador tampoco (en
una cuenta nueva los LP varían mucho), aunque sí sirven de referencia. Depende de los LP por partida (ver "LP por
partida"): una partida sin LP registrados no puede contar. El contador se guarda en
`snap:<puuid>` (`aegis`) y la regla está en `lib/lp.js` (`isAegis`).

### Canal de Kick

Si un participante transmite en Kick, se le agrega `"kick": "<canal>"` en
`participants.json` (por ejemplo `{ "riotId": "TDG Kairo#TDG", "kick": "nkairoo" }`).
En la tabla aparece una K verde chiquita al lado de su nombre, que abre
`https://kick.com/<canal>` en otra pestaña.

## Tabla de posiciones

Cada fila muestra el puesto, el ícono de la cuenta con el nombre, el rango y el
winrate:

- **Rango**: lleva el emblema oficial del rango (Hierro, Bronce… Retador) al lado
  del nombre y los LP. Las imágenes salen de Community Dragon; si alguna no carga,
  queda solo el texto.
- **Winrate · V / D / P** (victorias / derrotas / partidas): el porcentaje (verde si es 50 % o más, rojo si es menos),
  las victorias, las derrotas y el total de partidas ("101V · 97D · 198") y, debajo, una barra partida en dos: el
  tramo verde es proporcional a las victorias y el rojo a las derrotas.

## Menú y reglas

La barra superior tiene el escudo (lleva al inicio) y cuatro opciones:

- **Ranking**: baja directo a la tabla de posiciones.
- **Podio**: abre `podio.html` (el podio final por categoría y el de Pickems).
- **Pickems**: abre `pickems.html` (ver "Pickems").
- **Reglas**: abre `reglas.html`.

Las partidas por día, los días de cupo liberado, el adelanto y la penalización que
muestran las reglas salen de `dailyLimit`, `freeLastDays`, `advance` y `penalty`, así
que al cambiarlos en `participants.json` se actualizan solos en las reglas, en el
historial y en el panel.

Las reglas están escritas a mano en `public/reglas.html`, agrupadas por tema. Cada
regla es un `<li>` con un título y un texto; para cambiarlas o sumar una se edita
ese archivo:

- `<li class="no">` con la etiqueta "Prohibido": sale en rojo.
- `<li class="ok">` con la etiqueta "Permitido": sale en verde.
- `<li>` sin clase: informativa, en dorado.

Los bloques actuales son: el formato (se juega solo, banco de partidas, adelanto de
hasta 2 partidas, penalización por pasarse y cupo liberado), lo prohibido, las partidas previas a SoloQ, qué pasa si te cruzás con
otro participante, el castigo para el último puesto al terminar, y el espíritu del
torneo.

Antes ahí había una página de Premios; el enlace viejo (`/premios`) redirige a las
reglas (`public/_redirects`).

## Diseño

Todo el estilo está en `public/styles.css`; los colores son variables en `:root`.

- **Escudo de la barra superior**: el escudo con la T lleva el nombre del torneo
  adentro, en dos cintas cortas que apenas sobresalen (las primeras palabras en la
  dorada, la última en la de abajo). Sale del `title` de `participants.json` y se comprime solo si es largo.
  Lleva al inicio y, al pasar el mouse, se inclina, brilla y le cruza un destello.
- **Ícono de la pestaña**: `public/favicon.svg`, el mismo escudo de la barra
  superior. Si cambia el nombre del torneo, hay que editar el texto a mano ahí.
- **Cuenta regresiva automática**: antes del inicio cuenta hasta que arranca el
  torneo; desde ese momento cuenta sola hasta que termina; y al terminar muestra
  "Torneo terminado" y aparece el botón del podio final. En los últimos 3 días
  (cupo liberado) suma debajo el cartel "Banco de partidas sin límite". Todo sale
  de `start`, `end` y `freeLastDays`; no hay que tocar nada a mano.
- **Encabezado centrado**: título en itálica con el año "fantasma" detrás (solo
  contorno), fechas, cantidad de jugadores, cuenta regresiva y botón.
- **Sol de rayos dorados** girando muy lento detrás del título (`.hero-rays`). Se
  detiene si el sistema pide menos animaciones.
- **Formas inclinadas**: las cajas de la cuenta regresiva, el botón y los títulos
  comparten la misma inclinación (`--slant`).
- **Pie de página**: letra chica, con el aviso legal de Riot y el copyright
  "© 2026 Tincho Challenge". El año está escrito a mano en los tres `.html`.
- **Colores**: fondo oscuro y dorado como base; el celeste (`--sky`) es el acento
  secundario. El rojo queda solo para derrotas.

## Banco de partidas

No hay un tope fijo por día sino un **banco acumulable**. Cada día del torneo se
suman 8 partidas de SoloQ al banco de cada jugador, y las que no juega quedan
guardadas para los días siguientes. Si hoy juega 4, mañana tiene 12.

**El torneo dura 31 días: 28 con banco y los últimos 3 con el cupo liberado**, en
los que se puede jugar sin límite. Por eso el banco máximo es 28 × 8 = 224
partidas.

La duración sale de las fechas `start` y `end` de `participants.json`. Lo que
cuenta son los **días de calendario**: entre el día de `start` y el último día de
juego tiene que haber 31. Esta edición empieza el **viernes 16 de octubre a las
18:00** y termina a la medianoche del 15 de noviembre (`end` es el 16 a las 00:00).
El cupo se libera el 13, 14 y 15 de noviembre.

**Adelanto y penalización.** Se pueden adelantar hasta **2 partidas**: el banco
puede quedar en −1 o −2, y eso se descuenta de los días siguientes (si tiene 8 y juega
10, al otro día arranca con 6). Si un día juega y queda con más de 2 adelantadas, se
le aplica **sola** una **penalización de 8 partidas**, que se restan de sus partidas
del torneo. Mientras la cumple, su banco se muestra en **0**, con el cartel
"Penalización de 8 partidas" y el día en que vuelve a tener partidas. Ejemplo: con 8
juega 11 → debe 3 + 8 = 11; al día siguiente suma 8 y sigue en 0 (debe 3); al otro
arranca con 5. Si juega mientras la está cumpliendo, se suma otra penalización. En el
panel Admin se ve el saldo real (negativo) y los días en que lo penalizaron. Los dos
números se cambian en `participants.json` con `"advance": 2` y `"penalty": 8` (por
defecto, la penalización es igual a `dailyLimit`).

**Cada partida cuenta para el día en que empezó**, en el banco, en el historial de
"hoy" y en los Pickems. Una que arranca a las 23:47 y termina a las 00:12 es del día
anterior, y no aparece en el historial ni descuenta del banco del día siguiente. Las
que empezaron antes de `start` no cuentan, aunque terminen después.

El primer día cuenta como un día entero para el banco (suma sus 8 partidas),
aunque el torneo arranque a las 18:00. Lo que se haya jugado antes de esa hora no
cuenta: ni descuenta del banco ni genera alertas en el panel.

Las partidas por día y los días de cupo liberado también están en
`participants.json`:

```json
"dailyLimit": 8,
"freeLastDays": 3
```

La cuenta es: **banco de hoy = 8 × días de torneo transcurridos − partidas jugadas
antes de hoy − penalizaciones** (ver "Adelanto y penalización" más arriba). El primer
día hay 8; un día sin jugar deja 16 para el siguiente. Si un jugador se queda sin
banco, adelanta partidas o lo penalizan, aparece en el panel del organizador.

El historial de cada jugador es **solo del día de hoy**: se reinicia a la
medianoche y no muestra partidas de días anteriores. Al abrirlo aparece una franja
de resumen de todo el ancho y, debajo, la lista de las partidas de hoy:

- **A la izquierda**: cuántas partidas jugó hoy, cuánto tenía en el banco al
  empezar el día y cuántas le quedan. Si lo agotó dice "Banco agotado". Si adelantó
  partidas (hasta 2), la franja se pone dorada con "Adelantó N de 2". Si se pasó del
  adelanto, o está cumpliendo una penalización, se pone en rojo: el banco figura en
  0, con el cartel "Penalización de 8 partidas" y un aviso con el día en que vuelve
  a tener partidas. La barra muestra qué parte del banco usó. En los últimos días
  del torneo, en lugar del banco dice "Cupo liberado".
- **A la derecha**: ganadas, perdidas, remakes y LP sumados de esas mismas
  partidas de hoy.

Cada partida del historial muestra, además del campeón, el KDA y los LP:

- **Carril** (como OP.GG): su parte del oro, la experiencia y el CS contra el rival
  de su mismo carril al **minuto 15**. Se ve como "62 : 38": a la izquierda el
  jugador y a la derecha su rival, en verde si ganó la fase de líneas y en rojo si
  la perdió (50 : 50 queda sin color). Sale del timeline de la partida.
- **P/Kill**: participación en kills, (kills + asistencias) / kills de su equipo.
- **CS** y, entre paréntesis, CS por minuto.
- **Elo promedio**, entre paréntesis ("Elo prom. (Esmeralda I)"), de los 10 jugadores de la partida (su rango de SoloQ al momento
  de calcularlo; los que no tienen rango no cuentan).
- Debajo del KDA, el KDA en número: (kills + asistencias) / muertes.
- Debajo del KDA, las etiquetas:
  - **MVP** (amarillo): fue el mejor jugador del equipo que ganó. **ACE**: el mejor
    del equipo que perdió. Se elige con un puntaje que compara a los 10 jugadores en
    KDA (30 %), participación en kills (20 %), daño a campeones (25 %), oro (15 %) y
    visión (10 %), cada uno relativo al mejor de la partida (`mvpAce` en
    `lib/riot.js`). Es parecido a OP.GG, pero no idéntico: su fórmula no es pública.
  - Su **mejor racha de kills**: "Doble kill", "Triple kill", "Cuádruple kill" o
    "Pentakill" (dorada).
- Las partidas guardadas antes de estos cambios no traían la racha, el daño, el oro ni
  la visión: la primera vez que aparecen en el historial se vuelven a pedir a Riot
  (una sola vez).

**Al tocar una partida** se abre esa misma partida en **League of Graphs**
(`leagueofgraphs.com/match/las/<id>`), con el detalle de los 10 jugadores. No se usa
OP.GG porque sus links a cada partida llevan un código interno que no se puede armar
con los datos de Riot.

El carril y el rango promedio cuestan consultas a Riot (1 por el timeline y hasta 9 por
los rangos), así que no se calculan al abrir el historial sino en segundo plano, con el
cron: una o dos partidas por pasada, de la más nueva a la más vieja, y se guardan
dentro de `watch:<puuid>` (sin escrituras extra de KV). Aparecen unos minutos después
de que termina la partida. Además, una vez por día el cron revisa las partidas de hoy
que todavía no los tienen y las completa. Los rangos de los participantes del
torneo ya se conocen y no se vuelven a pedir; los demás se reusan por 6 horas.

Cómo se cuenta:

- El día va de 00:00 a 23:59 en la zona horaria del torneo, que se toma de la
  fecha `start` (`-03:00` es Argentina). El banco empieza a sumar el día de
  `start` y deja de sumar cuando empiezan los días de cupo liberado.
- Una partida cuenta para el día en que **empezó**.
- Las **remakes no descuentan** del banco; se listan y se informan aparte.
- Lo jugado **hoy** se le pregunta a Riot en el momento; lo jugado en **días
  anteriores** sale de lo que el sitio fue guardando solo (`lib/duo.js`), así que
  necesita el cron y el KV activos desde el inicio del torneo. Si el sitio se
  activa con el torneo ya empezado, no conoce las partidas anteriores y el banco
  va a figurar más grande de lo real.
- Los LP del día suman solo las partidas que tienen LP registrados (ver "LP por
  partida").
- Se muestran hasta 30 partidas por día.

## Panel del organizador (privado)

En `/admin` hay un panel que pide una clave. Se entra con el botón **Admin**
de la barra superior (antes ahí estaba "Actualizar"; la tabla se sigue
actualizando sola cada 5 minutos). Sirve para controlar las reglas del torneo y, al
final, para cargar los resultados de los Pickems que no se calculan solos (ver
"Pickems").
**Solo muestra a los jugadores que tienen alguna alerta**; si nadie tiene, lo dice.
Abre al instante, porque no le consulta nada a Riot: lee lo que el sitio fue
guardando solo (ver "Cómo funciona"). Para cada jugador con alertas puede haber
hasta tres partes:

- **Ahora**: las sospechas de dúo vigentes, calculadas sobre sus **últimas 12
  partidas**. Incluye las de nivel medio y alto.
- **Histórico**: las sospechas **altas** de dúo, cada una con la fecha y hora en
  que se detectó. Quedan guardadas aunque el jugador siga jugando y esas partidas
  salgan de las últimas 12.
- **Banco de partidas**: aparece solo si el jugador **se quedó sin banco**, o sea,
  si ya usó todas las partidas habilitadas hasta hoy ("Banco agotado") o jugó de
  más ("Se pasó del banco", con cuántas). Muestra cuántas lleva jugadas en el
  torneo y cuántas tenía habilitadas. Es el estado de hoy: al día siguiente se le
  suman 8 y, si con eso vuelve a tener partidas, deja de aparecer.

Arriba, tres contadores resumen todo: sospechas vigentes, sospechas altas en el
histórico y **jugadores sin banco de partidas**.

Las reglas:

- **Posible dúo** (el dúo está prohibido). Riot no informa si una partida se jugó
  en dúo, así que se detecta por estadística, igual para otros participantes que
  para desconocidos. Que te toque alguien una vez pasa; seguido, no. Salta una
  sospecha cuando alguien estuvo en el mismo equipo que el jugador:

  | Nivel | Cuándo |
  |---|---|
  | **Alta** | 3 o más partidas **seguidas**; o 5 o más juntos sin enfrentarse nunca; o 2 seguidas si el otro es un participante del torneo |
  | **Media** | 2 partidas **seguidas**; o 4 en un mismo día, aunque no sean seguidas |

  Cada sospecha muestra cuántas veces se cruzaron, cuántas en el mismo equipo y
  cuántas en contra, y **qué tan probable es que sea casualidad**. Si dos jugadores
  caen en la misma partida por azar, quedan en el mismo equipo 4 de cada 9 veces;
  un dúo, siempre. Por eso 3 veces juntos y ninguna en contra pasa por casualidad
  el 9 % de las veces, 4 veces el 4 % y 5 veces el 1,7 %. Sigue siendo una
  **alerta para revisar, no una prueba**: en elo alto hay poca gente en cola y se
  repiten compañeros. (En Maestro o más, además, Riot no permite hacer cola en dúo.)
- **Sin banco de partidas**: lo que lleva jugado en el torneo (sin remakes) alcanzó
  o superó lo habilitado hasta hoy. Se cuenta partida por partida a medida que
  las juega, así que no depende de la ventana de 12. Antes de empezar el torneo,
  en los últimos días (cupo liberado) y una vez terminado, no aparece nadie.

Las remakes no cuentan ni cortan una racha. Los umbrales se cambian en
`participants.json`:

```json
"duo": { "streak": 2, "highStreak": 3, "perDay": 4, "neverAgainst": 5 }
```

### Activarlo

1. En Cloudflare → **Configuración → Variables y secretos** → **Agregar** un
   *Secreto* llamado `ADMIN_KEY`, con una clave larga que elijas (en Producción).
2. Reimplementá, como con cualquier variable nueva.
3. Entrá a `https://TU-SITIO.pages.dev/admin` y poné esa clave.

`/api/diag` muestra `adminKey: true` cuando está configurada. Sin `ADMIN_KEY` el
panel no abre.

### Cómo funciona

La clave se guarda solo en esa pestaña del navegador y viaja en cada pedido; el
servidor la compara con el secret y no responde nada sin ella.

La revisión no la hace el panel sino el sitio, solo y de a poco (`lib/duo.js`),
para que alcance aunque haya 20 jugadores:

1. Cada vez que se recalcula la tabla (el cron lo hace cada 5 minutos) se mira,
   por jugador, si jugó algo nuevo. **Si no jugó, no se le consulta nada a Riot.**
2. Si jugó, se trae solo la partida nueva (2 consultas) y se vuelve a analizar la
   ventana de sus últimas 12 partidas. Nunca se revisa el historial completo.
3. Las sospechas altas se anotan en el histórico, y se actualiza la cuenta de
   partidas por día, de donde sale el banco.

Por cada pasada se gastan como mucho 12 consultas en esto; si muchos jugadores
terminan una partida a la vez, a los que no les toca se los revisa en la pasada
siguiente. Todo se guarda en KV, una clave por jugador (`watch:<puuid>`).

Consecuencias de este diseño:

- Un jugador **sin rango** (todavía en clasificación) no tiene victorias ni derrotas
  que comparar, así que a ese se le revisa el historial cada 10 minutos (1 consulta).
  Cuando ya tiene rango, vuelve a revisarse solo cuando cambia su total.
- El panel **necesita el cron y el KV** andando; sin ellos no hay nada guardado.
- Solo ve las partidas jugadas desde que se activó (y las últimas 12 anteriores,
  que carga de a 4 por pasada). No reconstruye lo que pasó antes.
- Una sospecha **media** que nunca llega a alta no queda en el histórico: se ve
  mientras esté dentro de las últimas 12 partidas y después desaparece.

Para probarlo en tu computadora, `ADMIN_KEY` va en `.dev.vars` (hay un ejemplo en
`.dev.vars.example`).

## Pickems

Un juego previo al torneo: cada participante predice cómo va a terminar. Hay **2400
puntos** repartidos en 22 preguntas (2000 en las 17 originales y 400 en las 5
que se sumaron después, contando el bonus). En la página van ordenadas por el tamaño de
su tarjeta (las de campeón, con la grilla de fotos, al final), no por puntos.

| Pregunta | Puntos | Se resuelve |
|---|---|---|
| Mejor winrate del torneo | 180 | Sola |
| Peor winrate del torneo | 160 | Sola |
| Ganador del torneo | 150 | Sola |
| Último del torneo | 140 | Sola |
| ¿Quién juega más partidas? | 120 | Sola |
| ¿Quién juega menos partidas? | 110 | Sola |
| Mejor KDA del torneo | 100 | Sola |
| ¿Quién muere más en todo el torneo? | 100 | Sola |
| ¿Quién juega la partida más larga? | 90 | Sola |
| ¿Quién juega la partida más corta? (sin remakes) | 90 | Sola |
| ¿Quién hace más kills en una partida? | 80 | Sola |
| ¿Quién hace más asistencias en una partida? | 50 | Sola |
| ¿Alguien se hace un pentakill? (sí/no) | 50 | Sola |
| ¿Cuántos jugadores terminan en Master o más? (1, 2, 3, 4, 5+; si no termina ninguno, nadie suma) | 40 | Sola |
| ¿Quién será el primer baneado? (incluye "Nadie") | 100 | Admin |
| ¿Liand (tdg ASOLutosex) termina en Diamante o más? | 50 | Sola |
| ¿Aheru (TDG WeepingAngel) juega más de 60 partidas? | 50 | Sola |
| ¿Alguien abandona el SoloQ? (sí/no) | 50 (+50 si acierta quién) | Admin |
| ¿Quién supera las expectativas? | 100 | Admin |
| Top 3 del torneo, en orden | 210 | Sola |
| Campeón con más winrate | 200 | Sola |
| Campeón jugado por más jugadores distintos | 130 | Sola |

- Top 3, ganador y último son de la **tabla general** (los 19 juntos, sin importar
  High o Low Elo). Los que terminan sin rango no entran.
- En el Top 3 se suman 20 puntos por cada jugador que termina en el Top 3 y 50 más
  si además está en el puesto exacto.
- Winrate y KDA cuentan solo entre los que juegan al menos 20 partidas del torneo
  (si nadie llega, entre todos los que jugaron). El campeón con más winrate, entre
  los que se jueguen al menos 10 partidas sumando a todos. Los dos mínimos se
  cambian en `participants.json` con `"pickems": { "minGames": 20, "minChampGames": 10 }`.
- Si hay empate, vale cualquiera de los empatados. Una pregunta que no se puede
  resolver (por ejemplo, si nadie juega) no le da puntos a nadie.
- A igual puntaje, queda arriba el que votó primero.

Las preguntas y los puntos están en `lib/pickems.js` (`QUESTIONS`). Las de Liand y
Aheru apuntan a sus Riot ID (`target`), así que si cambian de cuenta hay que
actualizarlo ahí.

### Resultados que carga el organizador

"Primer baneado", "¿Alguien abandona el SoloQ?" y "¿Quién supera las expectativas?"
no se pueden calcular solos. Se cargan en el **panel Admin**, en la sección
**Pickems** (se guardan en KV, `pickems:manual`), y se pueden corregir las veces que
haga falta: los puntos se recalculan solos. Mientras no estén cargados, esas
preguntas figuran "A definir por el organizador" y no suman.

- Primer baneado: un participante o "Nadie".
- Abandono: Sí o No y, si es Sí, quiénes abandonaron. Acertar Sí/No da 50 puntos y
  acertar además uno de los nombres, 50 más.
- Superó las expectativas: el ganador de la votación que se hace al terminar.

### Cómo se vota

- Solo votan los participantes de `participants.json`. Eligen su Riot ID de la
  lista y ponen un PIN de 4 números, que queda como su clave para volver a entrar y
  ver lo que votaron.
- **Todas las preguntas son obligatorias**: si falta alguna (o un puesto del Top 3),
  se marca en rojo y el voto no se envía. El sitio también rechaza un voto incompleto.
- **Cada uno vota una sola vez**: una vez enviado, el voto no se puede cambiar (el
  sitio lo rechaza). Antes de enviar se pide confirmación.
- 5 PIN incorrectos seguidos bloquean esa cuenta 15 minutos.
- En las preguntas de campeón se elige de una grilla con la foto de cada campeón
  del LoL (de Data Dragon, siempre la versión más nueva), con buscador. Tocar el
  elegido de nuevo lo deselecciona.
- Se puede votar hasta el cierre: `"pickems": { "closes": "2026-10-17T18:00:00-03:00" }`
  en `participants.json` (sábado 17/10 a las 18:00; si no está, cierra cuando empieza
  el torneo). Mientras tanto solo se ve quién votó; los picks son secretos.
- Desde el cierre quedan bloqueados y se ven los picks de todos.
- Al terminar (`end`), la página muestra la tabla de puntos y las respuestas.

Si alguien se olvida el PIN (o un participante se anotó con la cuenta de otro),
se borra su voto en Cloudflare → Workers & Pages → KV → `tincho-lp`: la clave es
`pick:` seguido del Riot ID en minúsculas (por ejemplo `pick:tdg kairo#tdg`).
Después puede volver a votar con un PIN nuevo, si la votación no cerró. Es la única
forma de rehacer un voto.

### De dónde salen los resultados

Nada se va sumando durante el torneo: todo se calcula **recién cuando termina**, así
no quedan puntos fantasmas por una pasada del cron que falló o una partida que se
procesó a medias.

1. **Tabla final**: la primera vez que la tabla sale completa después del final, se
   guarda en KV (`pickems:final`) y ya no cambia aunque alguien siga jugando. De ahí
   salen el Top 3, el ganador, el último y la cantidad de Master.
2. **Recuento de partidas**: 1 hora después del final (para que Riot publique las
   últimas partidas), el cron empieza a traer el historial completo de SoloQ de cada
   jugador entre `start` y `end`, y cuenta todo desde cero: partidas, victorias,
   KDA, muertes, kills y asistencias por partida, pentas, duración y campeones. Las
   remakes no cuentan. Se hace de a tandas (120 partidas por pasada, respetando el
   tope de consultas a Riot) y el avance queda en KV (`pickems:calc`); con 19
   jugadores tarda unas horas.
3. Mientras el recuento no termine con todos, la página dice "calculando resultados"
   y muestra los picks sin puntos. Cuando termina, aparecen los puntos y las
   respuestas, con un **podio de Pickems** arriba: los tres que más puntos sacaron,
   con corona y medallas como el podio del torneo. Ese mismo podio aparece también
   al final de la página Podio. Con el torneo terminando a las 00:00, los puntos
   suelen estar entre las 03:00 y las 04:00.

Las partidas que el sitio ya tiene guardadas (las de los últimos 30 días) no se le
vuelven a pedir a Riot. Durante el recuento se deja de revisar dúos y banco, que a
esa altura ya no hacen falta. El margen de 1 hora se cambia en `participants.json`
con `"pickems": { "waitMinutes": 60 }`.

Para votar, los Pickems no le consultan nada a Riot: solo leen y escriben KV (una
escritura por cada vez que alguien guarda sus picks).

## Remakes

Las partidas que terminan en remake (menos de 5 minutos o rendición temprana)
aparecen en el historial marcadas como **Remake**, en gris, y no cuentan como
victoria ni derrota en el resumen ni en los LP.

## LP por partida (+25 / −18)

La API de Riot **no informa cuántos LP dio cada partida**. Se calculan como lo hace
OP.GG: cada vez que se consulta la tabla se guarda una "foto" del rango de cada
jugador en **Cloudflare KV** (gratis) y, cuando aparece una partida nueva, la
diferencia entre las dos fotos son los LP de esa partida (`lib/lp.js`).

- Solo se registran partidas jugadas **después** de activar esto.
- Si alguien juega 2 partidas seguidas sin que nadie consulte la tabla, no se puede
  saber cuánto dio cada una y esas quedan sin LP (se muestra V o D). Por eso conviene
  un cron que consulte la tabla cada 5 minutos (ver abajo).
- Sin KV configurado la página funciona igual, solo que sin LP por partida.

### Activar KV
En este proyecto **ya está activado** (namespace `tincho-lp`, binding `LP` en
`wrangler.toml`). Para comprobarlo, `/api/diag` muestra `lpBinding: true` y cuántos
jugadores tienen foto guardada (`lpSnapshots`). Los pasos, por si hay que rehacerlo:

1. En Cloudflare → **Storage & Databases → KV → Create** → nombre `tincho-lp`.
   Copiá el **ID** del namespace.
2. Agregá esto al final de `wrangler.toml` (con tu ID) y hacé push:
   ```toml
   [[kv_namespaces]]
   binding = "LP"
   id = "EL-ID-DEL-NAMESPACE"
   ```

### Cron cada 5 minutos (gratis)
En Cloudflare → **Workers & Pages → Create → Worker** → "Hello World" → Deploy.
Editá el código, pegá esto (con tu URL) y deploy:
```js
export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(fetch("https://TU-SITIO.pages.dev/api/leaderboard"));
  },
};
```
Después en el Worker → **Settings → Trigger events → Add → Cron trigger** → `*/5 * * * *`.

## Límites del plan gratis

Hay tres topes que condicionan cómo está hecho el sitio:

| Tope | Cuánto | Cómo se respeta |
|---|---|---|
| Cloudflare: consultas por pedido | 50, contando cada `fetch` a Riot **y cada lectura o escritura de la Cache API** | Cada pedido tiene un tope propio de 42 consultas a Riot; la Cache API se usa unas pocas veces por pedido y lo demás va a KV, que tiene un tope aparte de 1.000 |
| Riot (key personal) | 20 consultas por segundo y 100 cada 2 minutos | Todas las consultas pasan por un regulador de 15 por segundo; la tabla se recalcula como mucho cada 2 minutos |
| Cloudflare KV | 100.000 lecturas y 1.000 escrituras por día | Solo se guarda lo que dura: cuentas, íconos, partidas terminadas, los LP, la revisión del panel y los Pickems |

Qué se guarda y cuánto dura:

- **Respuesta de la tabla y del historial**: 2 minutos (Cache API).
- **Cuenta → PUUID**: 7 días (KV).
- **Ícono de la cuenta**: 24 horas (KV).
- **Partidas terminadas**: 30 días (KV), achicadas a los campos que usa el sitio.
- **Rango y LP actuales**: no se guardan por separado; se piden a Riot en cada
  recálculo de la tabla (1 consulta por jugador).
- **Pickems**: cada voto (una escritura por persona), los resultados que carga el
  organizador, la tabla final y el avance del recuento (unas 30 escrituras en total,
  después del final). Votar no le consulta nada a Riot.
- **Jugadores sin rango**: como no hay total de victorias y derrotas que comparar,
  se revisa su historial cada 10 minutos (1 consulta a Riot cada vez).

Los vencimientos llevan un margen al azar (hasta 25 % más), para que no venza todo
junto en la misma pasada.

### Con 20 jugadores

Recalcular la tabla cuesta 1 consulta a Riot por jugador: 20 de las 42 posibles.
Lo que sobra se usa, por prioridad, en:

1. Cuentas y rangos (imprescindible).
2. Íconos que haya que renovar.
3. En segundo plano y de a un jugador: los LP de la partida nueva y la revisión
   del panel.

Si las consultas no alcanzan (por ejemplo, muchos jugadores terminan una partida
a la vez, o es el primer arranque), **nada se rompe**: lo que no entró queda para
la pasada siguiente y se completa solo. Lo único que se demora es el dato de fondo
(un ícono nuevo, los LP de esa partida, la revisión del panel); el rango siempre
sale en la misma pasada.

### Si Riot falla o frena las consultas

- Si Riot responde "esperá" (429), se espera y se reintenta una vez.
- Si igual no se puede consultar a un jugador, **la tabla lo muestra con su último
  dato bueno** en lugar de un error, y esa respuesta no se guarda en caché, así la
  próxima visita vuelve a intentarlo.

### Cuotas diarias

Cada partida que juega un participante cuesta 3 escrituras de KV (la partida, la
foto de LP y la revisión del panel). Con 20 jugadores a 8 partidas por día serían
480 de las 1.000 diarias. Si un día se agotan, el
sitio sigue funcionando, solo que sin guardar nada nuevo hasta el día siguiente.

El techo práctico del plan gratis ronda los **25 participantes**. Para más, hay
que pasar al plan pago de Cloudflare (sube el tope de 50 a 10.000 consultas por
pedido) y pedirle a Riot una key con más cupo.

## Créditos

SoloQ Challenge no está respaldado por Riot Games. League of Legends y Riot Games
son marcas registradas de Riot Games, Inc.
