import path from 'node:path';

const clean = (value) => value.trim();

function pathAfterHeading(lines, headingPattern, headingDescription) {
  const headingIndex = lines.findIndex((line) => headingPattern.test(line.trim()));
  if (headingIndex === -1) throw new Error(`Falta la cabecera obligatoria: ${headingDescription}`);
  const value = lines.slice(headingIndex + 1).find((line) => line.trim());
  if (!value || !path.isAbsolute(value.trim())) throw new Error(`La ruta indicada después de "${headingDescription}" no es absoluta.`);
  return value.trim().replace(/\/+$/, '');
}

function sectionRange(lines, startPattern, endPattern, description) {
  const start = lines.findIndex((line) => startPattern.test(line.trim()));
  const end = lines.findIndex((line, index) => index > start && endPattern.test(line.trim()));
  if (start === -1 || end === -1) throw new Error(`El informe no contiene la sección esperada: ${description}`);
  return { start, end };
}

function parseAttributes(lines, startIndex, referencePrefix) {
  const record = { path: clean(lines[startIndex].slice(referencePrefix.length)) };
  let cursor = startIndex + 1;
  while (cursor < lines.length && /^   (TÍTULO|ETIQUETAS|CORRESPONSAL|TIPO DOCUMENTAL|RUTA DE ALMACENAMIENTO|ESTADO):/.test(lines[cursor])) {
    const line = lines[cursor].trim();
    const separator = line.indexOf(':');
    const key = line.slice(0, separator);
    const value = clean(line.slice(separator + 1));
    if (key === 'TÍTULO') record.title = value;
    if (key === 'ETIQUETAS') record.tags = value.split(';').map(clean).filter(Boolean);
    if (key === 'CORRESPONSAL') record.correspondent = value;
    if (key === 'TIPO DOCUMENTAL') record.documentType = value;
    if (key === 'RUTA DE ALMACENAMIENTO') record.storagePath = value;
    if (key === 'ESTADO') record.status = value;
    cursor += 1;
  }
  return { record, nextIndex: cursor };
}

function relationForHeading(line, current) {
  if (line.includes('RELACIÓN 1 A 1')) return '1 a 1';
  if (line.includes('RELACIÓN VARIOS A VARIOS — MISMO NÚMERO')) return 'varios a varios: mismo número';
  if (line.includes('RELACIÓN VARIOS A VARIOS — NÚMERO DISTINTO')) return 'varios a varios: número distinto';
  return current;
}

function parseMatchedGroups(lines, format) {
  const start = lines.findIndex((line) => line.trim() === format.matchedHeading);
  const end = lines.findIndex((line, index) => index > start && line.trim() === format.manifestHeading);
  if (start === -1 || end === -1) throw new Error('El informe no contiene la sección completa de documentos relacionados.');
  const groups = [];
  let relation = null;
  let group = null;
  let pendingLabel = null;
  const finish = () => {
    if (group?.sourcePaths.length) groups.push(group);
    group = null;
  };

  for (let index = start; index < end; index += 1) {
    const line = lines[index];
    relation = relationForHeading(line, relation);
    const groupLabel = line.match(/^(.+?\.pdf)\s+\(\d+\s+.+?\s*\/\s*\d+\s+.+?\)$/);
    if (groupLabel) {
      if (group?.paperless.length) finish();
      pendingLabel = groupLabel[1];
      continue;
    }
    if (line.startsWith(format.sourcePrefix)) {
      if (group?.paperless.length) finish();
      if (!group) {
        group = { id: `group-${groups.length + 1}`, label: pendingLabel, relation, sourcePaths: [], paperless: [] };
        pendingLabel = null;
      }
      group.sourcePaths.push(clean(line.slice(format.sourcePrefix.length)));
      continue;
    }
    if (line.startsWith(format.referencePrefix)) {
      if (!group) continue;
      const { record, nextIndex } = parseAttributes(lines, index, format.referencePrefix);
      group.paperless.push(record);
      index = nextIndex - 1;
    }
  }
  finish();
  return groups;
}

