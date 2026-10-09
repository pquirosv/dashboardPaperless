import path from 'node:path';

const fail = (field, reason) => { throw new Error(`Inventario JSON v1 inválido en ${field}: ${reason}.`); };
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const requireObject = (value, field) => {
  if (!isObject(value)) fail(field, 'se esperaba un objeto');
  return value;
};
const requireArray = (value, field) => {
  if (!Array.isArray(value)) fail(field, 'se esperaba una lista');
  return value;
};
const requireString = (value, field) => {
  if (typeof value !== 'string' || !value.length) fail(field, 'se esperaba una cadena no vacía');
  return value;
};
const requireBoolean = (value, field) => {
  if (typeof value !== 'boolean') fail(field, 'se esperaba un booleano');
  return value;
};
const requireCount = (value, field) => {
  if (!Number.isInteger(value) || value < 0) fail(field, 'se esperaba un entero no negativo');
  return value;
};

function relativePath(value, field) {
  requireString(value, field);
  if (value.startsWith('/') || value.includes('\\') || value.includes('\0')) fail(field, 'ruta no relativa válida');
  const segments = value.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    fail(field, 'ruta con segmento vacío o traversal');
  }
  if (/^[A-Za-z]:/.test(value)) fail(field, 'no se permiten rutas con unidad');
  return value;
}

function validatePaperlessDocument(value, field, { physical = false } = {}) {
  const record = requireObject(value, field);
  if (typeof record.manifestPresent !== 'boolean') fail(`${field}.manifestPresent`, 'se esperaba un booleano');
  requireString(record.exportedFileName, `${field}.exportedFileName`);
  if (record.backupPath !== undefined) relativePath(record.backupPath, `${field}.backupPath`);
  if (physical && record.backupPath === undefined) fail(`${field}.backupPath`, 'requerido para un archivo físico');
  if (typeof record.title === 'string' && !record.title.length) fail(`${field}.title`, 'cadena vacía no válida');
  if (record.title !== undefined && typeof record.title !== 'string') fail(`${field}.title`, 'se esperaba una cadena');
  if (record.tags !== undefined && (!Array.isArray(record.tags) || record.tags.some((tag) => typeof tag !== 'string'))) {
    fail(`${field}.tags`, 'se esperaba una lista de cadenas');
  }
  for (const name of ['correspondent', 'documentType', 'status']) {
    if (record[name] !== undefined && typeof record[name] !== 'string') fail(`${field}.${name}`, 'se esperaba una cadena');
  }
  if (record.storagePath !== undefined) {
    const storage = requireObject(record.storagePath, `${field}.storagePath`);
    for (const name of ['name', 'pathTemplate']) {
      if (storage[name] !== undefined && typeof storage[name] !== 'string') fail(`${field}.storagePath.${name}`, 'se esperaba una cadena');
    }
  }
  return record;
}

