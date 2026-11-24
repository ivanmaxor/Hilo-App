# 2026-11-23 · @dedalexcr7 · avisar antes de pegar una clave

- **Qué se hizo:** idea 23, opción A (confirmar siempre que detecta, sin ajuste nuevo). `src/shared/secretScan.ts` devuelve los tipos de clave que parece contener un texto (Anthropic, GitHub, AWS, Slack, Stripe, clave privada PEM, línea de `.env`), nunca el valor. `paste()` en `terminals.ts` lo consulta tras la espera de Claude y antes del aviso multilínea; si coincide con "varias líneas sin bracketed paste" sale un solo diálogo con ambos avisos. El diálogo (`confirmPaste` en `controller.ts`) es `danger`, con Cancelar enfocado, y lista solo el tipo. Funciona con y sin bracketed paste.
- **Commits / PR:** rama `feature/idea-detector-claves`, PR de `Closes #29`.
- **Probado:** unitarias (`tests/unit/secretScan.test.ts`, 12 casos, incluidos 5 MB en menos de 150 ms y los de Slack y Stripe) y e2e (`tests/e2e/pegar-clave.spec.ts`, 6 casos: Cancelar no escribe nada, Pegar escribe, lo tecleado durante el diálogo sale después y en orden, texto normal sin diálogo, clave más varias líneas en un solo diálogo). `clipboard.spec.ts` sigue pasando.
- **Sin verificar:** falsos positivos con textos reales (código, hashes, ejemplos públicos); solo se afinan usándolo. Pegado con Claude real (las e2e usan la shell falsa).
- **Decidido por el dueño en el #13:** sin interruptor en Ajustes por ahora; **Slack y Stripe sí** (sus prefijos son claros), JWT después; los nombres de `.env` solo cuentan en mayúsculas, como está.
  - Slack: `xoxb-`, `xoxp-`, `xoxa-`, `xoxr-`, `xoxs-` y `xapp-`. Stripe: claves secretas y restringidas, `sk_live_`, `sk_test_` y `rk_…`. La clave publicable `pk_…` no avisa: es pública por diseño.
  - Un ejemplo de la documentación de Stripe (`sk_test_…` con 24 caracteres) también avisa: es el precio de que `sk_test_` cuente.
- **Queda pendiente:** nada que decida el dueño en esta idea. JWT, más adelante, si se quiere; la opción C (solo un toast) quedó descartada.
