# Tienda de Hilos — Sistema de gestión

Web · Tienda en línea · Administrador · Inventario · Punto de venta.

Este repositorio ya incluye la **base de datos completa y validada**. El backend (Node/Express) y
el frontend (Angular) se construyen encima siguiendo el plan de `CLAUDE.md`.

---

## 1. Requisitos
- **Node.js 18+** (necesario para Claude Code y para el backend).
- **MySQL 8** o **MariaDB 10.5+** (o PostgreSQL 14+ si prefieres esa versión).
- **VS Code**.

## 2. Crear la base de datos

MySQL / MariaDB:
```bash
mysql -u root -p -e "CREATE DATABASE tienda_hilos CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -u root -p tienda_hilos < db/schema_mysql.sql
```

PostgreSQL (alternativa):
```bash
createdb tienda_hilos
psql -d tienda_hilos -f db/schema_postgres.sql
```

Al terminar tendrás 36 tablas, 3 vistas de reportes y datos semilla (roles, unidades, IVA, etc.).

## 3. Ver el diagrama entidad-relación
Abre `db/erd.mermaid` en VS Code con la extensión **Markdown Preview Mermaid** o
**Mermaid Editor**. Muestra las 36 tablas con sus llaves primarias (PK) y foráneas (FK).

---

## 4. Continuar con Claude Code en VS Code

Claude Code es el asistente de código de Anthropic que trabaja dentro de tu terminal y de VS Code.

**Instalación** (una sola vez):
```bash
npm install -g @anthropic-ai/claude-code
```

**Uso:**
1. Abre esta carpeta en VS Code: `File → Open Folder → tienda-hilos`.
2. Instala la extensión **Claude Code** desde el marketplace de VS Code (busca "Claude Code").
3. Abre la terminal integrada (`Ctrl+ñ` / `Ctrl+\``) y ejecuta:
   ```bash
   claude
   ```
4. Inicia sesión la primera vez siguiendo las indicaciones.

Claude Code leerá automáticamente `CLAUDE.md`, así que ya conoce el modelo de datos, el stack y las
reglas del proyecto. Para la versión y comandos más recientes:
https://docs.claude.com/en/docs/claude-code/overview

---

## 5. Prompts listos para pegarle a Claude Code (en orden)

Copia y pega uno a la vez. Revisa lo que genera antes de pasar al siguiente.

**Paso 1 — Backend base + autenticación**
```
Lee CLAUDE.md. Crea el backend en /backend con Node + Express y mysql2/promise.
Incluye: config de conexión por pool leyendo variables de .env, middleware de errores,
middleware de auth con JWT, y los endpoints de registro/login para usuarios (staff) y
clientes con contraseñas hasheadas con bcrypt. Agrega un .env.example. No inventes tablas:
usa exactamente el esquema de db/schema_mysql.sql.
```

**Paso 2 — Catálogo**
```
Implementa el CRUD REST de catálogo bajo /api/v1: categorias, marcas, productos,
producto_variantes e imagenes. Respeta la regla producto ≠ variante de CLAUDE.md.
Incluye validación de entrada y paginación en los listados.
```

**Paso 3 — Inventario**
```
Implementa el módulo de inventario: consultar existencias por variante y almacén,
registrar entradas/salidas/ajustes actualizando inventario y escribiendo en
movimientos_inventario dentro de una transacción, y un endpoint de alertas de stock bajo
usando la vista v_alertas_stock.
```

**Paso 4 — Ventas y caja**
```
Implementa ventas: endpoint para crear un pedido (canal tienda_linea y punto_venta),
que en una sola transacción cree pedidos + pedido_detalle + pagos, descuente inventario,
registre movimientos_inventario tipo salida, y para POS registre movimientos_caja.
Añade apertura y cierre de sesiones_caja con cálculo de diferencia.
```

**Paso 5 — Reportes**
```
Crea endpoints de reportes: ventas del día (total y desglose por método de pago),
corte de caja de una sesión, productos por reabastecer (v_alertas_stock) y más vendidos
(v_mas_vendidos), con filtros por rango de fechas y almacén.
```

**Paso 6 — Frontend Angular**
```
Crea la app Angular en /frontend con standalone components y un core con interceptor JWT.
Empieza por el panel admin: login, listado y alta de productos con sus variantes, y la
pantalla de inventario con alertas de stock. Consume la API en /api/v1.
```

---

## 6. Archivos de este repo
- `db/schema_mysql.sql` — esquema principal (validado, 36 tablas + 3 vistas + datos semilla).
- `db/schema_postgres.sql` — el mismo modelo en PostgreSQL.
- `db/erd.mermaid` — diagrama entidad-relación completo.
- `CLAUDE.md` — contexto y reglas que Claude Code usa automáticamente.
