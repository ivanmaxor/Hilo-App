# R5 - UX de estado a la vista para 9+ sesiones (nov 2026)

Fuentes verificadas (docs oficiales/vendor, afirmaciones de producto = autodeclaradas):
- Warp vertical tabs: https://docs.warp.dev/terminal/windows/vertical-tabs
- Warp notificaciones: https://docs.warp.dev/agent-platform/capabilities/agent-notifications.md
- VS Code terminal tabs: https://code.visualstudio.com/docs/terminal/basics
- iTerm2 badges: https://iterm2.com/documentation-badges.html
- cmux: https://cmux.com/compare/best-terminal-for-ai-coding-agents
- Superset vs cmux / Conductor: https://superset.sh/compare/superset-vs-cmux , https://superset.sh/compare/conductor-alternative
- Claude Terminal (solo ideas, GPL-3): https://github.com/Sterll/claude-terminal
No verificado (no hallé docs fetcheables; marcado "memoria"): Windows Terminal, Tabby, WezTerm, Claude Squad, Crystal/Nimbalyst.
Conductor/Superset: solo se confirma worktree-por-tarea y que son macOS; sin detalle de indicadores.

## Tabla referencia -> copiar / evitar

| Referencia | Copiar | Evitar |
|---|---|---|
| Warp vertical tabs | Barra lateral izquierda reemplaza tabs; densidad Compacta (1 linea: icono+titulo) / Expandida (titulo+cwd+rama); badge de estado SUPERPUESTO al icono (reloj, check, triangulo, stop) = forma distinta por estado; punto de "no leido" de color accent; doble clic = renombrar inline (Enter/Esc); hover = tarjeta flotante con metadatos sin cambiar foco; buscador por titulo/cwd/rama; las notificaciones se limpian al navegar a la sesion | "Magenta clock" para "trabajando" (compite con el accent); filas Expandidas a 9+ sesiones en 768 px |
| Warp notification mailbox | Bandeja unica (campana) con filtros Todo / No leidos / Errores; filtros solo aparecen si hay contenido | Bandeja separada como unica via: debe ser complemento del sidebar |
| VS Code terminal tabs | Lista a la derecha con icono+color+nombre; icono de estado a la derecha del titulo (check/X/campana) con tooltip; arrastrar para reordenar y para mover a otro grupo; split por boton hover, Alt+clic, Ctrl+Shift+5; navegar grupos con Ctrl+PgUp/PgDn | Estado como icono diminuto sin texto (16 px, solo hover); color de tab = decoracion sin semantica |
| Windows Terminal (memoria) | Indicador de bell/progreso en el tab (OSC 9;4 anillo de progreso); color de tab; renombrar por menu; Ctrl+Shift+P paleta; split Alt+Shift+- / + | Barra horizontal unica: con 9+ tabs trunca titulos; menu contextual como unica via de renombrar |
| Tabby (memoria) | Indicador de actividad en tab, color por perfil, tabs arrastrables | Tabs horizontales con scroll; titulos auto-generados ruidosos |
| WezTerm / iTerm2 | iTerm2: badge de texto grande en esquina del panel (texto = no depende del color), color de tab; ambos: "atencion = cableado a mano" (cmux) | Badge grande dentro del terminal (tapa contenido); depender de scripting del usuario para el estado |
| cmux (macOS) | Anillo de notificacion en el panel; sidebar con rama + directorio + ULTIMO TEXTO de notificacion; Cmd+Shift+U = ir al ultimo no leido; Cmd+Ctrl+U = marcar como mas antiguo no leido y pasar al siguiente (cola de triage); fork comunitario: spinner / punto rojo esperando input / "done" | Solo macOS: reimplementar ideas, no dependencias |
| Superset / Conductor / Claude Squad | Una sesion = un worktree/rama visible en la fila; panel de revision/diff por sesion (memoria); lista de agentes en una columna | Modelo orquestador (crear worktrees) fuera del alcance; TUI tmux de Squad sin raton |
| Claude Terminal (Sterll) | Colores y emoji por PROYECTO (no por sesion); spinner en tab mientras corre; "Control Tower" resalta sesiones terminadas hasta que las miras; nombre custom bloquea el auto-nombre; Ctrl+P paleta difusa con texto coincidente resaltado; Ctrl+Shift+P selector rapido; Ctrl+Izq/Der cambia terminal, Ctrl+Arriba/Abajo cambia proyecto; arrastrar carpetas anidadas | Pestañas Y sidebar duplicando la misma lista sin rol distinto; sin split real; barra de pestañas con "More" overflow |

