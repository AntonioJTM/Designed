# Backend · Tienda de hilos

API REST en Node.js + Express con `mysql2/promise`. Autenticación JWT y contraseñas con bcrypt.

## Requisitos
- Node.js >= 18
- MySQL 8 / MariaDB 10.5+ con el esquema de [`db/schema_mysql.sql`](../db/schema_mysql.sql) ya cargado.

## Puesta en marcha
```bash
cd backend
cp .env.example .env      # y ajusta credenciales de BD + JWT_SECRET
npm install
npm run dev               # nodemon, recarga en caliente
# o
npm start
```

El servidor arranca en `http://localhost:3000` y verifica la conexión a la BD al iniciar.

## Estructura
```
src/
├── config/       env.js (variables) · db.js (pool + withTransaction)
├── middlewares/  auth.js (JWT) · error.js · validate.js (zod)
├── utils/        jwt.js · password.js (bcrypt)
├── modules/
│   ├── usuarios/ staff  → model/service/controller/routes
│   └── clientes/ cuenta de cliente
├── routes.js     enrutador /api/v1
├── app.js        app Express
└── server.js     arranque + apagado ordenado
```

## Endpoints de autenticación
Todas las respuestas tienen la forma `{ "data": ..., "error": null }` o `{ "data": null, "error": {...} }`.

| Método | Ruta | Descripción | Auth |
| ------ | ---- | ----------- | ---- |
| POST | `/api/v1/usuarios/registro` | Alta de staff (`rol_id`, `nombre`, `correo`, `contrasena`, `telefono?`) | — |
| POST | `/api/v1/usuarios/login` | Login de staff | — |
| GET  | `/api/v1/usuarios/perfil` | Perfil del staff autenticado | Bearer (staff) |
| POST | `/api/v1/clientes/registro` | Alta de cliente (`nombre`, `correo`, `contrasena`, `telefono?`, `acepta_marketing?`) | — |
| POST | `/api/v1/clientes/login` | Login de cliente | — |
| GET  | `/api/v1/clientes/perfil` | Perfil del cliente autenticado | Bearer (cliente) |

El token se envía en el header `Authorization: Bearer <token>`. El payload incluye
`{ sub, tipo: 'usuario'|'cliente', rol_id?, rol? }`.

### Ejemplo
```bash
# Registro de staff (rol_id 1 = administrador, ver seed del esquema)
curl -X POST http://localhost:3000/api/v1/usuarios/registro \
  -H "Content-Type: application/json" \
  -d '{"rol_id":1,"nombre":"Ana","correo":"ana@tienda.mx","contrasena":"secreta123"}'

# Login y uso del token
curl -X POST http://localhost:3000/api/v1/usuarios/login \
  -H "Content-Type: application/json" \
  -d '{"correo":"ana@tienda.mx","contrasena":"secreta123"}'

curl http://localhost:3000/api/v1/usuarios/perfil \
  -H "Authorization: Bearer <token>"
```

## Notas de seguridad
- Nunca se expone `contrasena_hash` en las respuestas.
- Errores de credenciales son genéricos para no revelar si el correo existe.
- La validación de entrada usa `zod` con `.strict()` (rechaza campos no esperados).
