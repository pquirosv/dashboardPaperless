#!/usr/bin/env python3

from collections import Counter, defaultdict
from pathlib import Path
import argparse
import json
import os
import re
import tempfile
import unicodedata

DATE_PREFIX = re.compile(r"^\d{4}-\d{2}-\d{2} ")
PAPERLESS_DUP_SUFFIX = re.compile(r"_\d{2}(\.[^.]+)$", re.I)


def comparable_name(name):
    """El '/' original no cabe en un nombre de archivo.

    ArchivoMunet lo sustituye por ':' (POSIX/macOS) y Paperless por '-'.
    Ejemplo: Anexo 2 Hermes 16.03.2001/30.07.2015.pdf
      ArchivoMunet: Anexo 2 Hermes 16.03.2001:30.07.2015.pdf
      Paperless:    Anexo 2 Hermes 16.03.2001-30.07.2015.pdf
    """
    return name.replace(":", "-").replace("/", "-")


def without_paperless_dup_suffix(name):
    """Quita el sufijo _01, _02, ... que Paperless añade si choca el nombre."""
    stripped = PAPERLESS_DUP_SUFFIX.sub(r"\1", name, count=1)
    if stripped == name or not Path(stripped).stem:
        return name
    return stripped


def candidate_keys_from_rest(rest):
    """Nombre completo y, de más largo a más corto, tras quitar la etiqueta."""
    yield comparable_name(rest)
    parts = rest.split(" ")
    for i in range(1, len(parts)):
        yield comparable_name(" ".join(parts[i:]))


def original_key_from_backup(filename, munet_comparables, duplicated_comparables):
    """Quita AAAA-MM-DD y, si hace falta, la etiqueta/corresponsal de Paperless.

    Ejemplos en el backup:
      1971-01-16 La peninsular Estimación 20 ....pdf
      1976-02-23 hermes Anexo 11 PCP 23.02.2016.pdf
      2002-06-01 TEN Arquitectos Anexo 2 TEN Arquitectos.pdf

    La etiqueta puede tener espacios. Se usa el sufijo más largo que exista
    como nombre de PDF en ArchivoMunet, igualando ':' y '-'.

    Si Paperless añadió _01, _02, ... por colisión de fecha+nombre, solo se
    quita cuando el nombre base está duplicado en ArchivoMunet.
    """
    if not DATE_PREFIX.match(filename):
        return None

    rest = DATE_PREFIX.sub("", filename, count=1)
    rest_key = comparable_name(rest)

    for key in candidate_keys_from_rest(rest):
        if key in munet_comparables:
            return key

    for key in candidate_keys_from_rest(rest):
        stripped = without_paperless_dup_suffix(key)
        if stripped != key and stripped in duplicated_comparables:
            return stripped

    return rest_key


def pdfs_under(root, exclude_archive=False):
    files = (
        p for p in root.rglob("*")
        if (
            p.is_file()
            and p.suffix.lower() == ".pdf"
            and not (
                exclude_archive
                and p.name.lower().endswith("-archive.pdf")
            )
        )
    )
    return sorted(files, key=lambda p: str(p).lower())


def filename_key(name):
    """Normaliza nombres del manifest y del filesystem para poder enlazarlos.

    macOS suele devolver los acentos descompuestos (NFD), mientras que el JSON
    puede conservarlos compuestos (NFC).
    """
    return unicodedata.normalize("NFC", name)


def load_paperless_manifest(manifest_path):
    """Carga documentos y catálogos de atributos del manifest de Paperless."""
    with manifest_path.open(encoding="utf-8") as manifest_file:
        records = json.load(manifest_file)

    if not isinstance(records, list):
        raise SystemExit(
            f"ERROR: El manifest de Paperless no contiene una lista: {manifest_path}"
        )

    attribute_models = (
        "documents.tag",
        "documents.correspondent",
        "documents.documenttype",
        "documents.storagepath",
    )
    catalogs = {model: {} for model in attribute_models}
    documents = []
    documents_by_exported_name = {}

    for record in records:
        model = record.get("model")
        if model in catalogs:
            catalogs[model][record.get("pk")] = record.get("fields", {})
        elif model == "documents.document":
            exported_name = record.get("__exported_file_name__")
            if not exported_name:
                raise SystemExit(
                    "ERROR: Hay un documento sin __exported_file_name__ "
                    f"en el manifest (ID {record.get('pk')})."
                )
            exported_name_key = filename_key(exported_name)
            if exported_name_key in documents_by_exported_name:
                raise SystemExit(
                    "ERROR: Nombre exportado duplicado en el manifest tras "
                    "normalizar Unicode: "
                    f"{exported_name}"
                )
            document = {
                "pk": record.get("pk"),
                "exported_name": exported_name,
                "fields": record.get("fields", {}),
            }
            documents.append(document)
            documents_by_exported_name[exported_name_key] = document

    documents.sort(key=lambda document: document["exported_name"].lower())
    return catalogs, documents, documents_by_exported_name


