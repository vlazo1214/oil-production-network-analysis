# General Decisions

- For dataset, we are initially deciding to use this site:   https://www.international-economics.eu/CEPII/en/welcome.asp
to filter data from 2020 to 2024

- goal for check in assignment: build network based on final filtered dataset

# Project Decisions — Crude Oil Trade Network (Project check-in)

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


# Main analysis roadmap (final deliverables)
for every year look at specific interactions between countries , see how sensitive certain countries are 

- ex: remove gulf countries -> see how sensitive 


main ideas for analysis:

- analyze each year's network
  - general
  - robustness
- after each individual year has been analyzed
  - compare the states of 2021 and 2022 and analyze how robust the network was in a two year span
    - this allows us to see the network's strength and resilience BEFORE actual fighting happened
  - compare the states of 2023 and 2024
    - this allows us to see the network's strength and resilience AFTER actual fighting happened
- after each pair of years has been analyzed:
  - overall how did the network's strength and resilience change over 4 years


how we could use 2021-2022 is 

- general analysis
  - nodes with highest eigenvector centrality, other relevant centrality measures
- robustness testing:
  - if you were to remove certain countries or trade routes (edges) how did that affect the network in those years
  - when removing a node, analyze how the node's neighbors were affected (local) seeing how sensitive nodes are and the entire network (global)

compare to fighting happened in 2023-2024

- general analysis
- robustness testing:
  - if you were to remove certain countries or trade routes (edges) how did that affect the network in those years
