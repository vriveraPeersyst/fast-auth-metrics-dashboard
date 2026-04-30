# Guion de presentación — Dashboard de métricas de FastAuth

Recorrido modular pensado para una reunión de ~20 min, o reducible a 10. Cada sección incluye **[MOSTRAR]** (qué señalar en pantalla) y **[DECIR]** (la línea para leer o adaptar). Las secciones entre paréntesis `(omitir si…)` se pueden saltar según la audiencia.

---

## 0. Antes de la reunión (30 seg de preparación)

- Abrir el dashboard en una pestaña; en otra, `prisma:studio` o psql (solo si asisten ingenieros).
- Tener visibles en la home estas secciones: System Status, MPC Status, Fast Auth Status, Transactions, Consumer Outcomes, Real Activity, Top Failure Reasons, Top Relayers, Accounts, **MPC Network**.
- Si el indexador va atrasado, mencionarlo de entrada — mejor que te lo pregunten.

---

## 1. Apertura — qué es esto y por qué existe (1 min)

**[DECIR]** "Este dashboard es nuestra única fuente de verdad sobre la salud de FastAuth en NEAR mainnet. Responde tres preguntas: *¿el protocolo está funcionando?, ¿quién lo está usando?, y cuando falla, ¿por qué?* Lee directamente de una base de datos Postgres que poblamos indexando la cadena NEAR nosotros mismos — sin servicios de analítica de terceros en medio."

**[DECIR]** "Hay dos servicios que corren desde el mismo repositorio: el dashboard web que están viendo, y un proceso worker separado que escanea los bloques de NEAR y escribe a la base de datos. Comparten un único esquema."

---

## 2. Recordatorio rápido sobre FastAuth *(omitir si toda la sala trabaja en FastAuth)* (2 min)

**[DECIR]** "FastAuth permite a un usuario firmar transacciones de NEAR usando una identidad Web2 — Auth0, Firebase o un proveedor OIDC personalizado — sin tocar nunca una clave privada. El flujo:

1. El usuario inicia sesión con su proveedor de identidad y obtiene un JWT.
2. El JWT llega al contrato on-chain `fast-auth.near`.
3. Un contrato Guard verifica el JWT — `auth0.jwt.fast-auth.near` para Auth0, guards separados para Firebase y para emisores personalizados.
4. FastAuth pide a la red MPC que firme un payload usando una clave derivada de la identidad del usuario. Ninguna parte individual posee la clave completa.
5. La transacción firmada va on-chain.

Todo lo que medimos está aguas abajo del paso 4 o 5."

---

## 3. Recorrido por el dashboard (10 min — el plato fuerte)

### 3a. System Status *(parte superior de la página)*

**[MOSTRAR]** Tarjeta de estado del indexador / System Status.

**[DECIR]** "Primero, ¿podemos confiar en los números? Aquí se ve el último bloque escaneado por el indexador, el retraso respecto al head de la cadena y los huecos abiertos. Los huecos pasan cuando un RPC poda un bloque antes de que lo leamos — los registramos en una tabla `missing_block_ranges` y un proceso de backfill separado los cierra usando RPCs archivales. Si esta tarjeta está en verde, todo lo de abajo es real."

### 3b. MPC Status y Fast Auth Status — las dos tarjetas principales

**[MOSTRAR]** Ambas tarjetas en paralelo.

**[DECIR]** "Se parecen, pero responden a preguntas distintas a propósito.

- **Fast Auth Status** es end-to-end: de cada transacción que tocó el contrato de FastAuth, qué fracción tuvo éxito. Esta es la experiencia real del usuario.
- **MPC Status** es más estrecha: de las transacciones que efectivamente *llegaron a MPC*, qué fracción se firmó. Aísla la salud de la red MPC de los fallos del lado del guard.

Esta distinción importa porque, si los rechazos del guard — JWT inválido, token expirado, claim que no coincide — cuentan contra MPC, terminamos culpando a MPC de problemas que no son suyos. Calculamos las dos y las mostramos juntas para poder distinguirlas."

**[DECIR]** "Las transacciones pendientes se excluyen de los dos denominadores. Su conteo se muestra aparte porque la presión sobre los RPCs aparece como un aumento de pendientes antes de aparecer en cualquier otro lugar."

### 3c. Panel de Transactions

