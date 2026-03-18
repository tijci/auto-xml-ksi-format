import xml.etree.ElementTree as ET
import argparse
import os
import sys
from datetime import datetime

# ─── Mapeamentos de normalização ─────────────────────────────────────────────

TRANSACTION_TYPE_MAP = {
    "For Sale": "Venda",
    "For Rent": "Aluguel",
    "for sale": "Venda",
    "for rent": "Aluguel",
}

PROPERTY_TYPE_MAP = {
    # Residencial
    "Residential / Apartment":  "Apartamento",
    "Residential / Home":       "Casa",
    "Residential / Condo":      "Casa de Condomínio",
    "Residential / Land Lot":   "Terreno Residencial",
    "Residential / Flat":       "Flat",
    "Residential / Kitnet":     "Kitnet",
    # Comercial
    "Commercial / Office":              "Sala Comercial",
    "Commercial / Land Lot":            "Terreno Comercial",
    "Commercial / Industrial":          "Imóvel Industrial",
    "Commercial / Business":            "Ponto Comercial",
    "Commercial / Edificio Comercial":  "Prédio Comercial",
    "Commercial / Agricultural":        "Imóvel Rural",
    "Comercial Sala em Condomínio":     "Sala em Condomínio Comercial",
}

USAGE_TYPE_MAP = {
    "Residential": "Residencial",
    "Commercial":  "Comercial",
    "Mixed":       "Misto",
}

# Campos a remover completamente de cada <Listing>
FIELDS_TO_REMOVE = {
    "CodigoExtra",
    "PublicationType",
    "Building",
    "Media",
    "ContactInfo",
}

# Campos a remover de <Location>
LOCATION_FIELDS_TO_REMOVE = {
    "Country",
    "State",
    "Zone",
    "Complement",
    "PostalCode",
    "Latitude",
    "Longitude",
}

# Campos a remover de <Details>
DETAILS_FIELDS_TO_REMOVE = {
    "YearBuilt",
    "PropertyAdministrationFee",  # quase sempre vazio
}

# ─── Helpers ─────────────────────────────────────────────────────────────────

def normalize(text: str, mapping: dict) -> str:
    """Aplica mapeamento ou retorna o valor original se não encontrado."""
    return mapping.get(text.strip(), text.strip()) if text else text


def truncate(text: str, max_chars: int) -> str:
    """Trunca texto mantendo palavras completas."""
    if not text or len(text) <= max_chars:
        return text
    truncated = text[:max_chars].rsplit(" ", 1)[0]
    return truncated + "…"


def get_tag(element) -> str:
    """Retorna tag sem namespace."""
    tag = element.tag
    return tag.split("}")[-1] if "}" in tag else tag


def remove_children_by_tag(parent, tags_to_remove: set):
    """Remove filhos cujo tag local esteja no conjunto informado."""
    to_remove = [child for child in parent if get_tag(child) in tags_to_remove]
    for child in to_remove:
        parent.remove(child)


# ─── Processamento principal ─────────────────────────────────────────────────

def process_listing(listing, ns_prefix: str, max_desc: int) -> None:
    """
    Modifica um elemento <Listing> in-place, aplicando todas as otimizações.
    """
    # 1. Remove campos de nível raiz desnecessários
    remove_children_by_tag(listing, FIELDS_TO_REMOVE)

    # 2. Normaliza TransactionType
    for tt in listing.findall(f"{ns_prefix}TransactionType"):
        if tt.text:
            tt.text = normalize(tt.text, TRANSACTION_TYPE_MAP)

    # 3. Limpa Location
    location = listing.find(f"{ns_prefix}Location")
    if location is not None:
        remove_children_by_tag(location, LOCATION_FIELDS_TO_REMOVE)
        # Address e StreetNumber mantidos (úteis para o cliente)

    # 4. Processa Details
    details = listing.find(f"{ns_prefix}Details")
    if details is not None:
        remove_children_by_tag(details, DETAILS_FIELDS_TO_REMOVE)

        # Normaliza PropertyType
        for pt in details.findall(f"{ns_prefix}PropertyType"):
            if pt.text:
                pt.text = normalize(pt.text, PROPERTY_TYPE_MAP)

        # Normaliza UsageType
        for ut in details.findall(f"{ns_prefix}UsageType"):
            if ut.text:
                ut.text = normalize(ut.text, USAGE_TYPE_MAP)

        # Description mantida integralmente (valor semântico completo)


def build_ns_prefix(root) -> str:
    """Extrai o namespace do root element para uso em findall."""
    if root.tag.startswith("{"):
        ns = root.tag.split("}")[0] + "}"
        return ns
    return ""


# ─── CLI e entrada principal ──────────────────────────────────────────────────

def parse_args():
    parser = argparse.ArgumentParser(
        description="Otimiza XML KSI/ZAP para ingestão RAG no Neppo."
    )
    parser.add_argument(
        "--input", "-i",
        default="xml_ksi_zap_vrsync_1_0_3.xml",
        help="Caminho do XML original (padrão: xml_ksi_zap_vrsync_1_0_3.xml)"
    )
    parser.add_argument(
        "--output", "-o",
        default=None,
        help="Caminho do XML otimizado (padrão: <input>_optimized.xml)"
    )
    parser.add_argument(
        "--max-desc", "-d",
        type=int,
        default=300,
        help="Máximo de caracteres na Description (padrão: 300)"
    )
    return parser.parse_args()


def main():
    args = parse_args()

    input_path = args.input
    output_path = args.output or input_path.replace(".xml", "_optimized.xml")
    max_desc = args.max_desc

    if not os.path.exists(input_path):
        print(f"[ERRO] Arquivo não encontrado: {input_path}")
        sys.exit(1)

    original_size_mb = os.path.getsize(input_path) / 1024 / 1024
    print(f"[INFO] Lendo: {input_path} ({original_size_mb:.2f} MB)")

    # Registra namespace para evitar ns0: no output
    ET.register_namespace("", "http://www.vivareal.com/schemas/1.0/VRSync")
    ET.register_namespace("xsi", "http://www.w3.org/2001/XMLSchema-instance")

    print("[INFO] Fazendo parse do XML...")
    tree = ET.parse(input_path)
    root = tree.getroot()

    ns_prefix = build_ns_prefix(root)

    listings = root.findall(f".//{ns_prefix}Listing")
    total = len(listings)
    print(f"[INFO] {total} listings encontrados. Processando...")

    for i, listing in enumerate(listings, 1):
        process_listing(listing, ns_prefix, max_desc)
        if i % 500 == 0:
            print(f"  → {i}/{total} processados...")

    print(f"[INFO] Escrevendo: {output_path}")
    tree.write(output_path, encoding="UTF-8", xml_declaration=True)

    output_size_mb = os.path.getsize(output_path) / 1024 / 1024
    reduction = (1 - output_size_mb / original_size_mb) * 100

    print()
    print("═" * 50)
    print(f"  ✓ Concluído em {datetime.now().strftime('%H:%M:%S')}")
    print(f"  Tamanho original:  {original_size_mb:.2f} MB")
    print(f"  Tamanho otimizado: {output_size_mb:.2f} MB")
    print(f"  Redução:           {reduction:.1f}%")
    print(f"  Listings:          {total}")
    print(f"  Desc. max:         {max_desc} chars")
    print(f"  Output:            {output_path}")
    print("═" * 50)


if __name__ == "__main__":
    main()
