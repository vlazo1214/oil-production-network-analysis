import pandas as pd

DATA_PATH = "./data/BACI_HS92_V202601"

# Load country codes mapping provided alongside BACI
countries = pd.read_csv(f"{DATA_PATH}/country_codes_V202601.csv")
# NOTE: change this line if having full names is too noisy
country_dict = dict(zip(countries["country_code"], countries["country_name"]))

# Stream/filter BACI file for HS code 270900 (crude petroleum)
baci_path = f"{DATA_PATH}/BACI_HS92_Y2024_V202601.csv"  # Target year file
df = pd.read_csv(baci_path)

# Filter crude oil and clean zero/null flows
crude_df = df[df["k"] == 270900].dropna(subset=["v"])

# Aggregate if there are multiple sub-entries per country pair
aggregated = (
    crude_df.groupby(["i", "j"], as_index=False)
    .agg({"v": "sum", "q": "sum"})
)

# Build Edges Table
edges = pd.DataFrame({
    "Source": aggregated["i"].map(country_dict).fillna(aggregated["i"]),
    "Target": aggregated["j"].map(country_dict).fillna(aggregated["j"]),
    "Type": "Directed",
    "Weight": aggregated["v"],  # or aggregated["q"] for physical metric tons
    "Quantity_MT": aggregated["q"]
})

# Build Nodes Table
all_node_ids = set(edges["Source"]).union(set(edges["Target"]))
nodes = pd.DataFrame({
    "Id": list(all_node_ids),
    "Label": list(all_node_ids)
})

# Export to CSV
edges.to_csv("data/crude_oil_edges.csv", index=False)
nodes.to_csv("data/crude_oil_nodes.csv", index=False)
