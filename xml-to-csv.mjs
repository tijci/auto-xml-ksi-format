/**
 * xml-to-csv.mjs
 * Baixa o feed XML do KSI (VRSync) e converte para CSV otimizado.
 *
 * - Busca o XML via HTTP (sem dependência de arquivo local)
 * - Remove fotos (nó <Media>)
 * - Sanitiza descrição (remove quebras de linha → não quebra CSV)
 * - Separador ponto-e-vírgula (padrão Excel pt-BR; sem colisão com vírgulas nas descrições)
 * - CEP sempre com 8 dígitos (evita perda de zero à esquerda)
 *
 * Uso:
 *   node xml-to-csv.mjs [URL_DO_XML] [saida.csv]
 *
 * Exemplos:
 *   node xml-to-csv.mjs https://exemplo.com/feed.xml docs/imoveis.csv
 *   node xml-to-csv.mjs imoveis.xml imoveis.csv   ← fallback arquivo local
 */

import { readFileSync, writeFileSync } from "fs";
import { XMLParser } from "fast-xml-parser";

// ─── Configuração do parser ───────────────────────────────────────────────────
const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    cdataPropName: "__cdata",
    allowBooleanAttributes: true,
    parseAttributeValue: false, // mantém tudo como string (preserva CEP com zero à esquerda)
    parseNodeValue: false,
    trimValues: true,
    isArray: (tagName) => tagName === "Listing" || tagName === "Item",
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getText(node) {
    if (!node && node !== 0) return "";
    if (typeof node === "string") return node.trim();
    if (typeof node === "number") return String(node);
    if (node.__cdata !== undefined) return String(node.__cdata).trim();
    if (node["#text"] !== undefined) return String(node["#text"]).trim();
    return "";
}

function formatCep(raw) {
    const digits = String(raw ?? "").replace(/\D/g, "");
    return digits ? digits.padStart(8, "0") : "";
}

function sanitizeDescription(text) {
    return text
        .replace(/\r\n|\r|\n/g, " ")
        .replace(/\t/g, " ")
        .replace(/ {2,}/g, " ")
        .trim();
}

const SEPARATOR = ",";

