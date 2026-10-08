const app = document.querySelector('#app');
const number = new Intl.NumberFormat('es-MX');
const state = {
  data: null,
  selectedFolder: null,
  selectedDocument: null,
  filter: 'all',
  query: '',
  page: 1,
  expandedFolders: new Set(),
  view: 'archive',
  expandedAttributeTypes: new Set(),
  selectedAttribute: null,
  attributeQuery: ''
};

const fieldLabels = {
  tags: 'Etiquetas',
  correspondent: 'Corresponsal',
  documentType: 'Tipo documental',
  storagePath: 'Ruta de almacenamiento',
  status: 'Estado'
};

const attributeDefinitions = [
  { key: 'tags', label: 'Tags', plural: 'tags' },
  { key: 'correspondent', label: 'Correspondents', plural: 'correspondents' },
  { key: 'documentType', label: 'Document types', plural: 'document types' },
  { key: 'storagePath', label: 'Path storages', plural: 'path storages' }
];

const filterDefinitions = [
  { key: 'all', label: 'Todos', count: 'total' },
  { key: 'found', label: 'Encontrados', count: 'found' },
  { key: 'ambiguous', label: 'Agrupados', count: 'grouped' },
  { key: 'missing', label: 'Sin coincidencia', count: 'missing' }
];
const searchIcon = '<svg class="search-icon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m13 13 4 4"/></svg>';
const chevron = '<span class="chev" aria-hidden="true"></span>';
let playIntro = true;

const plural = (count, one, many) => `${number.format(count)} ${count === 1 ? one : many}`;
const safe = (value) => String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
const getDocument = (id) => state.data.documents.find((document) => document.id === id);
const findFolder = (path, folder = state.data.tree) => folder.path === path ? folder : folder.folders.map((child) => findFolder(path, child)).find(Boolean);
const selectedFolder = () => state.selectedFolder ?? state.data.tree;
const pathName = (sourcePath) => sourcePath.split('/').filter(Boolean).at(-1);
const relativePath = (sourcePath) => sourcePath.replace(`${state.data.sourceRoot}/`, '');
const valueLines = (value) => String(value).split(' | ').map((part) => part.trim()).filter(Boolean);
const linedValue = (value) => `<span class="attribute-lines">${valueLines(value).map((part) => `<span>${safe(part)}</span>`).join('')}</span>`;

function servedFileUrl(originalPath, originalRoot, type) {
  const relative = originalPath.slice(`${originalRoot}/`.length);
  return `./files/${type}/${relative.split('/').map(encodeURIComponent).join('/')}`;
}

function pathMarkup(originalPath, type) {
  const originalRoot = type === 'source' ? state.data.sourceRoot : state.data.backupRoot;
  return `<a class="path path-link" href="${safe(servedFileUrl(originalPath, originalRoot, type))}" target="_blank" rel="noopener">${safe(originalPath)}</a>`;
}

function allDocuments(folder) {
  const direct = folder.documents.map(({ id }) => getDocument(id));
  return [...direct, ...folder.folders.flatMap(allDocuments)];
}

function visible(document) {
  const matchesFilter = state.filter === 'all' || (state.filter === 'found' && document.found && !document.ambiguous) || (state.filter === 'missing' && !document.found) || (state.filter === 'ambiguous' && document.ambiguous);
  const haystack = `${document.sourcePath} ${document.matches.map((match) => `${match.title ?? ''} ${match.tags?.join(' ') ?? ''} ${match.correspondent ?? ''} ${match.documentType ?? ''}`).join(' ')}`.toLocaleLowerCase('es');
  return matchesFilter && haystack.includes(state.query.toLocaleLowerCase('es'));
}

function coverageCounts(documents) {
  const missing = documents.filter((document) => !document.found).length;
  const grouped = documents.filter((document) => document.found && document.ambiguous).length;
  return { total: documents.length, found: documents.length - missing - grouped, grouped, missing };
}

const coverageSegments = ({ found, grouped, missing }) => [['found', found], ['grouped', grouped], ['missing', missing]]
  .filter(([, count]) => count > 0)
  .map(([kind, count]) => `<span class="seg seg-${kind}" style="flex-grow:${count}"></span>`)
  .join('');

