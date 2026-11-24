# oil-production-network-analysis

## Dataset

The cleaned dataset for this project is included in `clean_data.zip`.
It contains one CSV file per year (`crude_YYYY.csv`). Each row is the total crude oil
trade flow from one exporting country to one importing country in that year, as reported in
BACI (CEPII), HS17 nomenclature, version V202601. Rows are sorted by trade value, largest first.

To use it, unzip `clean_data.zip` into `data/clean_data/`.
You do not need the raw data unless you want to re-run the cleaning step.

| Column | Type | Description | Example |
|---|---|---|---|
| `year` | integer | Year of the trade flow | 2021 |
| `exporter_code` | integer | BACI numeric country code of the exporter | 124 |
| `exporter` | text | Name of the exporting country | Canada |
| `importer_code` | integer | BACI numeric country code of the importer | 842 |
| `importer` | text | Name of the importing country | USA |
| `product` | integer | HS 6-digit product code; always 270900 (crude petroleum oils) | 270900 |
| `value_kUSD` | float | Trade value in thousands of US dollars (FOB) | 79,800,000 (= USD 79.8 billion) |
| `quantity_tons` | float | Quantity in metric tons; empty when BACI has no quantity for the flow | 194,000,000 |

**Notes**
- Country names come from `country_codes_V202601.csv` in the BACI release. Some names are
  BACI/UN Comtrade labels rather than common names (e.g. `Rep. of Korea`, `Other Asia, nes`).
- A few flows have no quantity (about 3–4% of rows, e.g. Iran → Other Asia, nes in 2021).
  The network analysis uses `value_kUSD` as edge weight, which is never missing.
- Opening the CSV in Excel shows large numbers in scientific notation (e.g. `7.98E+07`);
  the values in the file are exact. Do not save the file from Excel, as this can change the format.

## How to download the raw data

The raw BACI files are too large for GitHub (about 350 MB per year), so they are not included.

1. Go to the BACI page: https://www.cepii.fr/CEPII/en/bdd_modele/presentation.asp?id=37
2. Under **Download**, choose the **HS17** file (one zip containing every year from 2017 to 2024).
3. Unzip it and copy these files into `data/raw_data/`:
   - `country_codes_V202601.csv`
   - `BACI_HS17_Y2021_V202601.csv`
   - `BACI_HS17_Y2022_V202601.csv`
   - `BACI_HS17_Y2023_V202601.csv`
   - `BACI_HS17_Y2024_V202601.csv`
4. Open `cleaning_data.ipynb` and run all cells. The cleaned files are written to `data/clean_data/`.


## Folder Structure
data: CEPII dataset will live here along with the corresponding nodes and edges CSVs.