**[MOSTRAR]** El panel de Transactions con sus pestañas. Recorrer las pestañas: overall, por relayer, por proveedor, por guard, por tipo de acción.

**[DECIR]** "Esto es el embudo desde el punto de vista del protocolo — cada sign event NEP-366 que decodificamos, desglosado por quién hizo de relayer, qué proveedor de identidad emitió el JWT, qué guard lo verificó y qué tipo de acción cargaba. Las ventanas 24h / 7d / 30d permiten detectar cambios de tendencia sin salir de la página."

### 3d. Consumer Outcomes vs Real Activity — la parte que todos confunden

**[MOSTRAR]** Ambos paneles.

**[DECIR]** "Parecen lo mismo pero son deliberadamente diferentes. Es fácil mezclarlas:

- **Consumer transactions** son las *consecuencias* on-chain de una llamada a `sign()` — la meta-transacción envuelta en Delegate que el relayer envía y que consume la firma. La mayoría son AddKey / DeleteKey por rotación de session keys cuando los usuarios entran y salen. Mucho volumen, pero es plomería.
- **Real Activity** es lo que los usuarios *hacen* después — una transferencia, un swap, una llamada a contrato — usando una session key derivada de su cuenta FastAuth. Está anclada en la cuenta, así que la atribución sobrevive a la rotación de claves. Además calculamos el valor en USD por token al momento de indexar, por eso 'Real Activity' tiene una cifra en dólares y 'Consumer' no."

**[DECIR]** "Si un stakeholder pregunta 'cuánto uso real tenemos', señalá Real Activity. Si pregunta 'cuánta carga está poniendo FastAuth en la cadena', señalá Consumer Outcomes."

### 3e. Top Failure Reasons

**[MOSTRAR]** El desglose de fallos.

**[DECIR]** "Cuando una transacción falla, recorremos todos los receipts de su cadena de ejecución y registramos el *primer* executor que falló junto con la razón del fallo — no solo 'falló', sino qué contrato y qué string de error. Así construimos esta lista. El clasificador agrupa los fallos de FastAuth en cuatro categorías:

- **`guard_failure`** — el JWT no verificó. Problema del lado del usuario o del proveedor.
- **`mpc_failure`** — el executor del contrato MPC falló. Problema de infraestructura.
- **`other_failure`** — llegó a MPC con éxito y falló más adelante. Normalmente un contrato al que el usuario estaba llamando.
- **`rpc_pending`** — todavía no pudimos clasificarla; reintentamos hasta diez veces y después la dejamos en pending para siempre, en lugar de adivinar."

**[DECIR]** "Cuando el número principal cae, esta tarjeta nos dice por dónde empezar a buscar."

### 3f. Top Relayers

**[MOSTRAR]** La tabla de relayers.

**[DECIR]** "Resumen por relayer: volumen, gas quemado, cuentas únicas patrocinadas. Útil para conversaciones con partners y para detectar si la tasa de fallos de un relayer está arrastrando la métrica global hacia abajo."

### 3g. Accounts — ojo con la semántica

**[MOSTRAR]** El panel de Accounts (KPI tiles + tabla First seen / Active).

**[DECIR]** "Acá hay un punto sutil que conviene aclarar de entrada porque es fácil interpretarlo mal:

- **Total accounts** — todas las cuentas que indexamos.
- **First seen** — cuentas vistas por *primera vez* en una ventana. **No es** la fecha de creación de la cuenta on-chain en NEAR. Es la primera vez que *nosotros* observamos esa cuenta en un sign event de FastAuth y la persistimos. Una cuenta puede tener años en NEAR; si recién hoy usó FastAuth, suma como First seen hoy.
- **Active** — cuentas que tuvieron actividad observada en la ventana.

La columna se llamaba 'Created' antes y la renombramos justamente porque inducía a error. Si alguien pregunta '¿se crearon X cuentas hoy?', la respuesta correcta es '*observamos por primera vez X cuentas usando FastAuth hoy* — algunas pueden ser nuevas, otras existían desde antes'."

### 3h. MPC Network — la red por dentro *(nuevo)*

**[MOSTRAR]** Sección MPC Network (kicker propio, después de Accounts y antes de Indexer Status). Cuatro sub-secciones: KPIs overview, latencia yield→resume, liveness heatmap, network roster, pending sign requests.

