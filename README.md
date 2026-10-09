# Tincho Challenge — leaderboard

Página con el rango, winrate e historial de SoloQ de cada participante del torneo.
Todo corre gratis en **Cloudflare Pages** (sitio + funciones de servidor).

## Qué APIs usa

| Para qué | API | ¿Necesita key? |
|---|---|---|
| Riot ID → PUUID | Riot `account-v1` (`americas`) | Sí |
| Rango, LP, victorias y derrotas | Riot `league-v4` `entries/by-puuid` (`la2`) | Sí |
| Historial de partidas del torneo | Riot `match-v5` (`americas`, cola 420 = SoloQ) | Sí |
| Íconos de campeones | Data Dragon (CDN de Riot) | No |
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

No se suben al repo (están en el `.gitignore`): `node_modules/`, `.wrangler/`,
`.dev.vars` y `.claude/` (configuración local de Claude Code).

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
  pedido. El leaderboard hace como mucho 2 llamadas a Riot por jugador, así que
  funciona bien hasta ~20 participantes.
- La tabla se actualiza sola cada 5 minutos y Riot se consulta como mucho cada 2.

## Créditos

SoloQ Challenge no está respaldado por Riot Games. League of Legends y Riot Games
son marcas registradas de Riot Games, Inc.
