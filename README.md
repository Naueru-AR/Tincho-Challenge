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
  podio.html, podio.js  podio final por bracket
  premios.html, premios.js  premios del torneo
  shared.js           lo que comparten las dos páginas
functions/api/        ← endpoints que corren en Cloudflare (esconden la API key)
  leaderboard.js      GET /api/leaderboard
  player/[puuid].js   GET /api/player/:puuid
  diag.js             GET /api/diag (revisa la API key sin mostrarla)
lib/riot.js           cliente de Riot con caché
lib/lp.js             LP por partida (fotos del rango en Cloudflare KV)
lib/demo.js           datos de ejemplo
```

La API key **nunca llega al navegador**: el navegador le pide a `/api/...` y la
función de Cloudflare es la que habla con Riot. Además se cachean las respuestas
(cuentas 7 días, rangos 2 min, partidas 30 días) para no pasarse del rate limit.

## Configurar el torneo

Editá `public/participants.json`:

```json
{
  "title": "Tincho Challenge",
  "edition": "Edición I",
  "start": "2026-10-01T00:00:00-03:00",
  "end":   "2026-11-01T00:00:00-03:00",
  "platform": "la2",        // LAS. LAN = la1, BR = br1, NA = na1, EUW = euw1
  "region": "americas",     // europe para EUW, asia para KR
  "opggRegion": "las",
  "players": [
    { "alias": "Kairo", "riotId": "Kairo#SYS" },
    { "alias": "Tomi", "riotId": "NombreEnJuego#TAG" },
    { "alias": "Nacho", "riotId": "Otro#LAS", "baseline": { "wins": 12, "losses": 9 } }
  ]
}
```

- `alias` es el nombre que se muestra; `riotId` es el `Nombre#TAG` real.
- Por ahora hay 6 cuentas cargadas de prueba (`Kairo#SYS` y cinco amigos, todas de
  LAS). Para sumar jugadores, agregá una línea por cada uno en `players`. No uses Riot IDs inventados de relleno:
  pueden coincidir con cuentas reales de otra gente.
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
archivo `.dev.vars` en la raíz del proyecto con esta única línea:

```
RIOT_API_KEY=RGAPI-tu-key
```

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
general, sin separar por bracket. Cada tarjeta muestra el ícono de la cuenta, con
una corona en la esquina para el primero, una medalla de plata para el segundo y
una de bronce para el tercero. Si hay menos de tres jugadores con
rango, los lugares que faltan dicen "Vacante".

**Podio final** (`podio.html`): una página aparte con dos podios, High Elo y Low
Elo. Se habilita sola cuando termina el torneo (fecha `end`): recién ahí aparece
el botón "Ver el podio final" en el encabezado. Antes de esa fecha la página solo
avisa cuándo se habilita. Para verla antes y probarla, abrí `/podio?preview`.

### Ícono de la cuenta

En el Top 3, en el podio final y en la tabla de posiciones cada jugador aparece
con el **ícono de invocador** que tiene puesto en su cuenta de LoL (Riot
`summoner-v4`, en caché 6 horas; la imagen sale de Data Dragon). Al pasar el
mouse se resalta y al hacer clic abre su perfil en OP.GG en otra pestaña. Si el
ícono no se puede cargar, se muestra la inicial del jugador.

El corte entre brackets se define en `participants.json`:

```json
"highEloFrom": { "tier": "DIAMOND", "rank": "III" }
```

- **High Elo**: desde ese rango inclusive (Diamante III o más).
- **Low Elo**: todo lo que esté por debajo (Diamante IV o menos).
- El bracket se calcula con el **rango actual**. Para dejar fijo a un jugador,
  agregale `"bracket": "high"` o `"bracket": "low"`.
- Los jugadores sin rango no entran en ningún podio.

El orden de la página principal es: encabezado, Top 3, tabla de posiciones y, al
final, la escalera.

## Tabla de posiciones

Cada fila muestra el puesto, el ícono de la cuenta con el nombre, el rango y el
winrate:

- **Rango**: lleva el emblema oficial del rango (Hierro, Bronce… Retador) al lado
  del nombre y los LP. Las imágenes salen de Community Dragon; si alguna no carga,
  queda solo el texto.
- **Winrate · V / D**: el porcentaje (verde si es 50 % o más, rojo si es menos),
  las victorias y derrotas ("101V · 97D") y, debajo, una barra partida en dos: el
  tramo verde es proporcional a las victorias y el rojo a las derrotas.

## Menú y premios

La barra superior tiene el escudo (lleva al inicio) y tres opciones:

- **Ranking**: baja directo a la tabla de posiciones.
- **Podio**: abre `podio.html` (el podio final por bracket).
- **Premios**: abre `premios.html`.

Los premios se cargan a mano en `participants.json`. Mientras la lista esté vacía,
la página dice que todavía no están anunciados:

```json
"prizes": [
  { "title": "1.º High Elo", "prize": "$50.000", "note": "Opcional: una aclaración" },
  { "title": "1.º Low Elo", "prize": "$30.000" }
]
```

## Diseño

Todo el estilo está en `public/styles.css`; los colores son variables en `:root`.

- **Escudo de la barra superior**: el escudo con la T lleva el nombre del torneo
  adentro, en dos cintas cortas que apenas sobresalen (las primeras palabras en la
  dorada, la última en la de abajo). Sale del `title` de `participants.json` y se comprime solo si es largo.
  Lleva al inicio y, al pasar el mouse, se inclina, brilla y le cruza un destello.
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

## Límite de partidas por día

El torneo tiene un tope de partidas por día, que se define en `participants.json`:

```json
"dailyLimit": 12
```

El historial de cada jugador es **solo del día de hoy**: se reinicia a la
medianoche y no muestra partidas de días anteriores. Al abrirlo aparece una franja
de resumen de todo el ancho y, debajo, la lista de las partidas de hoy:

- **A la izquierda**: cuántas partidas jugó sobre el límite ("7 de 12") y si le
  quedan, si llegó al límite o si lo superó. Si lo superó, el número y la barra de
  12 tramos se ponen en rojo, con el cartel "Límite superado por N".
- **A la derecha**: ganadas, perdidas, remakes y LP sumados de esas mismas
  partidas de hoy.

Cómo se cuenta:

- El día va de 00:00 a 23:59 en la zona horaria del torneo, que se toma de la
  fecha `start` (`-03:00` es Argentina).
- Una partida cuenta para el día en que **empezó**.
- Las **remakes no cuentan** como partidas jugadas ni para el límite; se listan y
  se informan aparte.
- Los LP del día suman solo las partidas que tienen LP registrados (ver "LP por
  partida").
- Se muestran hasta 30 partidas por día.

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

- Cloudflare Functions gratis: 100.000 pedidos por día y 50 llamadas externas por
  pedido. El leaderboard hace como mucho 3 llamadas a Riot por jugador (cuenta,
  rango e ícono; casi siempre 1, porque el resto queda en caché), así que
  funciona bien hasta ~20 participantes.
- La tabla se actualiza sola cada 5 minutos y Riot se consulta como mucho cada 2.

## Créditos

SoloQ Challenge no está respaldado por Riot Games. League of Legends y Riot Games
son marcas registradas de Riot Games, Inc.