**[DECIR]** "Hasta aquí hemos visto FastAuth desde el punto de vista del usuario. Esta sección mira el otro lado: la red MPC `v1.signer` que firma todas las transacciones — y que da servicio no solo a FastAuth, sino a cualquier app de NEAR Chain Signatures. Indexamos toda transacción top-level a `v1.signer` y parseamos los logs estructurados que el contrato emite (`sign:` y `respond:`) para emparejar peticiones con respuestas por bytes del payload.

Lo que se ve:

- **KPIs overview**: responses 24h totales, sign requests (separados en orgánico vs sintético — el bot `tx-bench.near` queda etiquetado), cuántos vienen de FastAuth específicamente, y cuántos signs llevan más de 1 minuto sin respuesta (sub-minuto es propagación normal).
- **Yield→resume latency by node** — la métrica estrella. Para cada nodo MPC: p50 / p95 / p99 del tiempo entre el `sign()` que dispara el yield y el `respond()` que lo resume. Ningún explorer público de NEAR tiene esto.
- **Liveness heatmap** — 24 buckets horarios por nodo. Un nodo silencioso aparece como una fila pálida y se detecta antes de que rompa el quorum.
- **Network roster** — los ~9 nodos MPC observados con sus contadores 24h / 7d / all.
- **Pending sign requests** — signs sin respuesta matched que llevan más de 1 minuto. Distinto del `rpc_pending` de FastAuth: aquello es nuestro fallo de clasificación; esto es estado real on-chain."

**[DECIR]** "Importante: este collector mira la red MPC entera, no solo los signs que vienen de FastAuth. La columna `traffic_source` en pending y el contador `from FastAuth` permiten segmentar."

---

## 4. De dónde salen los datos *(omitir si no hay ingenieros en la sala)* (3 min)

**[DECIR]** "El worker corre seis collectors en paralelo cada 10-30 segundos:

1. **Scanner de NEAR** — trae bloques, decodifica los DelegateActions de NEP-366, llena las tablas raw y derivadas, valoriza los movimientos de tokens en USD. El mismo scan también persiste a parte las txs cuyo receiver es `v1.signer` — el raw landing del MPC consensus, sin RPC adicional.
2. **Linker de claves públicas** — resuelve las claves públicas que vemos en sign events de vuelta a cuentas NEAR vía FastNEAR. Es self-healing: si un lookup falla, el siguiente ciclo reintenta y vuelve a estampar (NearBlocks lo quitamos porque Cloudflare lo bloqueaba sin aportar nada que FastNEAR no resolviera).
3–5. **Tres clasificadores de salud** — uno por cada uno de FA-receiver, consumer y user. Recorren los receipts y asignan outcomes.
6. **Collector de MPC consensus** — mira las txs en `mpc_transactions` y los receipts FastAuth, parsea los logs `sign:` y `respond:` que emite `v1.signer`, y empareja por bytes de payload. Tres pasadas por ciclo con anti-join contra una tabla de tombstones (`mpc_log_parse_skipped`) para no reintentar txs que el guard rechazó antes de llegar a MPC.

Tres puntos de diseño que vale la pena mencionar:

- **Checkpoint primero.** Nunca avanzamos por encima de un hueco. Si un bloque no logra persistirse, el checkpoint se queda donde estaba hasta que el próximo ciclo lo alcance. La recuperación ante caídas es automática.
- **Consenso de mayoría sobre bloques faltantes.** Usamos seis RPCs públicos en round-robin. Si uno dice que un bloque no existe, no le creemos — exigimos que al menos la mitad de los endpoints sanos coincidan antes de saltarlo. Esto nos salvó una vez cuando un solo RPC con poda casi avanza el checkpoint por encima de bloques reales.
- **Path B' para MPC consensus.** Los logs de `sign:` y `respond:` llevan structs distintas — el contrato canonicaliza `path → tweak` en medio. Pero el campo `payload` (los bytes a firmar) aparece igual en los dos lados. Eso lo usamos como clave de matching: `{scheme}:{hex(payload)}`. No tenemos que reimplementar la canonicalización del contrato; solo seguir su formato `Debug` de Rust. Pinneado a la commit `1ee251d` de `near/mpc`."

---

## 5. Limitaciones conocidas y roadmap *(2 min — ser honestos)*

**[DECIR]** "Cosas que conviene saber:

- El esquema todavía tiene tablas para logs de Auth0, métricas de servicios y snapshots de TVL. Esos collectors se quitaron; las tablas están vacías. Reactivar cualquiera es trabajo focalizado, no una reescritura.
- No hay suite de tests automatizada. La verificación se hace con scripts de inspección — `inspect-db`, `diagnose-unclassified`, `validate-pubkey-decoder`.
- El dashboard es de acceso público. No hay capa de auth. Los datos mostrados deben tratarse como públicos — actividad de relayers, claves públicas, metadata de sign events. Por diseño no exponemos PII, pero cualquiera con el URL ve lo mismo que nosotros."

---

## 6. Cierre y preguntas frecuentes (1 min)

**[DECIR]** "Cuatro ideas para llevarse:

1. **Dos números, dos preguntas.** Fast Auth Status = experiencia del usuario. MPC Status = salud de la infraestructura. No las mezclen.
2. **Dos flujos de actividad.** Consumer = plomería. Real Activity = uso real con valor en dólares.
3. **Los fallos están atribuidos, no agregados.** Cuando algo se rompe, sabemos si es guards, MPC o algo más abajo — y qué contrato exactamente.
4. **MPC Network es la otra cara.** No solo medimos FastAuth; también la red MPC que firma para todos. Latencia por nodo, liveness, roster, pendientes — y la sección segmenta cuánto del tráfico viene de FastAuth vs el resto.

Preguntas que probablemente surjan:

- *'¿Por qué la tasa de éxito no es del 100%?'* — Llevarlos por Top Failure Reasons; la mayoría del tiempo es un contrato aguas abajo, no FastAuth en sí.
- *'¿Qué tan fresca es la data?'* — El lag del indexador está en la tarjeta de System Status. En estado estable va a segundos del head; el backfill desde frío está limitado por el throughput de los RPCs.
- *'¿Podemos agregar la métrica X?'* — Probablemente sí, si es derivable de sign events, consumer txs, user txs o eventos MPC. Sumar fuentes de datos externas es una conversación más grande.
- *'¿Quién es `tx-bench.near`?'* — Un bot de benchmarking que llama directamente a `v1.signer.sign()`. Lo etiquetamos como `synthetic` para distinguirlo del tráfico orgánico, pero no lo filtramos: su latencia de respond es señal real sobre la salud de los nodos."

---

## Chuleta — términos que les van a preguntar

| Término | Respuesta en una línea |
|---|---|
| Sign event | Una llamada a `FastAuth.sign()` decodificada según NEP-366. Unidad principal de volumen de firma. |
| Consumer tx | La meta-tx del relayer que consume un sign event. Mayormente rotación de claves. |
| User tx | Actividad real on-chain de un usuario FastAuth, atribuida a su cuenta. |
| Guard failure | El JWT no verificó antes de llegar a MPC. |
| MPC failure | El contrato MPC falló al firmar. |
| `rpc_pending` | Aún no pudimos clasificarla; reintentando. No es lo mismo que "falló". |
| Missing block range | Un rango de bloques que todavía no indexamos. Lo cierra un proceso de backfill separado. |
| Relayer | La cuenta que envía la meta-tx y paga el gas. |
| First seen (Accounts) | Primera vez que indexamos una cuenta vía un sign event de FastAuth. **No** es la creación on-chain. |
| Active (Accounts) | Cuentas con actividad observada en la ventana. |
| `v1.signer` | El contrato MPC de NEAR Chain Signatures. FastAuth lo llama vía cross-contract; otros consumidores lo llaman directamente. |
| Yield→resume latency | Tiempo entre el `sign()` (que hace yield) y el primer `respond()` matched de un nodo. Métrica estrella del MPC consensus dashboard. |
| Sign request | Una llamada a `v1.signer.sign()`, parseada del log estructurado del contrato. |
| Respond | Una llamada a `v1.signer.respond()` por un nodo MPC. Cada sign tiene N respond (uno por nodo participante). |
| `tx-bench.near` | Bot de benchmarking que llama directamente a `v1.signer`. Etiquetado como `synthetic` para distinguir de tráfico orgánico. |
| `mpc_log_parse_skipped` | Tombstones de txs que no produjeron log parseable (típicamente FastAuth signs rechazados por el guard antes de llegar a MPC). Evita loops de RPC. |
