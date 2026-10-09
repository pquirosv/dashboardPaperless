# Contrato de inventario JSON v1

El inventario que consume el dashboard es un documento JSON UTF-8 cuyo objeto
raíz declara `schema: "paperless-inventory"` y `version: 1`. JSON v1 es el
formato canónico; no se contempla compatibilidad del consumidor con el TXT
histórico. Un inventario manual es válido si cumple este contrato. Los
campos desconocidos no sustituyen campos requeridos y la validación deberá
producir errores legibles indicando la ruta del campo inválido.

## Ejemplo mínimo estructural

```json
{
  "schema": "paperless-inventory",
  "version": 1,
  "generatedAt": "2026-01-02T03:04:05Z",
  "roots": {
    "source": { "label": "Archivo de origen" },
    "paperless": { "label": "Exportación Paperless" }
  },
  "summary": {},
  "sourceDocuments": [],
  "paperlessDocuments": [],
  "groups": [],
  "paperlessDocumentsNotInSource": [],
  "duplicateSourceNames": [],
  "paperlessFilesWithoutManifest": [],
  "manifestDocumentsWithoutPdf": [],
  "catalogs": {
    "tags": [],
    "correspondents": [],
    "documentTypes": [],
    "storagePaths": []
  }
}
```

El ejemplo ilustra la organización, no es inventario vacío válido: un informe
generado debe incluir los recuentos completos en `summary` y los datos
observados. No se guardan totales derivados duplicados en listas.

## Rutas y privacidad

Todas las rutas son relativas a una raíz lógica y usan `/` como separador,
independientemente del sistema operativo. `sourcePath` es relativo a
`roots.source`; `backupPath` es relativo a `roots.paperless`. No llevan `/`
inicial, prefijo de unidad, `..` ni segmentos vacíos. La ruta de la raíz local
real, la ubicación del manifest y cualquier otra ruta absoluta no forman parte
del JSON. El servidor resuelve las rutas con las raíces configuradas/montadas,
comprueba que permanezcan dentro de ellas y sirve los enlaces; el inventario
por sí solo no contiene URL locales.

## Estructura y campos

- `schema` (string) y `version` (integer) identifican el contrato exacto.
- `generatedAt` (string, fecha-hora ISO 8601 UTC) registra cuándo se generó.
- `roots.source` y `roots.paperless`: cada uno tiene `label` (string). No
  contienen rutas físicas.
- `summary`: recuentos enteros no negativos de `sourcePdfCount`,
  `paperlessPdfCount`, `manifestDocumentCount`,
  `paperlessDocumentsNotInSourceCount`,
  `manifestDocumentsWithoutPdfCount`, `paperlessFilesWithoutManifestCount`,
  `matchedSourceCount`, `unmatchedSourceCount`, `oneToOneGroupCount`,
  `manyToManyGroupCount`, `manyToManySourceCount`,
  `manyToManySameNumberGroupCount`, `manyToManyDifferentNumberGroupCount`,
  `duplicateSourceNameCount`. Se calculan de los datos representados.
- `sourceDocuments`: un objeto por PDF de origen, con `sourcePath`,
  `matched` (boolean) y `groupIds` (lista de identificadores de grupos; vacía
  si no tiene coincidencia). Así se conservan tanto documentos sueltos como
  relaciones múltiples.
- `groups`: cada grupo tiene `id` (único), `relation` (enum `one-to-one`,
  `many-to-many-same-count` o `many-to-many-different-count`), `label`
  (string opcional), `sourcePaths` (lista no vacía de rutas relativas) y
  `paperlessDocuments` (lista no vacía de documentos Paperless). El cardinal
  se conserva explícitamente; las longitudes de las dos listas dan N y M.
- Cada elemento de `paperlessDocuments` tiene `backupPath` (string opcional),
  `manifestPresent` (boolean), `exportedFileName` (string), `title` (string
  opcional), `tags` (lista de strings, opcional), `correspondent` (string
  opcional), `documentType` (string opcional), `storagePath` (objeto opcional
  con `name` y `pathTemplate`, ambos strings opcionales) y `status` (string
  opcional). `manifestPresent: false` representa un PDF de backup sin registro;
  si no hay PDF físico, `backupPath` se omite y `manifestPresent` es `true`.
  Un valor de atributo inexistente en el catálogo se conserva como nombre
  visible (por ejemplo, `ID 42 (no encontrado en el manifest)`), no se
  descarta.
- `duplicateSourceNames`: objetos con `name` (nombre PDF) y `sourcePaths`
  (dos o más rutas relativas); incluye el conjunto de nombres repetidos del
  origen.
- `paperlessDocumentsNotInSource`: documentos con PDF físico de Paperless no
  relacionados con ningún documento de origen. Cada uno conserva `backupPath`,
  `manifestPresent` y los atributos Paperless descritos arriba, incluso si
  existe su registro en el manifest.
- `paperlessFilesWithoutManifest`: lista de objetos `{ "backupPath": ... }`
  para cada PDF físico del backup sin registro en el manifest.
- `manifestDocumentsWithoutPdf`: lista de documentos de manifest sin PDF
  original físico. Conserva `exportedFileName` y los atributos Paperless
  descritos arriba; omite `backupPath`.
- `catalogs`: conserva los cuatro inventarios de atributos del TXT. Cada
  elemento de `tags`, `correspondents` y `documentTypes` contiene `id` (valor
  del manifest), `name` y `documentCount` (cantidad de documentos que lo
  referencian). `storagePaths` contiene además `pathTemplate` (plantilla,
  string opcional). Los nombres ausentes se representan como `"(sin nombre)"`;
  una plantilla ausente/vacía como `"(vacía)"`. Se incluyen entradas sin uso
  con `documentCount: 0`.

## Opcionales y anomalías

Un atributo Paperless realmente ausente se omite (no se serializa como `null`),
excepto `tags`, que se omite cuando no hay etiquetas. Cadena vacía no equivale
a dato ausente; los marcadores anteriores se reservan para preservar los
marcadores descriptivos del informe histórico. `storagePath` conserva por
separado el nombre y la plantilla que el TXT imprimía juntos.

Los archivos de origen no encontrados aparecen en `sourceDocuments` con
`matched: false` y `groupIds: []`. Los grupos uno-a-uno y varios-a-varios
permanecen diferenciados, incluidos los cardinales desiguales. Los duplicados
del origen, PDF Paperless sin registro, documentos del manifest sin PDF y
referencias a atributos ausentes se conservan explícitamente, no se corrigen
ni se silencian. Los estados como eliminación se conservan literalmente en
`status`. El listado de Paperless que no estaba en el origen se conserva en
`paperlessDocumentsNotInSource`, con sus metadatos tanto si tiene registro en
el manifest como si no; `paperlessFilesWithoutManifest` señala además los PDF
físicos sin registro.

En v1 no se aceptan rutas absolutas ni se infieren rutas desde el texto. El
consumidor rechaza documentos cuyo `schema` o `version` no reconoce, tipos
incorrectos, identificadores de grupo duplicados o referencias a rutas que
escapen de la raíz lógica, y presenta un error que identifique el dato
problemático.
