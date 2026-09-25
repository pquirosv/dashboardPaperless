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
  const matchesFilter = state.filter === 'all' || (state.filter === 'found' && document.found) || (state.filter === 'missing' && !document.found) || (state.filter === 'ambiguous' && document.ambiguous);
  const haystack = `${document.sourcePath} ${document.matches.map((match) => `${match.title ?? ''} ${match.tags?.join(' ') ?? ''} ${match.correspondent ?? ''} ${match.documentType ?? ''}`).join(' ')}`.toLocaleLowerCase('es');
  return matchesFilter && haystack.includes(state.query.toLocaleLowerCase('es'));
}

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
  return `<div class="attribute-files"><div class="attribute-files-heading"><span>Archivos de ${safe(state.data.display.backupLabel)}</span><strong>${number.format(files.length)}</strong></div>${files.map((file) => `<article class="attribute-file"><strong>${safe(file.title || pathName(file.path))}</strong><small class="path">${pathMarkup(file.path, 'backup')}</small>${file.references > 1 ? `<span>${file.references} referencias</span>` : ''}</article>`).join('')}</div>`;
}

function matchesAttributeQuery(group) {
  const query = state.attributeQuery.trim().toLocaleLowerCase('es');
  if (!query) return true;
  return group.name.toLocaleLowerCase('es').includes(query);
}

function attributesView() {
  const groupsByType = new Map(attributeDefinitions.map((definition) => [definition.key, attributeGroups(definition)]));
  return `<section class="attributes-panel"><div class="attributes-heading"><div><span class="eyebrow">Inventario de referencia</span><h1>Atributos y archivos</h1><p>Explora los valores registrados y consulta todos los archivos asociados a cada atributo.</p><label class="search attributes-search"><span>⌕</span><input id="attribute-search" type="search" placeholder="Buscar nombre de atributo" value="${safe(state.attributeQuery)}" /></label></div><span class="attributes-total">${number.format(paperlessFileTotal())} archivos relacionados</span></div><div class="attribute-groups">${attributeDefinitions.map((definition) => {
    const allGroups = groupsByType.get(definition.key);
    const groups = allGroups.filter(matchesAttributeQuery);
    const isExpanded = state.expandedAttributeTypes.has(definition.key);
    const count = state.attributeQuery.trim() ? `${number.format(groups.length)} de ${number.format(allGroups.length)}` : number.format(allGroups.length);
    return `<section class="attribute-group ${isExpanded ? 'expanded' : ''}"><button class="attribute-group-toggle" data-attribute-group="${definition.key}" aria-expanded="${isExpanded}"><span class="attribute-group-icon">${definition.key === 'tags' ? '#' : definition.key === 'correspondent' ? '@' : definition.key === 'documentType' ? 'T' : '/'}</span><span class="attribute-group-name"><strong>${definition.label}</strong><small>${count} ${definition.plural}</small></span><span class="attribute-group-count">${count}</span><span class="attribute-group-arrow">›</span></button>${isExpanded ? `<div class="attribute-options">${groups.map((group) => {
      const selection = state.selectedAttribute;
      const isSelected = selection?.type === definition.key && selection.value === group.name;
      return `<div class="attribute-option ${isSelected ? 'selected' : ''}"><button data-attribute-type="${definition.key}" data-attribute-value="${safe(group.name)}"><span>${linedValue(group.name)}</span><strong>${number.format(group.files.size)} archivos</strong><span class="attribute-option-arrow">›</span></button>${isSelected ? attributeFilesMarkup(group) : ''}</div>`;
    }).join('') || `<p class="empty-state">${state.attributeQuery.trim() ? 'No hay atributos que coincidan con la búsqueda.' : 'No hay atributos registrados.'}</p>`}</div>` : ''}</section>`;
  }).join('')}</div></section>`;
}

function statusChip(document) {
  if (!document.found) return '<span class="status missing">Sin coincidencia</span>';
  if (document.ambiguous) return '<span class="status ambiguous">Coincidencia agrupada</span>';
  return '<span class="status found">Encontrado</span>';
}