function attributeGroups(definition) {
  const groups = new Map();
  for (const document of state.data.documents) {
    for (const match of document.matches) {
      const values = Array.isArray(match[definition.key]) ? match[definition.key] : [match[definition.key]];
      for (const value of values.filter(Boolean)) {
        const name = String(value);
        if (!groups.has(name)) groups.set(name, { name, files: new Map() });
        const group = groups.get(name);
        const fileKey = match.path;
        if (!group.files.has(fileKey)) group.files.set(fileKey, { path: match.path, title: match.title, references: 0 });
        group.files.get(fileKey).references += 1;
      }
    }
  }
  return [...groups.values()].sort((left, right) => left.name.localeCompare(right.name, 'es'));
}

function paperlessFileTotal() {
  return new Set(state.data.documents.flatMap((document) => document.matches.map((match) => match.path))).size;
}

function attributeFilesMarkup(group) {
  const files = [...group.files.values()].sort((left, right) => left.path.localeCompare(right.path, 'es'));
  return `<div class="attribute-files"><div class="attribute-files-heading"><span>Archivos de ${safe(state.data.display.backupLabel)}</span><strong>${number.format(files.length)}</strong></div>${files.map((file) => `<article class="attribute-file"><strong>${safe(file.title || pathName(file.path))}</strong><small class="path">${pathMarkup(file.path, 'backup')}</small>${file.references > 1 ? `<span>${number.format(file.references)} referencias</span>` : ''}</article>`).join('')}</div>`;
}

function matchesAttributeQuery(group) {
  const query = state.attributeQuery.trim().toLocaleLowerCase('es');
  if (!query) return true;
  return group.name.toLocaleLowerCase('es').includes(query);
}

function attributesView() {
  const groupsByType = new Map(attributeDefinitions.map((definition) => [definition.key, attributeGroups(definition)]));
  return `<section class="attributes-panel"><div class="attributes-heading"><h1>Atributos y archivos</h1><p>${plural(paperlessFileTotal(), 'archivo relacionado', 'archivos relacionados')}. Elige un valor para ver todos los archivos que lo usan.</p><label class="search attributes-search">${searchIcon}<input id="attribute-search" type="search" aria-label="Buscar atributo" placeholder="Buscar nombre de atributo" value="${safe(state.attributeQuery)}" /></label></div><div class="attribute-groups">${attributeDefinitions.map((definition) => {
    const allGroups = groupsByType.get(definition.key);
    const groups = allGroups.filter(matchesAttributeQuery);
    const isExpanded = state.expandedAttributeTypes.has(definition.key);
    const count = state.attributeQuery.trim() ? `${number.format(groups.length)} de ${number.format(allGroups.length)}` : number.format(allGroups.length);
    return `<section class="attribute-group ${isExpanded ? 'expanded' : ''}"><button class="attribute-group-toggle" data-attribute-group="${definition.key}" aria-expanded="${isExpanded}"><span class="attribute-group-icon" aria-hidden="true">${definition.key === 'tags' ? '#' : definition.key === 'correspondent' ? '@' : definition.key === 'documentType' ? 'T' : '/'}</span><span class="attribute-group-name"><strong>${definition.label}</strong></span><span class="attribute-group-count">${count}</span>${chevron}</button>${isExpanded ? `<div class="attribute-options">${groups.map((group) => {
      const selection = state.selectedAttribute;
      const isSelected = selection?.type === definition.key && selection.value === group.name;
      return `<div class="attribute-option ${isSelected ? 'selected' : ''}"><button data-attribute-type="${definition.key}" data-attribute-value="${safe(group.name)}" aria-expanded="${isSelected}"><span>${linedValue(group.name)}</span><strong>${plural(group.files.size, 'archivo', 'archivos')}</strong>${chevron}</button>${isSelected ? attributeFilesMarkup(group) : ''}</div>`;
    }).join('') || `<p class="empty-state">${state.attributeQuery.trim() ? 'No hay atributos que coincidan con la búsqueda.' : 'No hay atributos registrados.'}</p>`}</div>` : ''}</section>`;
  }).join('')}</div></section>`;
}