## Pestañas vs barra lateral: no redundantes si cumplen roles distintos
- Sidebar (proyectos -> sesiones) = TRIAGE: todas las sesiones, siempre visibles, estado + no leido. Es la unica lista completa.
- Pestañas = solo las sesiones ABIERTAS en el panel actual / split (max ~4-6), para cambiar rapido entre las que estas viendo. Con 9+ sesiones, no listar todo en pestañas. Alternativa: sin pestañas, solo sidebar + split (Warp). Recomendacion: pestañas opcionales, ocultas si hay una sola; el estado se repite en ellas con el MISMO componente de icono.

## Principios concretos (con numeros)

Filas y densidad (1366x768; area util ~1366x(768-40 barra de titulo - 48 de la barra de tareas) ~ 680 px)
1. Fila de sesion compacta 28 px (40 px solo en modo expandido opcional). Cabecera de proyecto 24 px, sticky al hacer scroll. 9 sesiones + 3 proyectos = 9x28 + 3x24 = 324 px: cabe sin scroll con 350 px de margen para el footer.
2. Sidebar 240 px por defecto, redimensionable 200-360, colapsable a rail de 48 px solo con iconos de estado (Ctrl+B). A 1366 px deja >=1000 px al terminal (~120 columnas a 13 px).
3. Fila = [icono estado 16 px] [nombre 13 px, truncado con elipsis] [rama/subtitulo 11 px, opcional] [atajo/contador a la derecha]. Padding horizontal 8 px; gap 8 px. Objetivo de clic >= 28 px de alto (aceptable en escritorio; 24 px minimo).
4. Jerarquia: proyecto (semibold, 12 px mayusculas o 13 px 600) > sesion (regular 13 px) > metadatos (11-12 px, texto atenuado >=4.5:1). Indentar sesiones 12 px, sin lineas guia.
5. Fuente UI: Segoe UI Variable / system-ui 13 px (Windows nativo, sin cargar fuente web); terminal: Cascadia Mono / JetBrains Mono 13-14 px, line-height 1.2-1.3. Numeros tabulares en contadores.

Estado sin depender del color (WCAG 1.4.1, 3:1 minimo para iconos no textuales)
6. Un estado = forma + color + (texto en tooltip/aria-label). Formas: trabajando = anillo con arco giratorio (gris); terminado/no leido = circulo relleno con check (verde); esperando = triangulo/pausa o "?" en circulo (amarillo/ambar); error = octagono o triangulo con "!" (rojo); dormida = luna o "z", outline sin relleno, fila a 60% opacidad. Daltonismo: las formas deben ser distinguibles en escala de grises (probar).
7. Icono 16 px dentro de caja 20 px; trazo 1.5-2 px. Rojo/amarillo/verde con luminancia distinta entre si (no solo matiz). Tambien exponer role="status"/aria-label "Sesion X: esperando".
8. Animacion: solo "trabajando" se anima (giro 1.0-1.2 s lineal infinito). Los demas estaticos; transicion de cambio de estado 150-200 ms ease-out + pulso unico de 600 ms al entrar en "esperando" o "terminado". Respetar prefers-reduced-motion: cambiar a icono estatico con puntos "...". Un spinner en 9 filas = coste CPU: usar CSS transform en compositor, pausar si la ventana no tiene foco.
9. Prioridad de atencion (orden visual y de salto): esperando (amarillo) > error (rojo) > terminado no leido (verde) > trabajando > dormida. Un contador agregado en la barra de titulo/tray: "2 esperando, 1 error".

No leido
10. No leido = punto accent de 8 px a la derecha de la fila + nombre en 600 (negrita) + subtitulo con ultima linea de salida (cmux). Se limpia al ENFOCAR la sesion >= 1 s (no al pasar el raton), como Warp. Atajo "ir al siguiente no leido/pendiente" (estilo cmux Cmd+Shift+U) = Ctrl+Shift+U, y "marcar como no leido".
11. Tray/taskbar: badge numerico en el icono de la barra de tareas de Windows (overlay icon 16 px); notificacion toast solo para esperando/error, y solo si la ventana no tiene foco o la sesion no esta visible.