def referenced_attribute_ids(documents):
    """Cuenta en cuántos documentos se usa cada valor de atributo."""
    usage = {
        "documents.tag": Counter(),
        "documents.correspondent": Counter(),
        "documents.documenttype": Counter(),
        "documents.storagepath": Counter(),
    }
    field_by_model = {
        "documents.correspondent": "correspondent",
        "documents.documenttype": "document_type",
        "documents.storagepath": "storage_path",
    }

    for document in documents:
        fields = document["fields"]
        usage["documents.tag"].update(fields.get("tags") or [])
        for model, field in field_by_model.items():
            attribute_id = fields.get(field)
            if attribute_id is not None:
                usage[model][attribute_id] += 1

    return usage


def named_attribute(catalog, attribute_id):
    """Devuelve el nombre y deja visibles las referencias rotas del manifest."""
    if attribute_id is None:
        return None
    fields = catalog.get(attribute_id)
    if fields is None:
        return f"ID {attribute_id} (no encontrado en el manifest)"
    return f"{fields.get('name') or '(sin nombre)'}"


def write_report(out, archivo_munet, backup, munet_files, backup_files,
                 matched, unmatched, matched_one_to_one, matched_many_to_many,
                 duplicated_munet_names, paperless_not_in_munet, manifest,
                 catalogs, manifest_documents, documents_by_exported_name,
                 manifest_documents_without_pdf, backup_files_without_manifest):
    p = lambda *args: print(*args, file=out)

    p("============================================================")
    p("DESGLOSE DOCUMENTOS ORIGEN / PAPERLESS")
    p("============================================================")
    p()
    p("Carpeta origen:")
    p(f"  {archivo_munet}")
    p()
    p("Backup de Paperless:")
    p(f"  {backup}")
    p()
    p("Manifest de Paperless:")
    p(f"  {manifest}")
    p()

    p("============================================================")
    p("RESUMEN")
    p("============================================================")
    p(f"Archivos encontrados en Paperless que no estaban en origen: {len(paperless_not_in_munet)}")
    p(f"PDF encontrados en origen:                               {len(munet_files)}")
    p(f"PDF originales encontrados en el backup de Paperless:    {len(backup_files)}")
    p(f"Documentos registrados en el manifest de Paperless:      {len(manifest_documents)}")
    p(f"Registros del manifest sin PDF original en el backup:     {len(manifest_documents_without_pdf)}")
    p(f"PDF originales sin registro en el manifest:               {len(backup_files_without_manifest)}")
    p(f"Documentos de origen encontrados en Paperless:          {len(matched)}")
    many_equal_by_n = defaultdict(list)
    many_unequal_by_nm = defaultdict(list)
    for group in matched_many_to_many:
        _name, munet_paths, backup_paths = group
        n_munet = len(munet_paths)
        n_paperless = len(backup_paths)
        if n_munet == n_paperless:
            many_equal_by_n[n_munet].append(group)
        else:
            many_unequal_by_nm[(n_munet, n_paperless)].append(group)

    p(f"   Relación 1 a 1:                                       {len(matched_one_to_one)}")
    p(f"   Relación varios a varios:                             {len(matched_many_to_many)} grupos ({sum(len(g[1]) for g in matched_many_to_many)} origen)")
    p(f"      Mismo número (2 a 2, 3 a 3, ...):                  {sum(len(g) for g in many_equal_by_n.values())} grupos")
    p(f"      Número distinto:                                   {sum(len(g) for g in many_unequal_by_nm.values())} grupos")
    p(f"Documentos de origen NO encontrados en Paperless:       {len(unmatched)}")
    p(f"Nombres PDF duplicados en origen:                        {len(duplicated_munet_names)}")
    p()

    attribute_usage = referenced_attribute_ids(manifest_documents)

    def print_attribute_inventory(title, model):
        catalog = catalogs[model]
        usage = attribute_usage[model]
        used = sum(1 for attribute_id in catalog if usage[attribute_id])
        p(title)
        p(f"Total: {len(catalog)} | En uso: {used}")
        for attribute_id, fields in sorted(
            catalog.items(),
            key=lambda item: ((item[1].get("name") or "").lower(), item[0]),
        ):
            extra = ""
            if model == "documents.storagepath":
                extra = f" | Plantilla de ruta: {fields.get('path') or '(vacía)'}"
            p(
                f"   {fields.get('name') or '(sin nombre)'}"
                f"{extra}: {usage[attribute_id]} documentos"
            )
        p()

    p("============================================================")
    p("ATRIBUTOS DEFINIDOS EN PAPERLESS")
    p("============================================================")
    print_attribute_inventory("ETIQUETAS (TAGS)", "documents.tag")
    print_attribute_inventory("CORRESPONSALES (CORRESPONDENTS)", "documents.correspondent")
    print_attribute_inventory("TIPOS DOCUMENTALES (DOCUMENT TYPES)", "documents.documenttype")
    print_attribute_inventory("RUTAS DE ALMACENAMIENTO (STORAGE PATHS)", "documents.storagepath")

    def print_paperless_document(backup_path, document=None):
        p(f"PAPERLESS: {backup_path}")
        if document is None:
            p("   MANIFEST: No se encontró un registro para este PDF original.")
            return

        fields = document["fields"]
        tag_ids = fields.get("tags") or []
        tags = [
            named_attribute(catalogs["documents.tag"], tag_id)
            for tag_id in tag_ids
        ]
        storage_path_id = fields.get("storage_path")
        storage_path = named_attribute(
            catalogs["documents.storagepath"], storage_path_id
        )
        if storage_path_id is not None:
            storage_path_fields = catalogs["documents.storagepath"].get(
                storage_path_id
            )
            if storage_path_fields is not None:
                storage_path += (
                    " | Plantilla de ruta: "
                    f"{storage_path_fields.get('path') or '(vacía)'}"
                )

        p(f"   TÍTULO: {fields.get('title') or '(sin título)'}")
        # No se imprime la línea cuando el documento no tiene etiquetas.
        if tags:
            p(f"   ETIQUETAS: {'; '.join(tags)}")

        correspondent = named_attribute(
            catalogs["documents.correspondent"], fields.get("correspondent")
        )
        if correspondent:
            p(f"   CORRESPONSAL: {correspondent}")

        document_type = named_attribute(
            catalogs["documents.documenttype"], fields.get("document_type")
        )
        if document_type:
            p(f"   TIPO DOCUMENTAL: {document_type}")

        if storage_path:
            p(f"   RUTA DE ALMACENAMIENTO: {storage_path}")
        if fields.get("deleted_at"):
            p(f"   ESTADO: Eliminado el {fields['deleted_at']}")

    def print_paperless_path(backup_path):
        print_paperless_document(
            backup_path,
            documents_by_exported_name.get(filename_key(backup_path.name)),
        )

    p("============================================================")
    p("ARCHIVOS ENCONTRADOS EN PAPERLESS QUE NO ESTABAN EN ORIGEN")
    p("============================================================")

    if paperless_not_in_munet:
        for _original_key, backup_path in paperless_not_in_munet:
            p()
            print_paperless_path(backup_path)
    else:
        p("Ninguno.")

    p()
    p("============================================================")
    p("DOCUMENTOS DE ORIGEN QUE NO SE ENCONTRARON EN PAPERLESS")
    p("============================================================")

    if unmatched:
        for path in unmatched:
            p(path)
    else:
        p("Ninguno.")

    p()
    p("============================================================")
    p("NOMBRES PDF DUPLICADOS EN ORIGEN")
    p("============================================================")

    if duplicated_munet_names:
        for name, paths in sorted(duplicated_munet_names.items(), key=lambda x: x[0].lower()):
            p()
            p(name)
            for path in paths:
                p(f"   {path}")
    else:
        p("Ninguno.")

    def print_many_group(name, munet_paths, backup_paths):
        p()
        p(f"{name}  ({len(munet_paths)} origen / {len(backup_paths)} Paperless)")
        for munet_path in munet_paths:
            p(f"ORIGEN: {munet_path}")
        for backup_path in backup_paths:
            print_paperless_path(backup_path)

    p()
    p("============================================================")
    p("DOCUMENTOS DE ORIGEN QUE SÍ ESTÁN EN PAPERLESS")
    p("RELACIÓN VARIOS A VARIOS — MISMO NÚMERO")
    p("============================================================")

    if many_equal_by_n:
        for n in sorted(many_equal_by_n):
            p()
            p(f"------------------------------------------------------------")
            p(f"{n} A {n}")
            p(f"------------------------------------------------------------")
            for name, munet_paths, backup_paths in many_equal_by_n[n]:
                print_many_group(name, munet_paths, backup_paths)
    else:
        p("Ninguno.")

    p()
    p("============================================================")
    p("DOCUMENTOS DE ORIGEN QUE SÍ ESTÁN EN PAPERLESS")
    p("RELACIÓN VARIOS A VARIOS — NÚMERO DISTINTO")
    p("============================================================")

    if many_unequal_by_nm:
        for n_munet, n_paperless in sorted(many_unequal_by_nm):
            p()
            p(f"------------------------------------------------------------")
            p(f"{n_munet} A {n_paperless}")
            p(f"------------------------------------------------------------")
            for name, munet_paths, backup_paths in many_unequal_by_nm[(n_munet, n_paperless)]:
                print_many_group(name, munet_paths, backup_paths)
    else:
        p("Ninguno.")

    p()
    p("============================================================")
    p("DOCUMENTOS DE ORIGEN QUE SÍ ESTÁN EN PAPERLESS")
    p("RELACIÓN 1 A 1")
    p("============================================================")

    if matched_one_to_one:
        for _name, munet_paths, backup_paths in matched_one_to_one:
            p()
            p(f"ORIGEN: {munet_paths[0]}")
            print_paperless_path(backup_paths[0])
    else:
        p("Ninguno.")

    p()
    p("============================================================")
    p("DOCUMENTOS DEL MANIFEST SIN PDF ORIGINAL EN EL BACKUP")
    p("============================================================")

    if manifest_documents_without_pdf:
        for document in manifest_documents_without_pdf:
            p()
            expected_path = backup / document["exported_name"]
            print_paperless_document(expected_path, document)
    else:
        p("Ninguno.")