const statusKind = (document) => !document.found ? 'missing' : document.ambiguous ? 'ambiguous' : 'found';

function statusChip(document) {
  const kind = statusKind(document);
  const label = { missing: 'Sin coincidencia', ambiguous: 'Coincidencia agrupada', found: 'Encontrado' }[kind];
  return `<span class="status ${kind}">${label}</span>`;
}

function folderMarkup(folder) {
  const isSelected = selectedFolder().path === folder.path;
  const isExpanded = state.expandedFolders.has(folder.path);
  const hasChildren = folder.folders.length > 0;
  const childFolders = isExpanded ? folder.folders.map(folderMarkup).join('') : '';
  const { documents, found, ambiguous } = folder.stats;
  const cover = coverageSegments({ found: found - ambiguous, grouped: ambiguous, missing: documents - found });
  const expander = hasChildren ? '<span class="chev tree-chevron" aria-hidden="true"></span>' : '<span></span>';
  const content = `${expander}<span class="tree-name">${safe(folder.name)}</span><span class="mini-cover" aria-hidden="true">${cover}</span><span class="tree-count">${number.format(documents)}</span>`;
  const className = `tree-folder ${isSelected ? 'selected' : ''} ${isExpanded ? 'expanded' : ''}`;
  const attributes = `${hasChildren ? ` aria-expanded="${isExpanded}"` : ''}${isSelected ? ' aria-current="true"' : ''}`;
  return `<div class="tree-node"><button class="${className}" data-folder="${safe(folder.path)}"${attributes}>${content}</button>${childFolders ? `<div class="tree-children">${childFolders}</div>` : ''}</div>`;
}

function detailsMarkup(match) {
  const fields = Object.entries(fieldLabels).map(([key, label]) => {
    if (!match[key]) return '';
    if (key === 'tags') return `<div class="metadata-row"><dt>${label}</dt><dd class="tag-list">${match.tags.map((tag) => `<span>${safe(tag)}</span>`).join('')}</dd></div>`;
    return `<div class="metadata-row"><dt>${label}</dt><dd>${linedValue(match[key])}</dd></div>`;
  }).join('');
  return fields ? `<dl class="metadata">${fields}</dl>` : '<p class="empty-field">El informe no registra atributos para este archivo.</p>';
}

function documentDetail(document) {
  const matches = document.matches.length ? document.matches.map((match, index) => `
    <article class="match-card">
      <div class="match-heading">${document.matches.length > 1 ? `<span class="match-index">Candidato ${index + 1} de ${document.matches.length}</span>` : ''}<strong>${safe(pathName(match.path))}</strong></div>
      ${pathMarkup(match.path, 'backup')}
      ${detailsMarkup(match)}
    </article>`).join('') : `<div class="empty-state"><strong>No hay una coincidencia en el repositorio de referencia.</strong><span>Este PDF forma parte de los ${number.format(state.data.summary.missing)} documentos sin equivalencia.</span></div>`;
  return `<section class="detail-panel">
    <button class="back-button" data-back-to-folder>← Volver a ${safe(selectedFolder().name)}</button>
    <div class="detail-title"><div><h2>${safe(pathName(document.sourcePath))}</h2>${pathMarkup(document.sourcePath, 'source')}</div>${statusChip(document)}</div>
    ${document.ambiguous ? `<p class="notice">Esta relación se registró como <strong>${safe(document.relation)}</strong>. Se muestran todos los candidatos para evitar una asignación arbitraria.</p>` : ''}
    ${document.matches.length ? `<h3 class="section-title">${document.matches.length > 1 ? 'Coincidencias' : 'Coincidencia'} en ${safe(state.data.display.backupLabel)}</h3>` : ''}
    <div class="match-grid">${matches}</div>
  </section>`;
}

function documentRow(document) {
  const directory = relativePath(document.sourcePath).split('/').slice(0, -1).join('/');
  const candidates = document.matches.length > 1 ? `<small>${plural(document.matches.length, 'candidato', 'candidatos')}</small>` : '';
  const content = `<span class="document-copy"><strong>${safe(pathName(document.sourcePath))}</strong>${directory ? `<small>${safe(directory)}</small>` : ''}</span><span class="document-status">${statusChip(document)}${candidates}</span>`;
  const className = `document-row is-${statusKind(document)}`;
  if (!document.matches.length) return `<div class="${className} document-row-static">${content}</div>`;
  return `<button class="${className}" data-document="${document.id}">${content}${chevron}</button>`;
}