Color accent por sesion/proyecto sin competir con estado
12. El accent identifica el PROYECTO (franja vertical de 3 px a la izquierda de la cabecera, o chip de 8 px), nunca el icono de estado. Paleta de 8-10 tonos de croma bajo (~L 65%, C 0.08-0.10), sin verde/amarillo/rojo puros (reservados a estado). Desactivar tintes en la fila de sesion; seleccion = fondo neutro +4-6% luz y borde izquierdo 2 px.
13. El icono de estado ocupa siempre la misma posicion (columna izquierda fija 20 px) para escaneo vertical en una sola pasada.

Pestañas, split, drag
14. Pestañas 32 px alto, ancho 120-200 px, cierre al hover; mismo icono de estado 14 px. Max visibles por split: 4 paneles; tamano minimo de panel 60 columnas x 12 filas.
15. Split: Ctrl+Shift+5 / Alt+Shift+(+/-) tipo VS Code/WT; arrastrar fila del sidebar al borde del area terminal muestra zonas de drop de 25% (izq/der/arriba/abajo/centro) con overlay accent 20%. Divisor 4 px de hit area, 1 px visible. Doble clic en divisor = igualar.
16. Drag&drop: reordenar sesiones dentro del proyecto y mover entre proyectos; linea de insercion 2 px accent; umbral de arrastre 4 px; Esc cancela; auto-scroll en bordes (40 px). Alternativa teclado: Alt+Shift+Arriba/Abajo (accesibilidad).
17. Renombrar inline: doble clic o F2, Enter confirma, Esc cancela, seleccionar todo el texto al entrar; nombre manual bloquea auto-nombre (Claude Terminal, Warp).

Atajos, paleta, vacios
18. Paleta de comandos Ctrl+Shift+P (acciones) y selector rapido Ctrl+P / Ctrl+K (sesiones, fuzzy, muestra icono de estado y resalta coincidencias; ordenar por prioridad de atencion, luego recientes). Abre en <100 ms, 560 px de ancho, 8 resultados visibles de 32 px.
19. Atajos descubribles: mostrar el atajo en cada fila de menu y en tooltips (retraso 500 ms); Ctrl+1..9 para las 9 primeras sesiones, mostrando el numero en la fila al mantener Ctrl pulsado (patron de pestañas de navegadores); Ctrl+Tab ciclo MRU. Hoja "?" con lista agrupada.
20. Empty states: sidebar sin proyectos = un solo boton primario "Abrir carpeta de proyecto" + atajo visible; proyecto sin sesiones = fila fantasma "+ Nueva sesion (Ctrl+N)"; sin texto de relleno largo. Sesion dormida: mostrar "Reanudar" (claude --resume) en la fila al hover.

Tema oscuro 10 h/dia
21. Fondos NO negro puro: app #1A1B1E - #1F2024 (L ~12-14%), sidebar 1 paso mas oscuro (#17181B), terminal #1C1D21-#202124, elevaciones por +3-4% de luminosidad, no por sombras. Texto principal #D4D4D8 (no #FFF; ~12:1), secundario #9A9AA3 (>=4.5:1), bordes #2C2D32.
22. Terminal ANSI: texto sobre fondo >= 7:1 (AAA), pero colores ANSI "bright black" (gris) >= 4.5:1 sobre el fondo (el gris por defecto de muchos temas cae a 3:1 y hace ilegible la salida atenuada de Claude Code). Cursor parpadeo off por defecto o 530 ms; seleccion con alpha 30%.
23. Ofrecer tema claro y "alto contraste"; respetar el tema de Windows; escala de UI 90-125% (a 1366x768 con 125% de DPI el espacio util real baja a ~1093x614: probar ese caso, 9 filas x 28 px = 252 px siguen entrando).

## Cosas a EVITAR (resumen)
- Estado solo por color; spinners en todas las filas; badges grandes sobre el terminal; accent de proyecto con tonos de estado.
- Duplicar sidebar y pestañas con la misma informacion y sin criterio de jerarquia.
- Limpiar "no leido" por simple hover o al cambiar de ventana; toasts por cada salida.
- Filas expandidas por defecto; elipsis en el medio que oculte el nombre de la sesion (truncar al final; nombre completo en tooltip).
- Copiar codigo/estructura de Claude Terminal (GPL-3): solo se toman ideas generales.
