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

El esquema canónico validado está en `db/schema_mysql.sql` (36 tablas base + vistas
+ datos semilla).

```sql
CREATE DATABASE IF NOT EXISTS tienda_hilos
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE tienda_hilos;
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

```sql
USE desarrollo;
SOURCE db/migrations/2026-07_variante_codigos.sql;
```

(La tabla usa `CREATE TABLE IF NOT EXISTS`, así que es seguro re-ejecutarla.)

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

## Referencia de archivos

```
backend/
  scripts/
    dump-db.js      ← genera el respaldo (.sql)
    README.md       ← este archivo
  .env              ← credenciales de conexión (no se versiona)
db/
  schema_mysql.sql  ← esquema base validado (MySQL/MariaDB)
  erd.mermaid       ← diagrama entidad-relación
  migrations/       ← cambios de esquema posteriores
  dump_*.sql        ← respaldos generados
```
