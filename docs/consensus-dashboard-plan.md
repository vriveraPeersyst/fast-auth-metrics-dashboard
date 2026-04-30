# Consensus Dashboard — plan

Propuesta para un dashboard hermano del actual, focalizado en la salud y la actividad de la red MPC (`v1.signer` en mainnet, `v1.signer-prod.testnet` en testnet) que respalda FastAuth.

> **Estado:** propuesta. Nada implementado aún. Este doc define el alcance, schema y fases para discutir antes de tocar código.

---

## 1. Por qué integrarlo a la home actual

El dashboard actual responde *"¿FastAuth funciona para los usuarios?"*. La red MPC es la infraestructura que lo hace posible — y hoy no tenemos visibilidad pública de su salud interna. La extensión consensus responde tres preguntas que el dashboard actual no puede:

1. **¿Qué nodos están vivos?** Liveness por nodo: cuándo respondió por última vez, cadencia, drift.
2. **¿Cuán rápido se firma?** Latencia entre `sign` (yield) y `respond` (resume) por nodo y agregada.
3. **¿Está la red en consenso?** Versión de código que vota cada nodo, eventos de keygen/reshare, attestations TEE válidas.

**Decisión de hosting:** todo vive en la misma home (`/`), como secciones nuevas integradas al flujo existente. Sin ruta `/mpc` separada. El razonamiento:

- La salud de MPC es la causa raíz de la salud de FastAuth — separarlas en URLs distintas obliga al lector a saltar entre páginas para diagnosticar incidentes.
- Mismo indexador, misma DB, mismo deployment — cero overhead de infra.
- La tarjeta MPC Status actual ya mezcla las dos audiencias; estas secciones son su profundización natural.

**Trade-off explícito:** integradores FastAuth verán contenido que les puede sobrar (latencias por nodo, votos de code_hash). Mitigación: las secciones MPC-network van **al final** del flujo de la home, después de Top Relayers y Accounts, agrupadas bajo un kicker propio (*"MPC Network"*). El lector que solo quiere FastAuth no necesita scrollear hasta ahí.

### 1.1 Alcance de atribución — Nivel B

`v1.signer` es la red MPC genérica de NEAR Chain Signatures. FastAuth es uno de sus consumidores; hay otros (signs para ETH/BTC/Solana, dApps que usan chain signatures directamente). Esto define tres niveles posibles de cobertura:

| Nivel | Fuente | Qué nos da |
|---|---|---|
| **A** | Solo `mpc_transactions` | Roster, liveness, mix de métodos por nodo, gobernanza, volumen agregado de respuestas (sumando *todos* los consumidores). Sin atribución por consumidor. |
| **B** | `mpc_transactions` + cruce con `near_transactions` (Path 1 ya existente) | Todo lo de A + correlación `sign` ↔ `respond` y latencia yield→resume **para signs originados por FastAuth**. |
| **C** | Path 5 nuevo: capturar txs cuyos *receipts* toquen v1.signer como executor | Atribución completa por consumidor (FastAuth vs Sweat vs ETH chain signatures vs etc.). |

**Decisión:** Nivel B. El consensus dashboard MVP entero se cubre con Nivel A; la atribución FastAuth↔MPC sale gratis al cruzar con datos que ya tenemos en `near_transactions`. Nivel C queda en el cajón hasta que haya demanda explícita de segmentar por consumidor no-FastAuth.

**Implicación práctica:** los `respond` de signs originados por otros consumidores aparecen en `mpc_transactions` igualmente (cuentan para roster, liveness, latencias agregadas), pero no podemos decir *quién* los pidió ni emparejarlos con un `sign` específico.

---

## 2. Fuente de verdad

`v1.signer` está verificado on-chain vía NEP-330 v1.3.0:

| Campo | Valor |
|---|---|
| Versión | `3.9.1` |
| Commit | [`1ee251d82f3fd4efa5c3ebd8ccfd3c6cba9f51bb`](https://github.com/near/mpc/tree/1ee251d82f3fd4efa5c3ebd8ccfd3c6cba9f51bb) |
| Build | `sourcescan/cargo-near:0.17.0-rust-1.86.0` |
| IPFS | `QmbjBrydz3Lt2mdNoHBsEAsTz3b67X4CQf1mWfC6yX7Nwe` |
| ABI | embebida en el WASM (`--features abi`) |

**Política de pinning:** todos los decoders del indexador se pinnean a esa commit. Cuando el contrato se actualice (vía `vote_update` + `propose_update`), un alerter dispara: (1) snapshot de la nueva commit/version, (2) regenerar artefactos del decoder, (3) test contra fixtures pre/post upgrade.

---

## 3. Tres pipelines paralelos

El contrato expone tres flujos request/respond con la misma forma estructural pero schemas distintos:

| Pipeline | Request method | Response method | Pending lookup |
|---|---|---|---|
| Signing | `sign(SignRequestArgs)` | `respond(SignatureRequest, SignatureResponse)` | `get_pending_request` |
| CKD (Custom Key Derivation) | *implícito en flow CKD* | `respond_ckd(CKDRequest, CKDResponse)` | `get_pending_ckd_request` |
| Foreign tx verification | `verify_foreign_transaction(VerifyForeignTransactionRequestArgs)` | `respond_verify_foreign_tx(VerifyForeignTransactionRequest, VerifyForeignTransactionResponse)` | `get_pending_verify_foreign_tx_request` |

Los tres siguen el mismo patrón yield/resume. El indexador los trata como pipelines independientes — mismo código de correlación, distinto schema de payload.

**MVP arranca solo con Signing.** CKD y Foreign tx se suman en fases posteriores.

---

## 4. Correlación `sign` ↔ `respond`

Tres caminos posibles. **Decisión: path (B'), refinamiento de (B)**, validado contra fixtures reales en Fase 1.

**(A) Canonicalización Borsh.** Replicar la lógica del contrato: decodificar `SignRequestArgs`, transformarla a `SignatureRequest` (incluye `derive_tweak(path, predecessor, ...)`), hashear y usar como clave. Máxima precisión pero requiere mantener el decoder al día con cada upgrade del contrato.

**(B) Igualdad textual del `request` log entre `sign` y `respond`.** Idea inicial: el contrato emite `log!("sign: ..., request={:?}", request)` y `log!("respond: ..., request={:?}", request)`. Si parseamos los strings y matcheamos por igualdad, listo.

**Problema validado en Fase 1**: los dos lados emiten *structs distintas* en el log:

```
sign:    request=SignRequestArgs { path: "...", payload_v2: Some(Ecdsa/Eddsa(BoundedVec { inner: [bytes] })) }
respond: request=SignatureRequest { tweak: Tweak([32 bytes]), payload: Ecdsa/Eddsa(BoundedVec { inner: [bytes] }) }
```

El contrato canonicaliza `path → tweak` antes de hacer enqueue, así que el `respond` log ya solo ve la forma derivada. Ni igualdad textual ni un decoder simple sirven sin reimplementar `derive_tweak`.

**(B') Match por bytes del payload.** El campo `payload` (el array `inner: [bytes]` dentro de `Ecdsa(...)` o `Eddsa(...)`) **aparece en ambos lados con el mismo contenido**. Es el mensaje real a firmar — único por cada sign request.

Estrategia:

1. Del `sign:` log → extraer `payload_v2.Some.[Ecdsa|Eddsa].BoundedVec.inner`.
2. Del `respond:` log → extraer `payload.[Ecdsa|Eddsa].BoundedVec.inner`.
3. Matchear por igualdad textual de la clave `{scheme}:{hex(bytes)}` (ej: `ecdsa:0a1b...`, `eddsa:7f3c...`).

Tres cosas a tener en cuenta:

- Es **1 → N**: un `sign` engancha con varios `respond` (uno por nodo participante hasta quorum).
- El **scheme** (ecdsa vs eddsa) se incluye en la clave para evitar colisiones cross-scheme.
- Si en algún momento aparece tráfico **legacy `Secp256k1`** (variante antigua del struct con `payload: Vec<u8>` plano, mencionada en la doc del MPC pero no observada en muestras actuales), añadimos un tercer prefijo `secp256k1-legacy:hexbytes` al parser. El esquema de matching sobrevive sin cambios.

**Decisión:** Path B'. Más barato que A (no reimplementamos `derive_tweak`), más robusto que B (no asume igualdad textual de structs distintas).

---

## 5. Schema propuesto (Postgres / Prisma)

Cinco tablas nuevas en total. La primera (`mpc_transactions`, raw landing) ya está implementada en Fase 0 — las otras cuatro son derivadas y vienen en fases posteriores. Todas idempotentes (PK natural, `skipDuplicates` en bulk inserts).

### 5.0 `mpc_transactions` — raw landing *(implementado)*

Mirror estructural de `near_transactions`. Se popula desde **Path 4 de `near.ts`** durante el mismo block scan que ya corre. Cero costo RPC adicional. Filtro: `receiver_id ∈ {v1.signer}`.

| Campo | Tipo | Notas |
|---|---|---|
| `txHash` | `String` (PK) | |
| `blockHeight` | `BigInt?` | |
| `blockTimestamp` | `DateTime?` | indexado |
| `signerAccountId` | `String?` | la cuenta del nodo MPC en `respond*` calls |
| `signerPublicKey` | `String?` | |
| `receiverId` | `String?` | siempre `v1.signer` por filtro |
| `methodName` | `String?` | indexado — filtramos por `respond`, `respond_ckd`, etc. |
| `executionStatus` | `String?` | |
| `failureReason` | `String?` | |
| `gasBurnt` | `BigInt?` | |
| `attachedDepositYocto` | `String?` | |
| `payload` | `Json` | tx serializada — actions, etc. |

Índices: `(blockTimestamp)`, `(methodName, blockTimestamp)`, `(signerAccountId, blockTimestamp)`.

Las cuatro tablas siguientes (`mpc_node`, `mpc_sign_request`, `mpc_sign_response`, `mpc_consensus_event`) son **derivadas** de `mpc_transactions` por collectors posteriores que decodifican args y emparejan request↔response.

### 5.1 `mpc_node`

Roster de nodos. Bootstrap vía view-call a `get_tee_accounts()`; se enriquece después con cada `submit_participant_info` y cada `respond*` que veamos.

| Campo | Tipo | Notas |
|---|---|---|
| `accountId` | `String` (PK) | `nearcore-pagoda-1.poolv1.near` o equivalente |
| `firstSeenAt` | `DateTime` | primer `respond*` o `submit_participant_info` observado |
| `lastSeenAt` | `DateTime` | último `respond*` observado |
| `tlsPublicKey` | `String?` | de `submit_participant_info` |
| `attestationStatus` | `enum` | `valid \| invalid \| unknown` |
| `votedCodeHash` | `String?` | último voto de `vote_code_hash` |
| `votedLauncherHash` | `String?` | |
| `votedOsMeasurement` | `String?` | |

### 5.2 `mpc_sign_request`

Una fila por `sign(...)` exitoso (yield enqueued). Independiente de si después llega `respond` o no.

| Campo | Tipo | Notas |
|---|---|---|
| `txHash` | `String` (PK parte 1) | tx que invocó `sign` |
| `actionIndex` | `Int` (PK parte 2) | por si `sign` se invoca múltiples veces en una tx |
| `blockHeight` | `BigInt` | |
| `blockTimestamp` | `DateTime` | indexado |
| `predecessorId` | `String` | quién pidió firmar (FastAuth, dApp, etc.) |
| `requestKey` | `String` | clave canónica derivada del log `request={:?}` para matchear con `respond` |
| `path` | `String` | extracto del SignRequestArgs.path |
| `domainId` | `Int?` | |
| `keyVersion` | `Int?` | |
| `algorithm` | `String?` | `secp256k1 \| ecdsa \| eddsa` |
| `attachedDepositYocto` | `String?` | `#[payable]` |
| `executionStatus` | `String?` | success / failure |

Índices: `(blockTimestamp)`, `(requestKey)`, `(predecessorId, blockTimestamp)`.

### 5.3 `mpc_sign_response`

Una fila por `respond(...)` exitoso. Foreign key lógica a `mpc_sign_request` vía `requestKey`.

| Campo | Tipo | Notas |
|---|---|---|
| `txHash` | `String` (PK) | tx del nodo MPC |
| `blockHeight` | `BigInt` | |
| `blockTimestamp` | `DateTime` | indexado |
| `signerId` | `String` | cuenta del nodo MPC que respondió — FK a `mpc_node` |
| `requestKey` | `String` | matchea con `mpc_sign_request.requestKey` |
| `responseScheme` | `String?` | `ecdsa \| eddsa` |
| `executionStatus` | `String?` | |

Índices: `(signerId, blockTimestamp)`, `(requestKey)`, `(blockTimestamp)`.

### 5.4 `mpc_consensus_event`

Eventos de gobernanza/red: keygens, reshares, votos por code_hash, abortos. Tabla flexible con `eventType` enum + payload JSON.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | `BigInt` (PK auto) | |
| `txHash` | `String` | |
| `blockHeight` | `BigInt` | |
| `blockTimestamp` | `DateTime` | indexado |
| `eventType` | `enum` | `keygen_start \| keygen_vote \| reshare_start \| reshare_vote \| code_hash_vote \| update_propose \| update_vote \| key_event_abort \| ...` |
| `actorId` | `String` | quién emitió el evento (predecessor o signer según método) |
| `payload` | `Json` | datos específicos del evento |

Índices: `(eventType, blockTimestamp)`, `(actorId, blockTimestamp)`.

---

## 6. Indexador — qué cambia

El collector NEAR (`src/lib/indexers/near.ts`) ya escanea **todos** los `near_transactions` y persiste los crudos. No hay que tocar la fuente — solo agregar un collector nuevo:

**`src/lib/indexers/mpc-consensus.ts`** (propuesto)

- **Discovery**: anti-join `near_transactions` contra `mpc_sign_response` (y las otras tres tablas). Filtra por `receiver_id IN ('v1.signer', 'v1.signer-prod.testnet')`.
- **Decoder**: por `methodName`, despacha a la función parser correspondiente (`sign`, `respond`, `submit_participant_info`, `vote_code_hash`, ...).
- **Logs parser**: para extraer `requestKey` consistentemente, lee `outcome.logs` del receipt y matchea contra el formato `Debug` del struct `SignatureRequest`.
- **Bounded per-cycle**, igual que los health classifiers actuales: `DISCOVER_LIMIT = 100`, `DISCOVERY_LOOKBACK_DAYS = 1`.

No requiere checkpoint propio — usa anti-join.

**Roster bootstrap script** (`src/scripts/bootstrap-mpc-roster.ts`):
- Llama view `get_tee_accounts` vía RPC.
- Hace upsert a `mpc_node` para cada cuenta retornada.
- Idempotente, se puede correr cuantas veces sea necesario.

---

## 7. UI — integración en la home actual

Las secciones nuevas van agrupadas bajo un kicker `"MPC Network"` después de la zona FastAuth y antes del footer. Orden propuesto en `src/app/page.tsx`:

```
┌─ Header / brand
├─ Status kicker
│  └─ MPC Status + Fast Auth Status (existente)
├─ Transactions panel (existente)
├─ Consumer Outcomes (existente)
├─ Real Activity (existente)
├─ Top Relayers (existente)
├─ Accounts (existente)
├─ MPC Network kicker  ← NUEVO grupo
│  ├─ 7.1 Latencia yield→resume
│  ├─ 7.2 Liveness por nodo (heatmap)
│  ├─ 7.3 Network roster
│  └─ 7.4 Pending requests
└─ System Status (existente, queda al final)
```

Cuatro secciones nuevas, en orden de relevancia para el lector que llega buscando "qué pasa con MPC":

### 7.1 Latencia yield→resume

Para signing requests en las últimas 24h: distribución de tiempo entre `sign` block timestamp y `respond` block timestamp, agrupada por nodo. Histograma + p50/p95/p99. **Esta es la métrica estrella** — nadie la tiene públicamente hoy. Va primero porque es el complemento natural de la tarjeta MPC Status que está arriba.

### 7.2 Liveness por nodo

Heatmap simple: filas = nodos, columnas = últimas 48 horas en buckets de 30 min, color = count de respuestas en ese bucket. Detecta nodos que se silencian antes de que la firma se rompa.

### 7.3 Network roster

Tabla con todos los nodos: `accountId`, `lastSeenAt`, status TEE, version votada, count de `respond*` en 24h/7d/30d. Misma forma visual que Top Relayers para no inventar componentes nuevos.

### 7.4 Pending requests

`sign` calls que todavía no tienen `respond` matcheado. Si una request lleva > N minutos pendiente, alerta visual. Útil para operaciones — distinto de `rpc_pending` del dashboard FastAuth (eso es un fallo de clasificación nuestra, esto es un problema real on-chain).

### Notas de integración visual

- Reutilizar las clases CSS existentes (`.healthCard`, `.kpiTile`, `.tableWrap`, `.metricTabsStrip`) para no romper el lenguaje visual.
- El kicker `"MPC Network"` usa el mismo componente `<p className="sectionKicker">` que ya existe.
- Si una sección queda vacía (ej: aún no llegaron datos), renderizar `null` en vez de un placeholder — la home ya tiene mucho contenido y no queremos secciones huecas.
- El bloque entero puede envolverse en un `<details>` colapsable a nivel grupo si los integradores FastAuth se quejan del scroll. Decidir basado en feedback post-launch, no anticipar.

---

## 8. Fases

**Fase 0 — Raw landing *(hecho)***
- Modelo Prisma `MpcTransaction` agregado a `prisma/schema.prisma`.
- Path 4 en `src/lib/indexers/near.ts`: filtra y persiste txs con `receiver_id ∈ {v1.signer}` durante el mismo scan existente. Cero costo RPC adicional.
- Pendiente del usuario: correr `pnpm prisma migrate dev --name add_mpc_transactions` y dejar al worker acumular datos por unas horas para tener fixtures reales.

**Fase 1 — Validación de logs y decoders (1-2 días)**
- Bajar la ABI del WASM contra commit `1ee251d` (vía `cargo near abi` en el repo `near/mpc`, o extracción del WASM en cadena).
- Script de inspección que lea ~50 filas de `mpc_transactions` con `methodName = 'respond'`, haga RPC `tx` para extraer `outcome.logs`, e imprima formato crudo.
- Confirmar que el formato `Debug` del `request: SignatureRequest` en los logs es estable y parseable.
- Decisión binaria: path (B) logs vs path (A) Borsh (sección 4).

**Fase 2 — Decoders + correlación (1 semana)**
- Tablas derivadas `mpc_sign_request` + `mpc_sign_response` (sección 5).
- Collector `mpc-consensus.ts`: lee de `mpc_transactions` + receipts FastAuth en `near_transactions`, decodifica los `sign:` y `respond:` logs, popula derivadas.
- Matching por payload bytes (Path B' de sección 4). Clave: `{scheme}:{hex(payload_inner)}`.
- Tabla `mpc_node` poblada desde el tráfico observado (los 9 nodos ya están identificados en Fase 1 — ver sección 9.1). View-call a `get_tee_accounts()` queda como **nice-to-have**, no bloqueante.

**Fase 3 — UI MVP *(implementada)***
- Componente `MpcNetworkSection` (`src/components/mpc-network-section.tsx`) con las cuatro sub-secciones (latencia, liveness, roster, pending) bajo el kicker "MPC Network".
- Loaders en `src/lib/dashboard-data.ts` (`loadMpcNetworkOverview`) — cuatro queries paralelas: latencia con percentiles SQL, roster con counts ventaneados, liveness en buckets de 1h, pendientes (sign sin respond matcheado).
- Insertado en `src/app/page.tsx` después de Top Accounts y antes de Indexer Status, según el orden definido en sección 7.

**Fase 4 — Governance + key events *(implementada)***
- Tabla `mpc_consensus_events` con `(eventType, category, actorId, payload)` indexada por las tres dimensiones.
- Decoder JSON inline desde `mpc_transactions.payload_json` (sin RPC adicional). Args base64-decoded → JSON.parse → fallback a sentinel `_decode_error` si algo falla.
- 26 métodos de gobernanza categorizados en 6 buckets: `tee`, `version`, `key_events`, `updates`, `foreign_chains`, `migration`.
- Pasada nueva en `mpc-consensus.ts` con anti-join, lookback de 30 días (más amplio que las otras pasadas porque governance es raro y queremos histórico completo).
- UI en la home: tarjeta overview con KPIs (events 24h/7d, code-hash consensus indicator), tabla por categoría, **tabla de drift de code_hash por nodo**, y timeline cronológico con resumen por evento (`payloadSummary` extrae hash/tls/key_event_id según el tipo).

**Fase 4.1 — FastAuth contract state *(implementada)***
- Séptimo collector `fastauth-contract-state.ts`: snapshot periódico (cada ~5 min) de los tres contratos FastAuth en mainnet vía view-calls. Para cada uno persiste balance / storage / code_hash / full_access_keys (→ locked) + config JSON con view methods (`owner`, `paused`, `mpc_address`, `mpc_domain_id`, `mpc_key_version`, `version`, `get_public_keys` para Auth0) + `contract_source_metadata` (NEP-330).
- Tabla `fastauth_contract_snapshots` append-only. Throttled vía `fastauth_contract_state_last_run_at` checkpoint.
- UI: nueva sección **FastAuth Contracts** en la home con tres tarjetas (FastAuth, JWT Guard Router, Auth0 Guard) mostrando estado actual + config + source metadata. Para Auth0 Guard incluye un `<details>` colapsable con las RSA public keys activas.

**Fase 5 — CKD + foreign tx pipelines** (cuando haya demanda).

---

## 9.1 Hallazgos de Fase 1 (validación de logs)

Confirmado on-chain con muestras reales (commit `1ee251d`, abril 2026):

- **Roster real, 9 nodos MPC observados por tráfico**: `n1-multichain.near`, `mpc-lgns.near`, `stakin-mpc.near`, `everstake-mpc-1.near`, `near-mpc-staking4all-01.near`, `nodemonster.near`, `multichain-mainnet-aurora.near`, `blacksandtech.near`, `tx-bench.near`. Distribución de respuestas bastante uniforme (45-62 por nodo en una ventana de 22 min).
- **Volumen real**: ~29.000 mpc_transactions/día. Mayor a la estimación inicial (10k/día) porque la red sirve a más consumidores que solo FastAuth.
- **Patrones de receipts** (sirve para optimizar el log walk):
  - `respond` tx → 2 receipts (1 ejecutado en v1.signer, 1 callback).
  - `sign` directo → 4 receipts (2 en v1.signer).
  - FastAuth `sign` tx → 14 receipts (2 en v1.signer).
- **Ratio observado de signs FastAuth vs directos** (en una ventana de 22 min): 5 directos vs varios FastAuth. Los directos se concentran en `tx-bench.near` (ver siguiente punto).

### Tráfico no-orgánico — `tx-bench.near`

`tx-bench.near` es un **bot de benchmarking**, confirmado por el patrón de sus llamadas:

- Todas sus `sign` tienen `path: ""` (vacío — derivación trivial).
- Payloads aleatorios sin estructura semántica.
- Alterna ECDSA / EdDSA en ciclos cortos.

**Decisión**: NO filtrarlo del raw landing — sigue siendo carga real para los nodos y su latencia es información válida sobre la salud de la red. Pero **etiquetarlo desde Fase 2 como `traffic_source = synthetic`** para que el dashboard pueda separar "demanda real vs sintética" en las gráficas. Implementación: un campo en `mpc_sign_request` o un mart aparte `mpc_traffic_source` con regla de clasificación.

### Atribución de signs FastAuth

Los `sign:` logs de FastAuth aparecen en receipts de `near_transactions` (ya capturados por Path 1) con `predecessor=AccountId("fast-auth.near")`. Los signs directos (tx-bench, otros) aparecen en `mpc_transactions` (Path 4) con `predecessor` igual al signer top-level. Eso da atribución por consumidor "gratis" desde el log mismo.

## 9. Riesgos y consideraciones

- **Volumen de datos.** Cada `sign` produce ~N `respond` (uno por nodo participante hasta quorum). Si hay 8 nodos y 100 sign/día, son 800 filas/día — irrisorio. Si en el futuro hay 1000 sign/día con 30 nodos, 30k filas/día — todavía manejable, pero conviene tener TTL en `mpc_sign_response` (ej: > 90 días → archive).
- **Drift de versión.** Si el formato de logs cambia entre versiones, el decoder se rompe silenciosamente. Mitigación: alert basado en `contract_source_metadata` view-call cada 6h; si el commit cambia, abrir issue automático.
- **Alcance.** Es muy fácil que esto crezca a un "explorer de v1.signer". Mantener el foco en *consensus health*, no en explorar todo el contrato. Las funciones de gobierno (`vote_*`, `propose_update`) entran solo si aportan a la pregunta de salud.
- **Audiencia mezclada.** Al integrar todo en una home, integradores FastAuth y operadores de nodos comparten página. Mitigación principal: orden y agrupación (sección 7) — lo MPC-network va después de lo FastAuth, bajo su propio kicker. La copy de las secciones MPC asume audiencia técnica; las FastAuth se mantienen como están.
- **Privacidad.** Toda la información es on-chain pública. Pero un dashboard que ranquea nodos por latencia puede tener efectos de incentivo (nodos optimizando para la métrica visible en lugar de la salud real). Documentar las metodologías y mostrar percentiles, no rankings absolutos.

---

## 10. Preguntas abiertas

1. ~~**¿`v1.signer` sirve solo a FastAuth, o también a otros consumidores?**~~ **Resuelto** — sí sirve a otros (chain signatures genéricas). Decisión: Nivel B (sección 1.1). No segmentamos por consumidor en el MVP.
2. **¿Cuál es el formato exacto del `Debug` del `SignatureRequest`?** Hay que verlo en logs reales antes de comprometernos al path (B) de correlación. Lo resuelve Fase 1 contra fixtures reales.
3. **¿Existen métodos view del contrato útiles para reconciliación?** `metrics`, `state`, `config` aparecen en la lista — habría que llamarlos para entender qué exponen.
4. **¿Quién es el dueño del dashboard una vez deployado?** Si es Peersyst, scope FastAuth-friendly. Si es NEAR core, tono más neutral.

---

## 11. Próximo paso concreto

**Fases 0–3 completas.** Resumen del estado:

- **Fase 0**: Path 4 en `near.ts` indexa ~29k mpc txs/día (verificado con `_inspect-mpc.ts`).
- **Fase 1**: format de logs validado (`_validate-mpc-logs.ts`), Path B' confirmado (`_validate-mpc-parser.ts` → 5 de 6 request keys con match `sign` ↔ `respond`).
- **Fase 2**: tres tablas derivadas (`mpc_node`, `mpc_sign_requests`, `mpc_sign_responses`), collector `mpc-consensus.ts` con tres pasadas de discovery (respond + sign-direct + sign-fastauth), mart `mpc_node` reconstruido por ciclo, integrado en `runAllIndexers`.
- **Fase 3**: `MpcNetworkSection` en la home con cuatro sub-secciones (latencia, liveness, roster, pending), tipos y loaders en `dashboard-data.ts`.

**Pendiente del usuario** (cada fase requiere un migrate; todas son aditivas):

```bash
# Fase 0:
pnpm prisma migrate dev --name add_mpc_transactions
# Fase 2:
pnpm prisma migrate dev --name add_mpc_consensus_tables
# Fase 2.1 (post-deploy):
pnpm prisma migrate dev --name add_mpc_log_parse_skipped
# Fase 4:
pnpm prisma migrate dev --name add_mpc_consensus_events
# Fase 4.1:
pnpm prisma migrate dev --name add_fastauth_contract_snapshots
```

Después del deploy, dejar al worker correr. La sección "MPC Network" en la home incluye los cuatro paneles de Fase 3 (latencia, liveness, roster, pending) más los tres de Fase 4 (governance overview, code-hash drift, recent events timeline). Si no hay datos aún, cada panel renderiza placeholder.

**Siguiente fase posible (Fase 5)** — pipelines CKD + foreign tx verification:
- Decoders de `respond_ckd` / `respond_verify_foreign_tx`.
- Tablas paralelas (`mpc_ckd_*` / `mpc_foreign_tx_*`) con la misma forma que sign↔respond.
- Solo vale la pena cuando el volumen lo justifique (en steady state actual son ~127/día CKD y ~2/día foreign-tx).
