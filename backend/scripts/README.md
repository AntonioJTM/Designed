# Scripts y comandos de base de datos

Comandos útiles para la BD del proyecto (**tienda de hilos**). Todos usan la
configuración de conexión del archivo `backend/.env`
(`DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`).

> Ejecuta los comandos `node scripts/...` **desde la carpeta `backend/`**.

---

## 1. Respaldo (dump) de la base de datos

Genera un `.sql` con estructura + datos + vistas, tal cual está la BD.

```bash
cd backend

# Guarda en ../db/dump_<base>_<fecha>.sql  (p.ej. db/dump_desarrollo_2026-07-24.sql)
node scripts/dump-db.js

# O a una ruta específica
node scripts/dump-db.js ../db/mi_respaldo.sql
```

El dump:
- incluye `DROP TABLE IF EXISTS` + `CREATE TABLE` (con `AUTO_INCREMENT`, índices y FKs),
- inserta los datos con valores escapados,
- recrea las vistas sin `DEFINER` (portable entre servidores),
- pone `SET FOREIGN_KEY_CHECKS = 0` al inicio (el orden de tablas no importa al restaurar).

---

## 2. Restaurar un dump

En una base **destino** (Workbench → *File → Open SQL Script* y ejecutar, o por consola):

```sql
CREATE DATABASE IF NOT EXISTS copia
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE copia;
SOURCE db/dump_desarrollo_2026-07-24.sql;
```

Con cliente `mysql` de línea de comandos (si lo tienes instalado):

```bash
mysql -h 192.168.100.122 -P 3306 -u root -p copia < db/dump_desarrollo_2026-07-24.sql
```

---

## 3. Crear la base desde cero (esquema completo)

El esquema canónico validado está en `db/schema_mysql.sql` (44 tablas base + vistas
+ datos semilla).

```sql
CREATE DATABASE IF NOT EXISTS desarrollo
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE desarrollo;
SOURCE db/schema_mysql.sql;
```

> Nota: `schema_mysql.sql` es el esquema base. Aplica además las migraciones del
> punto 4 que sean posteriores a él.

---

## 4. Migraciones

Cambios de esquema aplicados después del `schema_mysql.sql` base. Viven en
`db/migrations/`. Aplícalas en orden sobre la BD activa:

| Archivo | Qué agrega |
|---|---|
| `db/migrations/2026-07_variante_codigos.sql` | Tabla `variante_codigos` (varios códigos de barras por variante, agrupados por color). |
| `db/migrations/2026-07_nomina.sql` | Nómina semanal: `nomina_empleados`, `nomina_periodos`, `nomina_recibos`, `nomina_recibo_conceptos` y la vista `v_ventas_por_empleado`. **Ya aplicada en `desarrollo`.** |
| `db/migrations/2026-07_almacen_tienda_linea.sql` | Columna `almacenes.es_tienda_linea`: marca explícitamente el almacén del que descuenta la tienda en línea. **Ya aplicada en `desarrollo`** (quedó en `Bodega`, igual que el comportamiento anterior). |
| `db/migrations/2026-07_unidades_peso.sql` | El producto se vende por peso: `unidades_medida` pasa a gramo/kilogramo/tonelada y se quitan las unidades de conteo que no estén en uso. **Ya aplicada en `desarrollo`.** |
| `db/migrations/2026-07_remesas_bultos.sql` | `variante_codigos` gana `peso_kg`, `lote`, `conos` y `remesa_id` (cada código es un bulto físico con su peso real); tabla `remesas` como documento de entrada. **Ya aplicada en `desarrollo`.** |
| `db/migrations/2026-07_lotes_multipresentacion_precios.sql` | Banderas `productos.multipresentacion` y `por_lotes`; `producto_variantes.lote`; tablas `tipos_cliente` y `variante_precios`; `pedidos.tipo_cliente_id`. **Ya aplicada en `desarrollo`.** |
| `db/migrations/2026-07_quitar_peso_producto.sql` | Retira `productos.peso_kg` y `productos.longitud_metros`. El peso que el sistema usa es el de la VARIANTE (`producto_variantes.peso_kg`), que no se toca. **Ya aplicada en `desarrollo`.** |
| `db/migrations/2026-07_linea_material_calibres.sql` | `marcas` → `lineas` (turco/nacional/chino) y `productos.marca_id` → `linea_id`; retira `productos.material_id` y la tabla `materiales`; agrega `categorias.calibres` con los calibres válidos de cada material. **Ya aplicada en `desarrollo`.** |
| `db/migrations/2026-07_quitar_categoria_padre.sql` | Elimina `categorias.padre_id` y su llave foránea: la jerarquía no se usaba, el catálogo filtra por categoría exacta sin recursión. **Ya aplicada en `desarrollo`.** |
| `db/migrations/2026-07_quitar_slug.sql` | Elimina `productos.slug` y `categorias.slug`: nada los consumía (la tienda navega por id) y su UNIQUE impedía dos productos con el mismo nombre. **Ya aplicada en `desarrollo`.** |
| `db/migrations/2026-07_producto_peso_kg.sql` | `productos.peso_gramos` (DECIMAL(8,2), gramos) pasa a `peso_kg` DECIMAL(12,3): topaba en 1 tonelada y reventaba con "Out of range value". Convierte los valores existentes dividiendo entre 1000. **Ya aplicada en `desarrollo`.** |
| `db/migrations/2026-07_almacen_matriz.sql` | Columna `almacenes.es_matriz`: marca el almacén que surte a las sucursales. **Ya aplicada en `desarrollo`** (quedó en `Tienda principal`). |
| `db/migrations/2026-07_traspasos.sql` | Tablas `traspasos` y `traspaso_detalle` para surtir sucursales desde la matriz. **Ya aplicada en `desarrollo`.** |
| `db/migrations/2026-07_paquetes_y_conos.sql` | Presentaciones en `producto_variantes` (`tipo_presentacion`, `peso_kg`, `origen_variante_id`, `piezas_por_origen`, `modo_precio`) y tabla `variante_conversiones` para desarmar paquetes en conos. **Ya aplicada en `desarrollo`.** |