function validateInventory(data) {
  requireObject(data, '$');
  if (data.schema !== 'paperless-inventory') fail('schema', 'se esperaba "paperless-inventory"');
  if (data.version !== 1) fail('version', `versión no soportada (${String(data.version)})`);
  if (typeof data.generatedAt !== 'string' || Number.isNaN(Date.parse(data.generatedAt))) fail('generatedAt', 'fecha-hora inválida');
  const roots = requireObject(data.roots, 'roots');
  for (const name of ['source', 'paperless']) {
    requireString(requireObject(roots[name], `roots.${name}`).label, `roots.${name}.label`);
  }

  const summary = requireObject(data.summary, 'summary');
  const countFields = [
    'sourcePdfCount', 'paperlessPdfCount', 'manifestDocumentCount',
    'paperlessDocumentsNotInSourceCount', 'manifestDocumentsWithoutPdfCount',
    'paperlessFilesWithoutManifestCount', 'matchedSourceCount', 'unmatchedSourceCount',
    'oneToOneGroupCount', 'manyToManyGroupCount', 'manyToManySourceCount',
    'manyToManySameNumberGroupCount', 'manyToManyDifferentNumberGroupCount',
    'duplicateSourceNameCount'
  ];
  for (const field of countFields) requireCount(summary[field], `summary.${field}`);

  const sourceDocuments = requireArray(data.sourceDocuments, 'sourceDocuments');
  const sourceByPath = new Map();
  sourceDocuments.forEach((value, index) => {
    const field = `sourceDocuments[${index}]`;
    const record = requireObject(value, field);
    const sourcePath = relativePath(record.sourcePath, `${field}.sourcePath`);
    if (sourceByPath.has(sourcePath)) fail(`${field}.sourcePath`, `ruta duplicada (${sourcePath})`);
    requireBoolean(record.matched, `${field}.matched`);
    const groupIds = requireArray(record.groupIds, `${field}.groupIds`);
    groupIds.forEach((id, itemIndex) => requireString(id, `${field}.groupIds[${itemIndex}]`));
    sourceByPath.set(sourcePath, { ...record, sourcePath });
  });

  const groupIds = new Set();
  const groups = requireArray(data.groups, 'groups').map((value, index) => {
    const field = `groups[${index}]`;
    const group = requireObject(value, field);
    requireString(group.id, `${field}.id`);
    if (groupIds.has(group.id)) fail(`${field}.id`, `identificador de grupo duplicado (${group.id})`);
    groupIds.add(group.id);
    if (!['one-to-one', 'many-to-many-same-count', 'many-to-many-different-count'].includes(group.relation)) {
      fail(`${field}.relation`, 'relación no reconocida');
    }
    if (group.label !== undefined && typeof group.label !== 'string') fail(`${field}.label`, 'se esperaba una cadena');
    const sourcePaths = requireArray(group.sourcePaths, `${field}.sourcePaths`);
    const paperlessDocuments = requireArray(group.paperlessDocuments, `${field}.paperlessDocuments`);
    if (!sourcePaths.length || !paperlessDocuments.length) fail(field, 'el grupo debe tener documentos de ambos lados');
    sourcePaths.forEach((sourcePath, itemIndex) => {
      const normalized = relativePath(sourcePath, `${field}.sourcePaths[${itemIndex}]`);
      if (!sourceByPath.has(normalized)) fail(`${field}.sourcePaths`, `origen no declarado (${normalized})`);
      if (!sourceByPath.get(normalized).groupIds.includes(group.id)) fail(`${field}.sourcePaths`, `falta referencia al grupo ${group.id}`);
    });
    paperlessDocuments.forEach((document, itemIndex) => validatePaperlessDocument(document, `${field}.paperlessDocuments[${itemIndex}]`, { physical: true }));
    const sourceCount = sourcePaths.length;
    const referenceCount = paperlessDocuments.length;
    if (group.relation === 'one-to-one' && (sourceCount !== 1 || referenceCount !== 1)) fail(`${field}.relation`, 'cardinalidad uno-a-uno inconsistente');
    if (group.relation === 'many-to-many-same-count' && (sourceCount !== referenceCount || sourceCount < 2)) fail(`${field}.relation`, 'cardinalidad varios-a-varios inconsistente');
    if (group.relation === 'many-to-many-different-count' && sourceCount === referenceCount) fail(`${field}.relation`, 'se esperaba cardinalidad distinta');
    return { ...group, sourcePaths };
  });

  for (const [sourcePath, document] of sourceByPath) {
    for (const id of document.groupIds) if (!groupIds.has(id)) fail(`sourceDocuments.${sourcePath}.groupIds`, `grupo no declarado (${id})`);
    if (document.matched !== (document.groupIds.length > 0)) fail(`sourceDocuments.${sourcePath}.matched`, 'no coincide con groupIds');
  }

  const validateList = (name, callback) => {
    const list = requireArray(data[name], name);
    list.forEach((item, index) => callback(item, `${name}[${index}]`));
    return list;
  };
  const paperlessDocuments = validateList('paperlessDocuments', (item, field) => validatePaperlessDocument(item, field, { physical: true }));
  const notInSource = validateList('paperlessDocumentsNotInSource', (item, field) => validatePaperlessDocument(item, field, { physical: true }));
  const manifestWithoutPdf = validateList('manifestDocumentsWithoutPdf', (item, field) => {
    const document = validatePaperlessDocument(item, field);
    if (document.backupPath !== undefined) fail(`${field}.backupPath`, 'no debe existir sin PDF físico');
    if (!document.manifestPresent) fail(`${field}.manifestPresent`, 'debe estar presente en el manifest');
  });
  const filesWithoutManifest = validateList('paperlessFilesWithoutManifest', (item, field) => {
    const record = requireObject(item, field);
    relativePath(record.backupPath, `${field}.backupPath`);
  });
  const duplicateNames = validateList('duplicateSourceNames', (item, field) => {
    const record = requireObject(item, field);
    requireString(record.name, `${field}.name`);
    const paths = requireArray(record.sourcePaths, `${field}.sourcePaths`);
    if (paths.length < 2) fail(`${field}.sourcePaths`, 'se requieren al menos dos rutas');
    paths.forEach((sourcePath, index) => relativePath(sourcePath, `${field}.sourcePaths[${index}]`));
  });

  const catalogs = requireObject(data.catalogs, 'catalogs');
  for (const name of ['tags', 'correspondents', 'documentTypes', 'storagePaths']) {
    requireArray(catalogs[name], `catalogs.${name}`).forEach((item, index) => {
      const field = `catalogs.${name}[${index}]`;
      const record = requireObject(item, field);
      if (!['string', 'number'].includes(typeof record.id)) fail(`${field}.id`, 'se esperaba string o número');
      requireString(record.name, `${field}.name`);
      requireCount(record.documentCount, `${field}.documentCount`);
      if (name === 'storagePaths' && record.pathTemplate !== undefined && typeof record.pathTemplate !== 'string') fail(`${field}.pathTemplate`, 'se esperaba una cadena');
    });
  }
  const assertCount = (field, actual) => {
    if (summary[field] !== actual) fail(`summary.${field}`, `el recuento no coincide con los datos (${actual})`);
  };
  assertCount('sourcePdfCount', sourceDocuments.length);
  assertCount('paperlessPdfCount', paperlessDocuments.length);
  assertCount('manifestDocumentCount', paperlessDocuments.filter((item) => item.manifestPresent).length + manifestWithoutPdf.length);
  assertCount('paperlessDocumentsNotInSourceCount', notInSource.length);
  assertCount('manifestDocumentsWithoutPdfCount', manifestWithoutPdf.length);
  assertCount('paperlessFilesWithoutManifestCount', filesWithoutManifest.length);
  assertCount('matchedSourceCount', sourceDocuments.filter((item) => item.matched).length);
  assertCount('unmatchedSourceCount', sourceDocuments.filter((item) => !item.matched).length);
  assertCount('oneToOneGroupCount', groups.filter((item) => item.relation === 'one-to-one').length);
  assertCount('manyToManyGroupCount', groups.filter((item) => item.relation !== 'one-to-one').length);
  assertCount('manyToManySourceCount', groups.filter((item) => item.relation !== 'one-to-one').reduce((sum, item) => sum + item.sourcePaths.length, 0));
  assertCount('manyToManySameNumberGroupCount', groups.filter((item) => item.relation === 'many-to-many-same-count').length);
  assertCount('manyToManyDifferentNumberGroupCount', groups.filter((item) => item.relation === 'many-to-many-different-count').length);
  assertCount('duplicateSourceNameCount', duplicateNames.length);
  return { ...data, groups };
}

