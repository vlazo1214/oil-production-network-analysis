# General Decisions

- For dataset, we are initially deciding to use this site:   https://www.international-economics.eu/CEPII/en/welcome.asp
to filter data from 2020 to 2024

- goal for check in assignment: build network based on final filtered dataset

# Project Decisions — Crude Oil Trade Network

### 1. Baseline Year
- We will use **2021 as the baseline year** to analyze the international crude oil trade network before the Russia–Ukraine war.

### 2. Case Study: Russia–Ukraine War
- We will investigate how the international crude oil trade network changed following the Russia–Ukraine war and the European Union's restrictions on Russian crude oil imports.
- We will compare network structure and vulnerability before and after these trade restrictions.

### 3. Comparison Year
- We will use **2024 as the comparison year** to examine changes in trade relationships, major exporters and importers, and network connectivity.
- The comparison will be based on the 2021 and 2024 datasets.

### 4. Data Source
- **Database:** CEPII BACI International Trade Database
- **Source:** https://www.international-economics.eu/CEPII/en/bdd_modele/bdd_modele_item.asp?id=37
- BACI uses international trade data from UN Comtrade and reconciles exporter- and importer-reported trade flows to improve data consistency.

### 5. Product Classification
- **Classification:** Harmonized System 2017 (HS17)
- **Data coverage:** 2017–2024
- **Product code:** HS 270900
- **Product description:** Petroleum oils and oils obtained from bituminous minerals, crude.
- We will use the same HS classification and product code for both years to ensure consistency.

### 6. Network Construction
- **Nodes:** Countries
- **Directed edges:** Crude oil trade flows from exporters to importers
- **Edge weight:** Trade quantity (metric tons) (if needed for weighted network analysis)
- **Additional variable:** Trade value (thousands of USD) (if needed for supplementary analysis)

## 7. Tools and Implementation##
- **Python or Julia** : Data cleaning, network calculation.
- **Gephi** : Network visualization and supporting network metric analysis. (if needed) 