function coverageMarkup(counts) {
  const summary = counts.total
    ? `<strong>${number.format(counts.found + counts.grouped)} de ${number.format(counts.total)}</strong> PDFs tienen coincidencia.`
    : 'Esta carpeta no contiene PDFs.';
  const filters = filterDefinitions.map(({ key, label, count }) => `<button class="filter filter-${key} ${state.filter === key ? 'active' : ''}" data-filter="${key}" aria-pressed="${state.filter === key}">${key === 'all' ? '' : '<span class="swatch" aria-hidden="true"></span>'}${label}<b>${number.format(counts[count])}</b></button>`).join('');
  return `<div class="coverage" data-active="${state.filter}"><p class="coverage-summary">${summary}</p><div class="coverage-bar${playIntro ? ' is-intro' : ''}" aria-hidden="true">${coverageSegments(counts)}</div><div class="filters" role="group" aria-label="Filtrar por estado">${filters}</div></div>`;
}

function documentList(folder) {
  const folderDocuments = allDocuments(folder);
  const counts = coverageCounts(folderDocuments);
  const documents = folderDocuments.filter(visible).sort((left, right) => left.sourcePath.localeCompare(right.sourcePath, 'es'));
  const pageSize = 80;
  const pages = Math.max(1, Math.ceil(documents.length / pageSize));
  state.page = Math.min(state.page, pages);
  const pageDocuments = documents.slice((state.page - 1) * pageSize, state.page * pageSize);
  const breadcrumb = folder.path.replace(state.data.sourceRoot, state.data.display.sourceLabel);
  return `<section class="content-panel">
    <div class="folder-heading"><h2>${safe(folder.name)}</h2>${breadcrumb === folder.name ? '' : `<p class="folder-path">${safe(breadcrumb)}</p>`}</div>
    ${coverageMarkup(counts)}
    <div class="results-bar"><strong>${documents.length === counts.total ? plural(documents.length, 'documento', 'documentos') : `${number.format(documents.length)} de ${plural(counts.total, 'documento', 'documentos')}`}</strong><span>Selecciona un PDF para ver sus coincidencias y metadatos.</span></div>
    <div class="document-list">${pageDocuments.map(documentRow).join('') || '<div class="empty-state">No hay documentos que coincidan con la búsqueda o los filtros.</div>'}</div>
    ${pages > 1 ? `<nav class="pagination"><button data-page="${state.page - 1}" ${state.page === 1 ? 'disabled' : ''}>Anterior</button><span>Página ${state.page} de ${pages}</span><button data-page="${state.page + 1}" ${state.page === pages ? 'disabled' : ''}>Siguiente</button></nav>` : ''}
  </section>`;
}

// Cada render reconstruye el DOM: recordamos qué control tenía el foco para devolvérselo.
const focusKeys = ['view', 'filter', 'folder', 'document', 'page', 'attributeGroup', 'attributeType', 'backToFolder'];

function focusedControl() {
  const active = document.activeElement;
  const key = active && focusKeys.find((name) => name in active.dataset);
  return key ? { key, value: active.dataset[key], attributeValue: active.dataset.attributeValue } : null;
}

function restoreFocus(control) {
  if (!control) return;
  const attribute = control.key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
  const target = [...document.querySelectorAll(`[data-${attribute}]`)].find((element) => element.dataset[control.key] === control.value && element.dataset.attributeValue === control.attributeValue);
  target?.focus({ preventScroll: true });
}