function createTree(documents, sourceRoot, sourceLabel) {
  const rootPath = `${sourceRoot}/`;
  const root = { name: sourceLabel, path: sourceRoot, folders: [], documents: [] };
  const folders = new Map([[rootPath, root]]);
  for (const document of documents) {
    const parts = document.sourcePath.slice(rootPath.length).split('/');
    const fileName = parts.pop();
    let currentPath = rootPath;
    let current = root;
    for (const folderName of parts) {
      currentPath += `${folderName}/`;
      if (!folders.has(currentPath)) {
        const folder = { name: folderName, path: currentPath.slice(0, -1), folders: [], documents: [] };
        folders.set(currentPath, folder);
        current.folders.push(folder);
      }
      current = folders.get(currentPath);
    }
    current.documents.push({ id: document.id, name: fileName });
  }
  const documentsById = new Map(documents.map((document) => [document.id, document]));
  const decorate = (folder) => {
    folder.folders.sort((left, right) => left.name.localeCompare(right.name, 'es'));
    folder.documents.sort((left, right) => left.name.localeCompare(right.name, 'es'));
    const own = folder.documents.map(({ id }) => documentsById.get(id));
    const children = folder.folders.map(decorate);
    folder.stats = {
      documents: own.length + children.reduce((sum, child) => sum + child.stats.documents, 0),
      found: own.filter((document) => document.found).length + children.reduce((sum, child) => sum + child.stats.found, 0),
      ambiguous: own.filter((document) => document.ambiguous).length + children.reduce((sum, child) => sum + child.stats.ambiguous, 0)
    };
    return folder;
  };
  return decorate(root);
}

