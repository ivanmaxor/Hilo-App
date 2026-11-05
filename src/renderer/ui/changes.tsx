import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { MAX_DIFF_BYTES, parseUnifiedDiff, rowsFromNewFile, type ChangesList, type DiffRow, type FileChange, type FileChangeKind, type FileDiffResult, type ParsedDiff } from '../../shared/diff';
import type { ProjectRecord } from '../../shared/types';
import { api } from '../api';
import { app, dispatch, openInIde, statusOf, useStore, view } from '../controller';
import { ChevronUpDown, ExternalIcon, GearIcon, RefreshIcon } from './icons';

/** Lo que se pinta de más arriba y abajo de lo visible, para que desplazar no deje huecos. */
const OVERSCAN = 40;
/** Una línea minificada de millones de caracteres congelaría el dibujo. */
const MAX_LINE_CHARS = 2000;
/** Volver a la ventana varias veces seguidas no repite el trabajo. */
const MIN_AUTO_REFRESH_MS = 1000;

const KIND_LABEL: Record<FileChangeKind, { tag: string; text: string }> = {
  modified: { tag: 'M', text: 'Modificado' },
  added: { tag: 'N', text: 'Nuevo' },
  untracked: { tag: 'N', text: 'Nuevo, sin agregar a git' },
  deleted: { tag: 'B', text: 'Borrado' },
  renamed: { tag: 'R', text: 'Renombrado' },
  conflict: { tag: 'C', text: 'Con conflicto' },
};