function parseUnmatched(lines, sourceRoot, format) {
  const { start, end } = sectionRange(lines, new RegExp(`^${escapeRegExp(format.unmatchedHeading)}$`), /^NOMBRES PDF DUPLICADOS EN .+$/, 'documentos sin coincidencia');
  return lines.slice(start + 1, end).map(clean).filter((line) => line.startsWith(`${sourceRoot}/`));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function detectFormat(lines) {
  const matchedLine = lines.find((line) => /^DOCUMENTOS DE .+ QUE SÍ ESTÁN EN .+$/.test(line.trim()))?.trim();
  const matched = matchedLine?.match(/^DOCUMENTOS DE (.+) QUE SÍ ESTÁN EN (.+)$/);
  if (!matched) throw new Error('El informe no contiene la cabecera de documentos relacionados.');
  const sourceName = matched[1];
  const referenceName = matched[2];
  return {
    sourcePrefix: `${sourceName}:`,
    referencePrefix: `${referenceName}:`,
    matchedHeading: matchedLine,
    unmatchedHeading: `DOCUMENTOS DE ${sourceName} QUE NO SE ENCONTRARON EN ${referenceName}`,
    manifestHeading: 'DOCUMENTOS DEL MANIFEST SIN PDF ORIGINAL EN EL BACKUP'
  };
}

function createTree(documents, sourceRoot, sourceLabel) {
  const rootPath = `${sourceRoot}/`;
  const root = { name: sourceLabel, path: sourceRoot, folders: [], documents: [] };
  const folders = new Map([[rootPath, root]]);
  for (const document of documents) {
    if (!document.sourcePath.startsWith(rootPath)) throw new Error(`Una ruta de origen queda fuera de la carpeta declarada: ${document.sourcePath}`);
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

export function parseInventory(input, options = {}) {
  if (typeof input !== 'string' || !input.trim()) throw new Error('El informe está vacío.');
  const lines = input.replace(/\r/g, '').split('\n');
  const format = detectFormat(lines);
  const sourceRoot = pathAfterHeading(lines, /^Carpeta origen(?: [^:]+)?:$/, 'la carpeta de origen');
  const backupRoot = pathAfterHeading(lines, /^Backup de .+:$/, 'la carpeta de referencia');
  const sourceLabel = options.sourceLabel || 'Documentos de origen';
  const matchedGroups = parseMatchedGroups(lines, format);
  const documents = new Map();

  for (const sourcePath of parseUnmatched(lines, sourceRoot, format)) {
    documents.set(sourcePath, { id: `doc-${documents.size + 1}`, sourcePath, found: false, ambiguous: false, relation: 'sin coincidencia', matches: [] });
  }
  for (const group of matchedGroups) {
    for (const sourcePath of group.sourcePaths) {
      if (!sourcePath.startsWith(`${sourceRoot}/`)) throw new Error(`Una ruta de origen queda fuera de la carpeta declarada: ${sourcePath}`);
      for (const record of group.paperless) {
        if (!record.path.startsWith(`${backupRoot}/`)) throw new Error(`Una ruta de referencia queda fuera de la carpeta declarada: ${record.path}`);
      }
      const matches = group.paperless.map((record) => ({ ...record, tags: record.tags ? [...record.tags] : undefined }));
      const current = documents.get(sourcePath);
      if (current) {
        current.found = true;
        current.matches.push(...matches);
        current.ambiguous ||= group.sourcePaths.length > 1 || group.paperless.length > 1;
      } else {
        documents.set(sourcePath, {
          id: `doc-${documents.size + 1}`,
          sourcePath,
          found: true,
          ambiguous: group.sourcePaths.length > 1 || group.paperless.length > 1,
          relation: group.relation ?? 'coincidencia registrada',
          groupLabel: group.label,
          matches
        });
      }
    }
  }

  if (!documents.size) throw new Error('El informe no contiene documentos de origen reconocibles.');
  const documentList = [...documents.values()].sort((left, right) => left.sourcePath.localeCompare(right.sourcePath, 'es'));
  const found = documentList.filter((document) => document.found).length;
  const ambiguous = documentList.filter((document) => document.ambiguous).length;
  return {
    sourceRoot,
    backupRoot,
    generatedFrom: options.generatedFrom || 'Informe local montado',
    display: {
      appTitle: options.appTitle || 'Dashboard Paperless',
      sourceLabel,
      backupLabel: options.backupLabel || 'Repositorio de referencia'
    },
    summary: {
      total: documentList.length,
      found,
      missing: documentList.length - found,
      ambiguous,
      groups: matchedGroups.filter((group) => group.sourcePaths.length > 1 || group.paperless.length > 1).length
    },
    documents: documentList,
    tree: createTree(documentList, sourceRoot, sourceLabel)
  };
}