```sql
USE desarrollo;
SOURCE db/migrations/2026-07_variante_codigos.sql;
SOURCE db/migrations/2026-07_nomina.sql;
SOURCE db/migrations/2026-07_almacen_tienda_linea.sql;
SOURCE db/migrations/2026-07_unidades_peso.sql;
SOURCE db/migrations/2026-07_paquetes_y_conos.sql;
SOURCE db/migrations/2026-07_traspasos.sql;
SOURCE db/migrations/2026-07_almacen_matriz.sql;
SOURCE db/migrations/2026-07_producto_peso_kg.sql;
SOURCE db/migrations/2026-07_quitar_slug.sql;
SOURCE db/migrations/2026-07_quitar_categoria_padre.sql;
SOURCE db/migrations/2026-07_linea_material_calibres.sql;
SOURCE db/migrations/2026-07_quitar_peso_producto.sql;
SOURCE db/migrations/2026-07_lotes_multipresentacion_precios.sql;
SOURCE db/migrations/2026-07_remesas_bultos.sql;
```

(Las tablas usan `CREATE TABLE IF NOT EXISTS`, así que es seguro re-ejecutarlas.)

---

## 5. Sembrar el primer administrador

El registro de personal (staff) **ya no es público**: se da de alta desde el panel
(*Personal*), pero eso requiere un administrador ya existente. Para crear el primero
en una BD limpia, genera el hash bcrypt e insértalo:

```bash
cd backend
node -e "const bcrypt=require('bcrypt');const {pool}=require('./src/config/db');(async()=>{\
const h=await bcrypt.hash('CAMBIA_ESTA_CONTRASENA',12);\
await pool.query('INSERT INTO usuarios (rol_id,nombre,correo,contrasena_hash) VALUES (1,?,?,?)',\
['Administrador','admin@tienda.mx',h]);\
await pool.end();console.log('Admin creado: admin@tienda.mx');})()"
```

`rol_id = 1` corresponde a **administrador** (ver semilla de la tabla `roles`).
Luego inicia sesión con ese correo y crea al resto del personal desde el panel.

---

## 6. Verificar la conexión

```bash
cd backend
node -e "const {verificarConexion,pool}=require('./src/config/db');(async()=>{\
await verificarConexion();const [v]=await pool.query('SELECT VERSION() v, DATABASE() db');\
console.log('OK',v[0]);await pool.end();})().catch(e=>{console.error('FALLO',e.message);process.exit(1)})"
```

---

## 7. Prueba de punta a punta de la recepción de remesas

Comprueba la carga masiva de bultos desde la lista de empaque del proveedor,
contra el servidor y la base reales. Usa el `.xlsx` que está en la raíz del
repositorio.

```bash
cd backend

# 1. El servidor, en otra terminal (o en segundo plano)
PORT=3210 node src/server.js &

# 2. La prueba
node scripts/e2e-remesas.js

# Si el servidor escucha en otro puerto
BASE=http://localhost:4000/api/v1 node scripts/e2e-remesas.js
```

Son 26 comprobaciones. El guion crea un producto, una presentación paquete y un
almacén temporales (con prefijo `TMP`), carga los 80 bultos y **borra al
terminar todo lo que creó**, así que se puede correr las veces que sea. Sale con
código `1` si alguna comprobación falla.

> Al probar la guarda del almacén hay que usar una presentación **de tipo
> paquete válida**. Con una `simple` el endpoint también responde 422, pero por
> la otra razón (`NO_ES_PAQUETE`), y la prueba pasaría engañada.

---

## Referencia de archivos

```
backend/
  scripts/
    dump-db.js      ← genera el respaldo (.sql)
    e2e-remesas.js  ← prueba E2E de la recepción de remesas
    README.md       ← este archivo
  .env              ← credenciales de conexión (no se versiona)
db/
  schema_mysql.sql  ← esquema base validado (MySQL/MariaDB)
  erd.mermaid       ← diagrama entidad-relación
  migrations/       ← cambios de esquema posteriores
  dump_*.sql        ← respaldos generados
```