function folderMarkup(folder, level = 0) {
  const isSelected = selectedFolder().path === folder.path;
  const isExpanded = state.expandedFolders.has(folder.path);
  const childFolders = isExpanded ? folder.folders.map((child) => folderMarkup(child, level + 1)).join('') : '';
  const content = `<span class="folder-glyph">▣</span><span>${safe(folder.name)}</span><small>${number.format(folder.stats.documents)}</small>`;
  const className = `tree-folder ${isSelected ? 'selected' : ''} ${isExpanded ? 'expanded' : ''}`;
  return `<div class="tree-node"><button class="${className}" data-folder="${safe(folder.path)}" style="--depth:${level}">${content}</button>${childFolders ? `<div class="tree-children">${childFolders}</div>` : ''}</div>`;
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
      <div class="match-heading"><span>${safe(state.data.display.backupLabel)} ${document.matches.length > 1 ? index + 1 : ''}</span><strong>${safe(pathName(match.path))}</strong></div>
      ${pathMarkup(match.path, 'backup')}
      ${detailsMarkup(match)}
    </article>`).join('') : `<div class="empty-state"><strong>No hay una coincidencia en el repositorio de referencia.</strong><span>Este PDF forma parte de los ${number.format(state.data.summary.missing)} documentos sin equivalencia.</span></div>`;
  return `<section class="detail-panel">
    <button class="back-button" data-back-to-folder>← Volver a ${safe(selectedFolder().name)}</button>
    <div class="detail-title"><div><span class="eyebrow">${safe(state.data.display.sourceLabel)}</span><h2>${safe(pathName(document.sourcePath))}</h2>${pathMarkup(document.sourcePath, 'source')}</div>${statusChip(document)}</div>
    ${document.ambiguous ? `<p class="notice">Esta relación se registró como <strong>${safe(document.relation)}</strong>. Se muestran todos los candidatos para evitar una asignación arbitraria.</p>` : ''}
    <div class="match-grid">${matches}</div>
  </section>`;
}

function documentRow(document) {
  const content = `<span class="pdf-glyph">PDF</span><span class="document-copy"><strong>${safe(pathName(document.sourcePath))}</strong><small>${safe(relativePath(document.sourcePath))}</small></span>${statusChip(document)}${document.matches.length > 1 ? `<span class="candidate-count">${document.matches.length} candidatos</span>` : ''}`;
  if (!document.matches.length) return `<div class="document-row document-row-static">${content}</div>`;
  return `<button class="document-row" data-document="${document.id}">${content}<span class="arrow">›</span></button>`;
}

function documentList(folder) {
  const documents = allDocuments(folder).filter(visible).sort((left, right) => left.sourcePath.localeCompare(right.sourcePath, 'es'));
  const pageSize = 80;
  const pages = Math.max(1, Math.ceil(documents.length / pageSize));
  state.page = Math.min(state.page, pages);
  const pageDocuments = documents.slice((state.page - 1) * pageSize, state.page * pageSize);
  const breadcrumb = folder.path.replace(state.data.sourceRoot, state.data.display.sourceLabel);
  return `<section class="content-panel">
    <div class="folder-heading"><div><span class="eyebrow">Carpeta seleccionada</span><h2>${safe(folder.name)}</h2><p>${safe(breadcrumb)}</p></div><div class="folder-stats"><span>${number.format(folder.stats.documents)} PDFs</span><span>${number.format(folder.stats.found)} encontrados</span></div></div>
    <div class="results-bar"><strong>${number.format(documents.length)} documentos visibles</strong><span>Selecciona un PDF para ver sus coincidencias y metadatos.</span></div>
    <div class="document-list">${pageDocuments.map(documentRow).join('') || '<div class="empty-state">No hay documentos que coincidan con la búsqueda o los filtros.</div>'}</div>
    ${pages > 1 ? `<nav class="pagination"><button data-page="${state.page - 1}" ${state.page === 1 ? 'disabled' : ''}>Anterior</button><span>Página ${state.page} de ${pages}</span><button data-page="${state.page + 1}" ${state.page === pages ? 'disabled' : ''}>Siguiente</button></nav>` : ''}
  </section>`;
}

function render() {
  const { summary, tree } = state.data;
  const archiveView = `<main>
    <section class="workspace"><aside class="sidebar"><div class="sidebar-top"><span class="eyebrow">Navegador</span><label class="search sidebar-search"><span>⌕</span><input id="search" type="search" placeholder="Buscar archivo, etiqueta o corresponsal" value="${safe(state.query)}" /></label></div><div class="filter-set"><button class="filter ${state.filter === 'all' ? 'active' : ''}" data-filter="all">Todos <span>${number.format(summary.total)}</span></button><button class="filter ${state.filter === 'found' ? 'active' : ''}" data-filter="found">Encontrados <span>${number.format(summary.found)}</span></button><button class="filter ${state.filter === 'missing' ? 'active' : ''}" data-filter="missing">Sin coincidencia <span>${number.format(summary.missing)}</span></button><button class="filter ${state.filter === 'ambiguous' ? 'active' : ''}" data-filter="ambiguous">Agrupados <span>${number.format(summary.ambiguous)}</span></button></div><nav class="tree">${folderMarkup(tree)}</nav></aside><div class="main-view">${state.selectedDocument ? documentDetail(state.selectedDocument) : documentList(selectedFolder())}</div></section>
  </main>`;
  app.innerHTML = `<header class="app-header"><div class="app-brand"><span class="brand-mark">DD</span><div><strong>${safe(state.data.display.appTitle)}</strong><small>Inventario documental</small></div></div><nav class="app-tabs" aria-label="Vistas del dashboard"><button class="app-tab ${state.view === 'archive' ? 'active' : ''}" data-view="archive">Documentos</button><button class="app-tab ${state.view === 'attributes' ? 'active' : ''}" data-view="attributes">Atributos</button></nav></header>${state.view === 'attributes' ? `<main>${attributesView()}</main>` : archiveView}<footer>Fuente: ${safe(state.data.generatedFrom)} · Archivos servidos mediante HTTP.</footer>`;
  bindEvents();
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
