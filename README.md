# CamiJuncal · Traslados de pacientes (Sanatorio Juncal)

App Android para camilleros + servidor para el conmutador.

## Flujo
1. **Conmutador** (web o app) emite una orden: paciente, destino, prioridad, requerimientos, nota.
2. **Todos los camilleros en turno** reciben el aviso (pantalla completa + sonido + vibración + notificación).
3. El primero que toca **“ME HAGO CARGO”** se queda el traslado; al resto se le retira. El conmutador ve quién lo tomó.
4. El camillero **escanea la pulsera** del paciente (código de barras o QR). Si no es el paciente de la orden, bloquea y avisa.
5. Lo lleva al destino y **escanea el QR del lugar** (si es otro lugar, avisa). Agrega una **nota/aviso** y finaliza.
6. Todo queda registrado con horarios (aceptación, retiro, entrega) y nota.

## Estructura
| Carpeta | Qué es |
|---|---|
| `www/` | La app (HTML/CSS/JS puro). Es la misma para el APK y para el navegador del conmutador. |
| `server/` | API + tiempo real (WebSocket) + base SQLite. Node 22+. |
| `resources/` | Logo e íconos de Android. |
| `.github/workflows/build-apk.yml` | Compila el APK en GitHub (sin Android Studio). |
| `scripts/prepare-android.py` | Ajusta permisos, servicio en segundo plano y escáner en el proyecto Android. |

## 1) Compilar el APK
1. Subí todo el contenido de esta carpeta a un repositorio de GitHub (rama `main`). Incluí la carpeta oculta `.github`.
2. En GitHub: pestaña **Actions → “Compilar APK” → Run workflow** (también corre solo en cada push).
3. Al terminar (~5-8 min) bajá el APK desde **Releases** (ideal desde el celular) o desde *Artifacts* de la ejecución.
4. En el celular: abrir el APK y permitir “instalar apps desconocidas”.

## 2) Levantar el servidor
```bash
cd server
npm install
node server.js          # http://IP-DEL-SERVIDOR:3000
```
Requiere **Node 22.5 o superior**. También hay `Dockerfile` en la raíz. Los datos quedan en `server/data/camilleros.db` (hacé backup de ese archivo).

Variables de entorno opcionales:
| Variable | Uso |
|---|---|
| `PORT` | Puerto (3000 por defecto) |
| `DB_FILE` | Ruta de la base |
| `SEED_DEMO=0` | No cargar datos de ejemplo (solo crea el usuario `admin`) |
| `INGRESOS_URL` | URL JSON del sector Ingresos; el servidor la consulta cada `INGRESOS_SYNC_MIN` minutos (5 por defecto) |
| `INGRESOS_TOKEN` | Token Bearer para esa URL |
| `INGRESOS_API_KEY` | Clave para que Ingresos *envíe* pacientes a `POST /api/pacientes/import` con el header `X-Api-Key` |

**Usuarios de ejemplo** (cambiar los PIN al empezar): `admin/1234`, `conmutador/1234`, `carlos`, `lucia`, `marcos` / `1111`.

El conmutador entra desde cualquier navegador a `http://IP-DEL-SERVIDOR:3000`.

## 3) Primer uso en el celular
Al abrir la app pide la **dirección del servidor** (ej. `http://192.168.1.50:3000`), después usuario y PIN. El camillero activa **“En turno”** para recibir avisos.

## 4) QR de los destinos
Admin → **Destinos y QR → Imprimir todos los QR**. Pegar cada QR en la puerta/mostrador del lugar. El contenido del QR es el código del destino (ej. `LUG-RX01`).

## 5) Pacientes (base mínima desde Ingresos)
Campos: `dni, nombre, historia, cama, sector, pulsera, oxigeno, aislamiento, movilidad (camilla/silla)`.
Tres formas de cargarlos: sincronización por `INGRESOS_URL`, envío desde Ingresos (`POST /api/pacientes/import`), o CSV desde Admin → Pacientes.
La pulsera se reconoce si el código leído coincide con `pulsera`, `dni` o `historia` (también si el QR contiene alguno de esos valores dentro de un texto).

## Notas importantes
- **Avisos con el celular bloqueado:** la app mantiene un servicio en segundo plano mientras el camillero está “En turno”. En el celular conviene: *Ajustes → Apps → CamiJuncal → Batería → Sin restricciones*, y permitir notificaciones. Si en algún modelo se cortan, la mejora es sumar notificaciones push (Firebase).
- Seguridad: usar HTTPS (proxy inverso) si el servidor sale a internet. En red interna `http` funciona.
- El APK es de tipo *debug* (instalable directo). Para publicar en Play Store hay que firmarlo con keystore propia.