function megas(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Las filas que hay que dibujar, según el desplazamiento. Es lo que evita que un archivo enorme congele la interfaz. */
function useRowWindow(scroller: { current: HTMLElement | null }, rowHeight: number, count: number) {
  const [range, setRange] = useState({ start: 0, end: 120 });
  const sync = () => {
    const el = scroller.current;
    if (!el) return;
    const first = Math.floor(el.scrollTop / rowHeight);
    const visible = Math.ceil(el.clientHeight / rowHeight);
    // Se redondea para no repintar en cada píxel.
    const start = Math.max(0, Math.floor((first - OVERSCAN) / 20) * 20);
    const end = Math.min(count, Math.ceil((first + visible + OVERSCAN) / 20) * 20);
    setRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  };
  useLayoutEffect(() => {
    sync();
    const el = scroller.current;
    if (!el) return;
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    return () => observer.disconnect();
  }, [rowHeight, count]);
  return { range, sync };
}

function RowNumber({ line, jump, onOpen, ideLabel, side }: { line: number | null; jump: number | null; onOpen: ((line: number) => void) | null; ideLabel: string; side: 'old' | 'new' }) {
  if (line === null) return <span class="dr-num" role="cell" />;
  const attrs = side === 'new' ? { 'data-new-line': line } : { 'data-old-line': line };
  if (!onOpen || jump === null) {
    return (
      <span class="dr-num" role="cell" {...attrs}>
        {line}
      </span>
    );
  }
  const label = side === 'new' ? `Abrir la línea ${line} en ${ideLabel}` : `Esta línea estaba en la ${line}. Abrir donde estaba, en la línea ${jump} de ${ideLabel}`;
  return (
    <span class="dr-num" role="cell">
      <button class="dr-link" title={label} aria-label={label} {...attrs} onClick={() => onOpen(jump)}>
        {line}
      </button>
    </span>
  );
}

function Row({ row, index, showSigns, height, onOpen, ideLabel }: { row: DiffRow; index: number; showSigns: boolean; height: number; onOpen: ((line: number) => void) | null; ideLabel: string }) {
  if (row.kind === 'gap') {
    return (
      <div class="dr gap" role="row" aria-rowindex={index + 1} style={{ height: `${height}px` }}>
        <span class="dr-gap" role="cell">
          {plural(row.hidden ?? 0, 'línea sin cambios', 'líneas sin cambios')}
        </span>
      </div>
    );
  }
  if (row.kind === 'note') {
    return (
      <div class="dr note" role="row" aria-rowindex={index + 1} style={{ height: `${height}px` }}>
        <span class="dr-gap" role="cell">
          {row.text}
        </span>
      </div>
    );
  }
  const cut = row.text.length > MAX_LINE_CHARS;
  const what = row.kind === 'add' ? 'Línea nueva. ' : row.kind === 'del' ? 'Línea quitada. ' : '';
  return (
    <div class={`dr ${row.kind}`} role="row" aria-rowindex={index + 1} data-kind={row.kind} style={{ height: `${height}px` }}>
      <span class="dr-nums" role="none">
        <RowNumber line={row.oldLine} jump={row.jump} onOpen={row.kind === 'del' ? onOpen : null} ideLabel={ideLabel} side="old" />
        <RowNumber line={row.newLine} jump={row.jump} onOpen={onOpen} ideLabel={ideLabel} side="new" />
      </span>
      {showSigns && (
        <span class="dr-sign" aria-hidden="true">
          {row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : ''}
        </span>
      )}
      <span class="dr-code" role="cell">
        {what && <span class="sr-only">{what}</span>}
        {cut ? row.text.slice(0, MAX_LINE_CHARS) : row.text}
        {cut && <span class="dr-cut"> … línea cortada</span>}
      </span>
    </div>
  );
}

/** Un poco más chica que la terminal, y sigue a Ctrl+= y Ctrl+-. */
const codeSize = (fontSize: number) => Math.max(10, fontSize - 3);
const rowHeightFor = (fontSize: number) => Math.round(codeSize(fontSize) * 1.5);

/** Saltar entre zonas cambiadas: en la cabecera, para no tapar el código de las líneas largas. */
function ZoneJump({ parsed, scroller, rowHeight }: { parsed: ParsedDiff; scroller: { current: HTMLElement | null }; rowHeight: number }) {
  const go = (delta: 1 | -1) => {
    const el = scroller.current;
    if (!el) return;
    // Con unas filas de aire arriba, para ver lo que había antes del cambio.
    const margin = 3;
    const here = Math.round(el.scrollTop / rowHeight) + margin;
    const list = parsed.changes;
    const next = delta > 0 ? list.find((c) => c > here) : [...list].reverse().find((c) => c < here);
    if (next !== undefined) el.scrollTop = Math.max(0, (next - margin) * rowHeight);
  };
  return (
    <div class="diff-jump">
      <span class="diff-jump-count">{plural(parsed.changes.length, 'zona', 'zonas')}</span>
      <button class="icon-btn" title="Zona anterior" aria-label="Zona cambiada anterior" onClick={() => go(-1)}>
        <ChevronUpDown up />
      </button>
      <button class="icon-btn" title="Zona siguiente" aria-label="Zona cambiada siguiente" onClick={() => go(1)}>
        <ChevronUpDown />
      </button>
    </div>
  );
}

function DiffView({ parsed, resetKey, showSigns, fontSize, onOpen, ideLabel, scroller }: { parsed: ParsedDiff; resetKey: string; showSigns: boolean; fontSize: number; onOpen: ((line: number) => void) | null; ideLabel: string; scroller: { current: HTMLDivElement | null } }) {
  const size = codeSize(fontSize);
  const rowHeight = rowHeightFor(fontSize);
  const { range, sync } = useRowWindow(scroller, rowHeight, parsed.rows.length);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTop = 0;
    el.scrollLeft = 0;
    sync();
  }, [resetKey]);
  const digits = Math.max(3, String(parsed.maxLine).length);
  const longest = Math.min(parsed.longest, MAX_LINE_CHARS + 20);
  const visible = parsed.rows.slice(range.start, range.end);
  return (
    <div class="diff-wrap">
      <div
        ref={scroller}
        class="diff-scroll"
        tabIndex={0}
        role="table"
        aria-label="Líneas del archivo"
        aria-rowcount={parsed.rows.length}
        style={{ fontSize: `${size}px`, '--diff-digits': String(digits) }}
        onScroll={sync}
      >
        <div class="diff-inner" style={{ height: `${parsed.rows.length * rowHeight}px`, minWidth: `max(100%, calc(${digits * 2 + longest + 8}ch + 40px))` }}>
          <div class="diff-window" style={{ transform: `translateY(${range.start * rowHeight}px)` }}>
            {visible.map((row, i) => (
              <Row key={range.start + i} row={row} index={range.start + i} showSigns={showSigns} height={rowHeight} onOpen={onOpen} ideLabel={ideLabel} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function StateScreen({ title, text, onRefresh, busy, children }: { title: string; text: string; onRefresh?: () => void; busy?: boolean; children?: preact.ComponentChildren }) {
  return (
    <div class="changes-state" data-state={title}>
      <p class="changes-state-title">{title}</p>
      <p class="changes-state-text">{text}</p>
      <div class="overlay-actions">
        {children}
        {onRefresh && (
          <button class="secondary" disabled={busy} onClick={onRefresh}>
            Actualizar
          </button>
        )}
      </div>
    </div>
  );
}

function listProblem(list: ChangesList, project: ProjectRecord): { title: string; text: string } | null {
  switch (list.status) {
    case 'ok':
      return null;
    case 'not-repo':
      return {
        title: 'Esta carpeta no usa Git',
        text: `Hilo compara cada archivo con la última versión guardada en Git, y «${project.name}» no es un repositorio. Para ver cambios aquí, abre una terminal en la carpeta y ejecuta «git init», agrega los archivos y haz un primer commit. Hilo solo mira: nunca modifica el repositorio.`,
      };
    case 'no-git':
      return { title: 'Git no está instalado', text: 'Para mostrar los cambios, Hilo necesita Git. Instálalo desde git-scm.com y pulsa Actualizar.' };
    case 'no-folder':
      return { title: 'La carpeta ya no está', text: `No se encuentra ${project.path}. Puede que se haya movido o que sea una unidad desconectada.` };
    case 'untrusted':
      return {
        title: 'Git no confía en esta carpeta',
        text: 'La carpeta pertenece a otro usuario de Windows y Git se niega a leerla, para protegerte de lo que pudiera traer. Si es tuya, puedes autorizarla con «git config --global --add safe.directory» y la ruta. Hilo no toca esa configuración.',
      };
    case 'unsafe-config':
      return { title: 'Configuración de Git sospechosa', text: 'Este repositorio define filtros con nombres que no se pueden anular de forma segura, así que Hilo prefiere no leerlo. Revisa el archivo .git/config.' };
    case 'no-project':
      return { title: 'El proyecto ya no está', text: 'Puedes quitar este panel.' };
    case 'error':
      return { title: 'No se pudo leer el estado de Git', text: list.message };
  }
}

function FileRow({ file, selected, showSigns, onPick }: { file: FileChange; selected: boolean; showSigns: boolean; onPick(): void }) {
  const slash = file.path.lastIndexOf('/');
  const name = file.path.slice(slash + 1);
  const dir = slash >= 0 ? file.path.slice(0, slash) : '';
  const label = KIND_LABEL[file.kind];
  const counts =
    file.added === null && file.removed === null
      ? file.binary
        ? 'Binario'
        : 'Sin contar'
      : `${plural(file.added ?? 0, 'línea nueva', 'líneas nuevas')}, ${plural(file.removed ?? 0, 'quitada', 'quitadas')}`;
  const hover = `${file.oldPath ? `${file.oldPath}\n→ ` : ''}${file.path}\n${label.text}. ${counts}`;
  return (
    <button class={`cf-row${selected ? ' on' : ''}`} data-file={file.path} data-kind={file.kind} aria-current={selected ? 'true' : undefined} title={hover} aria-label={`${file.path}. ${label.text}. ${counts}`} onClick={onPick}>
      <span class={`cf-tag ${file.kind}`} aria-hidden="true">
        {label.tag}
      </span>
      <span class="cf-names">
        <span class={`cf-name${file.kind === 'deleted' ? ' gone' : ''}`}>{name}</span>
        {dir && <span class="cf-dir">{dir}</span>}
      </span>
      {file.binary ? (
        <span class="cf-count" aria-hidden="true">
          binario
        </span>
      ) : (
        <span class="cf-count" aria-hidden="true">
          {!!file.added && (
            <span class="cf-add" data-added={file.added}>
              {showSigns ? '+' : ''}
              {file.added}
            </span>
          )}
          {!!file.removed && (
            <span class="cf-del" data-removed={file.removed}>
              {showSigns ? '−' : ''}
              {file.removed}
            </span>
          )}
        </span>
      )}
    </button>
  );
}

function DiffBody({ file, result, parsed, scroller, full, project, onShowHunks, showSigns, fontSize }: { file: FileChange; result: FileDiffResult | null; parsed: ParsedDiff | null; scroller: { current: HTMLDivElement | null }; full: boolean; project: ProjectRecord; onShowHunks(): void; showSigns: boolean; fontSize: number }) {
  const open = () => void openInIde(project.id, file.path);
  const openButton = file.kind !== 'deleted' && (
    <button class="secondary" onClick={open}>
      Abrir el archivo
    </button>
  );
  if (!result) return <div class="changes-state" aria-busy="true" />;
  if (parsed?.binary || result.status === 'binary') {
    return <StateScreen title="Archivo binario" text="Es una imagen, un compilado u otro archivo que no es texto: no se puede comparar línea por línea.">{openButton}</StateScreen>;
  }
  if (result.status === 'too-large') {
    const size = result.bytes ? ` (${megas(result.bytes)})` : '';
    return (
      <StateScreen title="Archivo demasiado grande" text={`${full ? 'Todo el archivo' : 'Lo que cambió'}${size} pasa de ${megas(MAX_DIFF_BYTES)}, el máximo que se muestra para no congelar la ventana. Ábrelo en tu IDE para verlo.`}>
        {full && (
          <button class="secondary" onClick={onShowHunks}>
            Ver solo lo cambiado
          </button>
        )}
        {openButton}
      </StateScreen>
    );
  }
  if (result.status === 'symlink') return <StateScreen title="Enlace simbólico" text="Es un acceso a otra ruta: Hilo no lo sigue." />;
  if (result.status === 'folder') return <StateScreen title="Carpeta nueva" text="Es una carpeta con su propio repositorio de Git dentro. Sus cambios no se muestran aquí." />;
  if (result.status === 'missing') return <StateScreen title="El archivo ya no está" text="Se borró o se movió después de la última actualización." />;
  if (result.status === 'rejected') return <StateScreen title="Ruta no permitida" text="Esta ruta sale de la carpeta del proyecto, por ejemplo por un enlace. Hilo no la abre." />;
  if (result.status === 'no-git') return <StateScreen title="Git no está instalado" text="Para mostrar los cambios, Hilo necesita Git." />;
  if (result.status === 'unsafe-config') return <StateScreen title="Configuración de Git sospechosa" text="Este repositorio define filtros que no se pueden anular de forma segura." />;
  if (result.status === 'error') return <StateScreen title="No se pudo comparar" text={result.message} />;
  if (!parsed) return null;
  if (parsed.rows.length === 0) {
    return (
      <StateScreen
        title={result.status === 'new' ? 'Archivo vacío' : 'Sin cambios en el contenido'}
        text={result.status === 'new' ? 'Es un archivo nuevo sin ninguna línea.' : 'Puede que solo haya cambiado el nombre o los permisos, o que el archivo esté vacío.'}
      >
        {openButton}
      </StateScreen>
    );
  }
  const ideName = project.ide?.name ?? 'el IDE';
  const onOpen = file.kind === 'deleted' ? null : (line: number) => void openInIde(project.id, file.path, line);
  return <DiffView parsed={parsed} resetKey={`${file.path}|${full}`} showSigns={showSigns} fontSize={fontSize} onOpen={onOpen} ideLabel={ideName} scroller={scroller} />;
}

export function ChangesPanel({ project }: { project: ProjectRecord }) {
  const { state } = useStore(app);
  const { changesShowSigns: showSigns, changesFullFile: full, fontSize } = state.settings;
  const [list, setList] = useState<ChangesList | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [result, setResult] = useState<{ key: string; value: FileDiffResult } | null>(null);
  const [version, setVersion] = useState(0);
  const listSeq = useRef(0);
  const diffSeq = useRef(0);
  const scroller = useRef<HTMLDivElement>(null);
  const lastRefresh = useRef(0);
  const live = useRef(true);
  const projectId = project.id;

  const refresh = async () => {
    const mine = ++listSeq.current;
    lastRefresh.current = Date.now();
    setBusy(true);
    let next: ChangesList;
    try {
      next = await api.changesList(projectId);
    } catch (err) {
      next = { status: 'error', message: err instanceof Error ? err.message : String(err) };
    }
    if (!live.current || mine !== listSeq.current) return;
    setList(next);
    setBusy(false);
    setVersion((v) => v + 1);
  };
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  // Se actualiza al mostrarse, al volver a la ventana y al terminar una sesión del proyecto. Sin sondeo ni
  // vigilar archivos: este componente solo existe mientras el panel está a la vista.
  useEffect(() => {
    live.current = true;
    void refreshRef.current();
    let focused = view.get().focused;
    const stopView = view.subscribe(() => {
      const now = view.get().focused;
      if (now && !focused && Date.now() - lastRefresh.current > MIN_AUTO_REFRESH_MS) void refreshRef.current();
      focused = now;
    });
    const sessionsOf = () => app.get().state.projects.find((p) => p.id === projectId)?.sessions ?? [];
    let previous = new Map(sessionsOf().map((s) => [s.id, statusOf(s.id)]));
    let pending: ReturnType<typeof setTimeout> | null = null;
    const stopApp = app.subscribe(() => {
      const current = new Map(sessionsOf().map((s) => [s.id, statusOf(s.id)]));
      let finished = false;
      for (const [id, status] of current) if (previous.get(id) === 'working' && status !== 'working') finished = true;
      previous = current;
      if (finished && !pending) {
        pending = setTimeout(() => {
          pending = null;
          void refreshRef.current();
        }, 400);
      }
    });
    return () => {
      live.current = false;
      stopView();
      stopApp();
      if (pending) clearTimeout(pending);
    };
  }, [projectId]);

  const files = list?.status === 'ok' ? list.files : [];
  const file = files.find((f) => f.path === selected) ?? files[0] ?? null;
  const diffKey = file ? `${file.path}|${file.kind}|${full}` : '';

  useEffect(() => {
    const mine = ++diffSeq.current;
    if (!file) {
      setResult(null);
      return;
    }
    const request = { path: file.path, untracked: file.kind === 'untracked', full, ...(file.oldPath ? { oldPath: file.oldPath } : {}) };
    void api.changesDiff(projectId, request).then(
      (value) => {
        if (mine !== diffSeq.current) return;
        // Si nada cambió se conserva lo dibujado, y con eso el desplazamiento.
        setResult((prev) => (prev?.key === diffKey && JSON.stringify(prev.value) === JSON.stringify(value) ? prev : { key: diffKey, value }));
      },
      (err: unknown) => {
        if (mine === diffSeq.current) setResult({ key: diffKey, value: { status: 'error', message: err instanceof Error ? err.message : String(err) } });
      },
    );
  }, [diffKey, version]);

  const totals = useMemo(() => {
    let added = 0;
    let removed = 0;
    for (const f of files) {
      added += f.added ?? 0;
      removed += f.removed ?? 0;
    }
    return { added, removed };
  }, [files]);

  const fileRows = useMemo(
    () => files.map((f) => <FileRow key={f.path} file={f} selected={f.path === file?.path} showSigns={showSigns} onPick={() => setSelected(f.path)} />),
    [files, file?.path, showSigns],
  );

  const moveInList = (e: KeyboardEvent) => {
    if ((e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || !file) return;
    e.preventDefault();
    const at = files.indexOf(file);
    const next = files[at + (e.key === 'ArrowDown' ? 1 : -1)];
    if (!next) return;
    setSelected(next.path);
    requestAnimationFrame(() => {
      const row = (e.target as HTMLElement).closest('.cf-list')?.querySelector<HTMLElement>('.cf-row.on');
      row?.focus();
      row?.scrollIntoView({ block: 'nearest' });
    });
  };

  const problem = list ? listProblem(list, project) : null;
  const ide = project.ide;
  const shownResult = result && result.key === diffKey ? result.value : null;
  const parsed = useMemo<ParsedDiff | null>(() => {
    if (shownResult?.status === 'patch') return parseUnifiedDiff(shownResult.text);
    if (shownResult?.status === 'new') return rowsFromNewFile(shownResult.text);
    return null;
  }, [shownResult]);

  return (
    <div class="changes" tabIndex={-1} data-busy={busy ? 'true' : 'false'} data-status={list?.status ?? 'loading'}>
      <div class="changes-bar">
        <span class="changes-summary" role="status">
          {list?.status === 'ok' && files.length > 0 && (
            <>
              {plural(list.total, 'archivo', 'archivos')}
              <span class="changes-sep"> · </span>
              <span class="cf-add">{plural(totals.added, 'nueva', 'nuevas')}</span>
              <span class="changes-sep"> · </span>
              <span class="cf-del">{plural(totals.removed, 'quitada', 'quitadas')}</span>
            </>
          )}
          {list?.status === 'ok' && list.noCommits && files.length > 0 && <span class="changes-note"> · sin ningún commit todavía</span>}
          {list?.status === 'ok' && list.total > files.length && <span class="changes-note"> · se muestran {files.length}</span>}
        </span>
        <button class="icon-btn changes-refresh" title="Actualizar" aria-label="Actualizar" disabled={busy} onClick={() => void refresh()}>
          <RefreshIcon spin={busy} />
        </button>
        <button class="secondary changes-ide" data-action="open-ide" title={ide ? `Abrir «${project.name}» en ${ide.name}` : 'Elegir el IDE de este proyecto'} onClick={() => void openInIde(project.id)}>
          <ExternalIcon />
          <span>{ide ? `Abrir en ${ide.name}` : 'Abrir en un IDE'}</span>
        </button>
        {ide && (
          <button class="icon-btn" title="Cambiar el IDE de este proyecto" aria-label="Cambiar el IDE de este proyecto" onClick={() => view.set({ modal: { type: 'ide', projectId: project.id, file: null, line: null } })}>
            <GearIcon />
          </button>
        )}
      </div>
      {!list && <div class="changes-state" aria-busy="true" />}
      {problem && list && <StateScreen title={problem.title} text={problem.text} onRefresh={() => void refresh()} busy={busy} />}
      {list?.status === 'ok' && files.length === 0 && (
        <StateScreen title="Sin cambios" text={list.noCommits ? 'Este repositorio todavía no tiene commits ni archivos.' : list.subfolder ? 'Todo lo que hay en esta carpeta coincide con el último commit.' : 'Todos los archivos coinciden con el último commit.'} onRefresh={() => void refresh()} busy={busy} />
      )}
      {list?.status === 'ok' && file && (
        <div class="changes-main">
          <div class="cf-list" aria-label="Archivos cambiados" onKeyDown={moveInList}>
            {fileRows}
          </div>
          <div class="changes-detail">
            <div class="changes-file">
              <span class="changes-path" title={file.path}>
                {file.oldPath && <span class="changes-oldpath">{file.oldPath} → </span>}
                {file.path}
              </span>
              <span class="changes-kind">{KIND_LABEL[file.kind].text}</span>
              {file.kind !== 'deleted' && (
                <button class="icon-btn changes-open" data-action="open-file" title={`Abrir este archivo en ${ide?.name ?? 'el IDE'}`} aria-label={`Abrir este archivo en ${ide?.name ?? 'el IDE'}`} onClick={() => void openInIde(project.id, file.path)}>
                  <ExternalIcon />
                </button>
              )}
              {parsed && parsed.changes.length > 1 && <ZoneJump parsed={parsed} scroller={scroller} rowHeight={rowHeightFor(fontSize)} />}
              <div class="seg changes-mode" role="radiogroup" aria-label="Qué mostrar">
                <button type="button" role="radio" aria-checked={!full} class={full ? '' : 'on'} onClick={() => void dispatch({ type: 'settings/set', patch: { changesFullFile: false } })}>
                  Lo cambiado
                </button>
                <button type="button" role="radio" aria-checked={full} class={full ? 'on' : ''} data-action="full-file" onClick={() => void dispatch({ type: 'settings/set', patch: { changesFullFile: true } })}>
                  Todo el archivo
                </button>
              </div>
            </div>
            <DiffBody
              file={file}
              result={shownResult}
              parsed={parsed}
              scroller={scroller}
              full={full}
              project={project}
              onShowHunks={() => void dispatch({ type: 'settings/set', patch: { changesFullFile: false } })}
              showSigns={showSigns}
              fontSize={fontSize}
            />
          </div>
        </div>
      )}
    </div>
  );
}