def main():
    parser = argparse.ArgumentParser(description="Genera el informe para el dashboard desde una exportación de Paperless.")
    parser.add_argument("--source", default=os.environ.get("SOURCE_FILES_ROOT"), help="Carpeta de PDF de origen")
    parser.add_argument("--backup", default=os.environ.get("BACKUP_FILES_ROOT"), help="Carpeta exportada por document_exporter")
    parser.add_argument("--manifest", help="Ruta del manifest.json (por defecto, dentro de --backup)")
    parser.add_argument("--output", default=os.environ.get("INVENTORY_OUTPUT"), help="Ruta del TXT de salida")
    parser.add_argument("--force", action="store_true", help="Reemplaza un informe ya existente")
    args = parser.parse_args()
    if not args.source or not args.backup or not args.output:
        parser.error("indica --source, --backup y --output, o configura sus variables de entorno")

    source = Path(args.source).resolve()
    backup = Path(args.backup).resolve()
    manifest = Path(args.manifest).resolve() if args.manifest else backup / "manifest.json"
    output = Path(args.output).resolve()
    if not source.is_dir():
        raise SystemExit(f"ERROR: No existe la carpeta de origen: {source}")
    if not backup.is_dir():
        raise SystemExit(f"ERROR: No existe la carpeta exportada: {backup}")
    if not manifest.is_file():
        raise SystemExit(f"ERROR: No existe el manifest de Paperless: {manifest}")
    if not output.parent.is_dir():
        raise SystemExit(f"ERROR: No existe la carpeta de salida: {output.parent}")
    if output.exists() and not args.force:
        raise SystemExit(f"ERROR: El informe ya existe: {output}. Usa --force para reemplazarlo.")

    catalogs, manifest_documents, documents_by_exported_name = (
        load_paperless_manifest(manifest)
    )

    # ------------------------------------------------------------
    # 1. PDFs de origen
    # ------------------------------------------------------------

    munet_files = pdfs_under(source)
    if not munet_files:
        raise SystemExit(f"ERROR: No se encontraron PDF en la carpeta de origen: {source}")

    munet_by_name = defaultdict(list)
    munet_by_comparable = defaultdict(list)

    for path in munet_files:
        munet_by_name[path.name].append(path)
        munet_by_comparable[comparable_name(path.name)].append(path)

    # ------------------------------------------------------------
    # 2. PDFs originales del backup de Paperless
    #    Excluimos los archivos procesados *-archive.pdf
    # ------------------------------------------------------------

    backup_files = pdfs_under(backup, exclude_archive=True)

    backup_names = {filename_key(path.name) for path in backup_files}
    manifest_documents_without_pdf = [
        document
        for document in manifest_documents
        if filename_key(document["exported_name"]) not in backup_names
    ]
    backup_files_without_manifest = [
        path
        for path in backup_files
        if filename_key(path.name) not in documents_by_exported_name
    ]

    backup_by_comparable = defaultdict(list)
    munet_comparables = set(munet_by_comparable)
    duplicated_comparables = {
        comparable_name(name)
        for name, paths in munet_by_name.items()
        if len(paths) > 1
    }

    for path in backup_files:
        original_key = original_key_from_backup(
            path.name,
            munet_comparables,
            duplicated_comparables,
        )
        if original_key is not None:
            backup_by_comparable[original_key].append(path)

    # ------------------------------------------------------------
    # 3. Documentos de origen encontrados / no encontrados
    # ------------------------------------------------------------

    matched = []
    unmatched = []

    for munet_path in munet_files:
        candidates = backup_by_comparable.get(comparable_name(munet_path.name), [])
        if candidates:
            matched.append((munet_path, candidates))
        else:
            unmatched.append(munet_path)

    matched_keys = sorted(
        {comparable_name(munet_path.name) for munet_path, _ in matched},
        key=str.lower,
    )
    matched_one_to_one = []
    matched_many_to_many = []

    for key in matched_keys:
        munet_paths = munet_by_comparable[key]
        backup_paths = backup_by_comparable[key]
        group = (key, munet_paths, backup_paths)
        if len(munet_paths) == 1 and len(backup_paths) == 1:
            matched_one_to_one.append(group)
        else:
            matched_many_to_many.append(group)

    # ------------------------------------------------------------
    # 4. Nombres PDF duplicados en origen
    # ------------------------------------------------------------

    duplicated_munet_names = {
        name: paths
        for name, paths in munet_by_name.items()
        if len(paths) > 1
    }

    # ------------------------------------------------------------
    # 5. Archivos encontrados en Paperless que no estaban
    #    en origen
    # ------------------------------------------------------------

    paperless_not_in_munet = []

    for original_key, backup_paths in backup_by_comparable.items():
        if original_key not in munet_by_comparable:
            for backup_path in backup_paths:
                paperless_not_in_munet.append((original_key, backup_path))

    paperless_not_in_munet.sort(key=lambda x: str(x[1]).lower())

    # ------------------------------------------------------------
    # 6. Informe
    # ------------------------------------------------------------

    temporary_path = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=output.parent,
                                         prefix=".desglose-", suffix=".tmp", delete=False) as out:
            temporary_path = Path(out.name)
            write_report(
                out,
                source,
                backup,
                munet_files,
                backup_files,
                matched,
                unmatched,
                matched_one_to_one,
                matched_many_to_many,
                duplicated_munet_names,
                paperless_not_in_munet,
                manifest,
                catalogs,
                manifest_documents,
                documents_by_exported_name,
                manifest_documents_without_pdf,
                backup_files_without_manifest,
            )
        if args.force:
            os.replace(temporary_path, output)
        else:
            os.link(temporary_path, output)
    except FileExistsError:
        raise SystemExit(f"ERROR: El informe ya existe: {output}. Usa --force para reemplazarlo.")
    except OSError as error:
        raise SystemExit(f"ERROR: No se pudo escribir el informe {output}: {error}")
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)

    print("Informe generado correctamente:")
    print(output)


if __name__ == "__main__":
    main()