function relationLabel(relation) {
  if (relation === 'one-to-one') return '1 a 1';
  return relation === 'many-to-many-same-count' ? 'varios a varios: mismo número' : 'varios a varios: número distinto';
}

export function parseInventory(input, options = {}) {
  if (typeof input !== 'string' || !input.trim()) throw new Error('El inventario está vacío.');
  let parsed;
  try {
    parsed = JSON.parse(input);
  } catch (error) {
    throw new Error(`JSON del inventario inválido: ${error.message}`);
  }
  const data = validateInventory(parsed);
  const sourceRoot = '/source';
  const backupRoot = '/backup';
  const groupsById = new Map(data.groups.map((group) => [group.id, group]));
  const sourceLabel = options.sourceLabel || data.roots.source.label;
  const documents = data.sourceDocuments.map((record, index) => {
    const groups = record.groupIds.map((id) => groupsById.get(id));
    const matches = groups.flatMap((group) => group.paperlessDocuments.map((paperless) => ({
      path: `${backupRoot}/${paperless.backupPath}`,
      title: paperless.title,
      tags: paperless.tags ? [...paperless.tags] : undefined,
      correspondent: paperless.correspondent,
      documentType: paperless.documentType,
      storagePath: paperless.storagePath
        ? [paperless.storagePath.name, paperless.storagePath.pathTemplate].filter(Boolean).join(' | ')
        : undefined,
      status: paperless.status
    })));
    const ambiguous = groups.some((group) => group.relation !== 'one-to-one') || groups.length > 1;
    return {
      id: `doc-${index + 1}`,
      sourcePath: `${sourceRoot}/${record.sourcePath}`,
      found: record.matched,
      ambiguous,
      relation: groups.length ? relationLabel(groups[0].relation) : 'sin coincidencia',
      groupLabel: groups[0]?.label,
      matches
    };
  }).sort((left, right) => left.sourcePath.localeCompare(right.sourcePath, 'es'));
  const found = documents.filter((document) => document.found).length;
  const ambiguous = documents.filter((document) => document.ambiguous).length;
  return {
    sourceRoot,
    backupRoot,
    generatedFrom: options.generatedFrom || 'Inventario JSON local',
    display: {
      appTitle: options.appTitle || 'Dashboard Paperless',
      sourceLabel,
      backupLabel: options.backupLabel || data.roots.paperless.label
    },
    summary: {
      total: documents.length,
      found,
      missing: documents.length - found,
      ambiguous,
      groups: data.groups.filter((group) => group.relation !== 'one-to-one').length
    },
    documents,
    tree: createTree(documents, sourceRoot, sourceLabel)
  };
}