function csvEscape(value) {
    let str = String(value ?? "");
    if (/^[=+\-@]/.test(str)) {
        str = "'" + str;
    }
    if (str.includes('"') || str.includes(SEPARATOR) || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

function toCsvRow(values) {
    return values.map(csvEscape).join(SEPARATOR);
}

// ─── Fetch do XML (URL ou arquivo local) ─────────────────────────────────────

async function fetchXml(source) {
    if (source.startsWith("http://") || source.startsWith("https://")) {
        console.log(`🌐 Baixando XML: ${source}`);
        const res = await fetch(source);
        if (!res.ok) {
            throw new Error(`Falha ao baixar XML: HTTP ${res.status} ${res.statusText}`);
        }
        return res.text();
    } else {
        console.log(`📂 Lendo arquivo local: ${source}`);
        return readFileSync(source, "utf-8");
    }
}

// ─── Mapeamento de campos ─────────────────────────────────────────────────────

function mapListing(listing) {
    const loc = listing.Location ?? {};
    const det = listing.Details ?? {};
    const con = listing.ContactInfo ?? {};
    const conLoc = con.Location ?? {};

    const listPrice = det.ListPrice;
    const rentalPrice = det.RentalPrice;
    const preco = listPrice ? getText(listPrice) : rentalPrice ? getText(rentalPrice) : "";
    const moeda = listPrice?.["@_currency"] ?? rentalPrice?.["@_currency"] ?? "BRL";
    const periodo = rentalPrice?.["@_period"] ?? "";

    const descRaw = getText(det.Description);
    const descClean = sanitizeDescription(descRaw);

    return {
        // Identificação
        id: getText(listing.ListingID),
        codigo_extra: getText(listing.CodigoExtra),
        titulo: getText(listing.Title),
        tipo_transacao: getText(listing.TransactionType),
        tipo_publicacao: getText(listing.PublicationType),
        empreendimento: getText(listing.Building),

        // Localização
        pais: getText(loc.Country),
        estado: loc.State?.["@_abbreviation"] ?? getText(loc.State),
        cidade: getText(loc.City),
        zona: getText(loc.Zone),
        bairro: getText(loc.Neighborhood),
        endereco: getText(loc.Address),
        numero: getText(loc.StreetNumber),
        complemento: getText(loc.Complement),
        cep: formatCep(getText(loc.PostalCode)),
        latitude: getText(loc.Latitude),
        longitude: getText(loc.Longitude),

        // Características
        tipo_imovel: getText(det.PropertyType),
        uso: getText(det.UsageType),
        area_util_m2: getText(det.LivingArea),
        area_terreno_m2: getText(det.LotArea),
        quartos: getText(det.Bedrooms),
        suites: getText(det.Suites),
        banheiros: getText(det.Bathrooms),
        vagas: getText(det.Garage),
        ano_construcao: getText(det.YearBuilt),

        // Valores
        moeda,
        preco,
        periodo_aluguel: periodo,
        condominio: getText(det.PropertyAdministrationFee),
        iptu_anual: getText(det.YearlyTax),

        // Descrição (sem quebras de linha)
        descricao: descClean,

        // Contato
        contato_nome: getText(con.n ?? con.Name),
        contato_email: getText(con.Email),
        contato_telefone: getText(con.Telephone),
        contato_site: getText(con.Website),
        imobiliaria: getText(con.OfficeName),
        contato_cidade: getText(conLoc.City),
        contato_bairro: getText(conLoc.Neighborhood),
        contato_cep: formatCep(getText(conLoc.PostalCode)),
    };
}

// ─── Headers do CSV ───────────────────────────────────────────────────────────

const HEADERS = [
    "id", "codigo_extra", "titulo", "tipo_transacao", "tipo_publicacao", "empreendimento",
    "pais", "estado", "cidade", "zona", "bairro", "endereco", "numero", "complemento",
    "cep", "latitude", "longitude",
    "tipo_imovel", "uso", "area_util_m2", "area_terreno_m2",
    "quartos", "suites", "banheiros", "vagas", "ano_construcao",
    "moeda", "preco", "periodo_aluguel", "condominio", "iptu_anual",
    "descricao",
    "contato_nome", "contato_email", "contato_telefone", "contato_site",
    "imobiliaria", "contato_cidade", "contato_bairro", "contato_cep",
];

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    const args = process.argv.slice(2);
    const source = args[0] ?? "https://axvliw1bcpyx.objectstorage.sa-vinhedo-1.oci.customer-oci.com/n/axvliw1bcpyx/b/ksi/o/1421/xml/xml_ksi_zap_vrsync_1_0_3.xml";
    const csvPath = args[1] ?? "docs/imoveis.csv";

    const xmlContent = await fetchXml(source);

    console.log(`⚙️  Parseando XML...`);
    const parsed = parser.parse(xmlContent);
    const listings = parsed?.ListingDataFeed?.Listings?.Listing ?? [];
    console.log(`📋 Total de imóveis: ${listings.length}`);

    const rows = [toCsvRow(HEADERS)];
    for (const listing of listings) {
        const flat = mapListing(listing);
        rows.push(toCsvRow(HEADERS.map((h) => flat[h] ?? "")));
    }

    const csvContent = rows.join("\n");
    writeFileSync(csvPath, csvContent, "utf-8");

    const sizeKb = (Buffer.byteLength(csvContent, "utf-8") / 1024).toFixed(1);
    console.log(`✅ CSV gerado: ${csvPath}`);
    console.log(`📊 ${rows.length} linhas (1 cabeçalho + ${rows.length - 1} imóveis)`);
    console.log(`💾 Tamanho: ${sizeKb} KB`);

    // Gera metadados para o index.html
    const meta = {
        gerado_em: new Date().toISOString(),
        total: listings.length,
        tamanho_kb: parseFloat(sizeKb),
        fonte: source,
    };
    writeFileSync("docs/meta.json", JSON.stringify(meta, null, 2), "utf-8");
    console.log(`📝 Metadados: docs/meta.json`);
}

main().catch((err) => {
    console.error("❌ Erro:", err.message);
    process.exit(1);
});
