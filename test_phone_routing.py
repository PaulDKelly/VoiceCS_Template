import json
import os
import sys

# Add project root to path
sys.path.append(os.getcwd())

def test_lookup(to_number):
    client_id = "default"
    industry = "automotive"
    
    mapping_path = "shared_code/config/phone_mappings.json"
    if os.path.exists(mapping_path):
        with open(mapping_path, "r") as f:
            mappings = json.load(f).get("mappings", {})
            if to_number in mappings:
                client_id = mappings[to_number].get("client_id", client_id)
                industry = mappings[to_number].get("industry", industry)
                print(f"Match found! {to_number} -> Client: {client_id}, Industry: {industry}")
            else:
                print(f"No match for {to_number}. Using defaults: {client_id}, {industry}")
    else:
        print("Mapping file not found.")
    
    return client_id, industry

# Test cases
print("--- Test 1: Empty Mappings ---")
test_lookup("+447123456789")

# Add a test mapping
mapping_file = "shared_code/config/phone_mappings.json"
with open(mapping_file, "w") as f:
    json.dump({
        "mappings": {
            "+447123456789": {
                "client_id": "autonova",
                "industry": "automotive"
            },
            "+447999999999": {
                "client_id": "healthcare_demo",
                "industry": "healthcare"
            }
        }
    }, f, indent=2)

print("\n--- Test 2: With Mappings ---")
test_lookup("+447123456789")
test_lookup("+447999999999")
test_lookup("+1234567890") # No match

# Cleanup - reset to empty for user
with open(mapping_file, "w") as f:
    json.dump({"mappings": {}}, f, indent=2)