function render() {
  const { tree } = state.data;
  const focused = focusedControl();
  const archiveView = `<main class="archive">
    <section class="workspace"><aside class="sidebar"><label class="search sidebar-search">${searchIcon}<input id="search" type="search" aria-label="Buscar documentos" placeholder="Buscar por nombre, etiqueta o corresponsal" value="${safe(state.query)}" /></label><nav class="tree" aria-label="Carpetas">${folderMarkup(tree)}</nav></aside><div class="main-view">${state.selectedDocument ? documentDetail(state.selectedDocument) : documentList(selectedFolder())}</div></section>
  </main>`;
  const tab = (view, label) => `<button class="app-tab ${state.view === view ? 'active' : ''}" data-view="${view}"${state.view === view ? ' aria-current="page"' : ''}>${label}</button>`;
  app.innerHTML = `<header class="app-header"><div class="app-brand"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span><div><strong>${safe(state.data.display.appTitle)}</strong><small>Inventario documental</small></div></div><nav class="app-tabs" aria-label="Vistas del dashboard">${tab('archive', 'Documentos')}${tab('attributes', 'Atributos')}</nav></header>${state.view === 'attributes' ? `<main class="attributes">${attributesView()}</main>` : archiveView}<footer>Informe: ${safe(state.data.generatedFrom)}</footer>`;
  bindEvents();
  restoreFocus(focused);
  playIntro = false;
}

function refocusSearch(position) {
  const search = document.querySelector('#search');
  search?.focus();
  search?.setSelectionRange(position, position);
}

function refocusAttributeSearch(position) {
  const search = document.querySelector('#attribute-search');
  search?.focus();
  search?.setSelectionRange(position, position);
}

function bindEvents() {
  document.querySelector('#search')?.addEventListener('input', (event) => {
    const position = event.target.selectionStart ?? event.target.value.length;
    state.query = event.target.value;
    state.page = 1;
    render();
    refocusSearch(position);
  });
  document.querySelector('#attribute-search')?.addEventListener('input', (event) => {
    const position = event.target.selectionStart ?? event.target.value.length;
    state.attributeQuery = event.target.value;
    render();
    refocusAttributeSearch(position);
  });
  document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => { state.view = button.dataset.view; render(); }));
  document.querySelectorAll('[data-attribute-group]').forEach((button) => button.addEventListener('click', () => {
    const type = button.dataset.attributeGroup;
    if (state.selectedAttribute?.type && state.selectedAttribute.type !== type) state.selectedAttribute = null;
    if (state.expandedAttributeTypes.has(type)) {
      state.expandedAttributeTypes.delete(type);
      if (state.selectedAttribute?.type === type) state.selectedAttribute = null;
    } else state.expandedAttributeTypes.add(type);
    render();
  }));
  document.querySelectorAll('[data-attribute-type]').forEach((button) => button.addEventListener('click', () => {
    const selection = { type: button.dataset.attributeType, value: button.dataset.attributeValue };
    state.selectedAttribute = state.selectedAttribute?.type === selection.type && state.selectedAttribute.value === selection.value ? null : selection;
    render();
  }));
  document.querySelectorAll('[data-filter]').forEach((button) => button.addEventListener('click', () => { state.filter = button.dataset.filter; state.page = 1; render(); }));
  document.querySelectorAll('[data-folder]').forEach((button) => button.addEventListener('click', () => {
    const folder = findFolder(button.dataset.folder);
    if (folder.folders.length && state.expandedFolders.has(folder.path)) state.expandedFolders.delete(folder.path);
    else if (folder.folders.length) state.expandedFolders.add(folder.path);
    state.selectedFolder = folder;
    state.selectedDocument = null;
    state.page = 1;
    render();
  }));
  document.querySelectorAll('[data-document]').forEach((button) => button.addEventListener('click', () => { state.selectedDocument = getDocument(button.dataset.document); render(); }));
  document.querySelectorAll('[data-page]').forEach((button) => button.addEventListener('click', () => { state.page = Number(button.dataset.page); render(); }));
  document.querySelector('[data-back-to-folder]')?.addEventListener('click', () => { state.selectedDocument = null; render(); });
}

fetch('./api/inventory').then((response) => {
  if (!response.ok) throw new Error('No se pudo cargar el inventario.');
  return response.json();
}).then((data) => {
  state.data = data;
  state.expandedFolders.add(data.tree.path);
  render();
}).catch((error) => { app.innerHTML = `<main class="load-error"><h1>No se pudo cargar el dashboard</h1><p>${safe(error.message)}</p><p>Comprueba el informe montado y reinicia el contenedor.</p></main>`; });
