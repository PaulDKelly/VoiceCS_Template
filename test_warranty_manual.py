import os
import sys

import json

# Ensure we can import shared_code
sys.path.append(os.getcwd())

# Load keys from local.settings.json
try:
    with open("local.settings.json", "r") as f:
        settings = json.load(f)["Values"]
        for k, v in settings.items():
            if k not in os.environ:
                os.environ[k] = v
    print("Loaded keys from local.settings.json")
except Exception as e:
    print(f"Warning: Could not load local.settings.json: {e}")

from shared_code.workflows.warranty_engine import handle_warranty
from shared_code.utils.session import save_session

# Mock Session Setup
SESSION_ID = "manual_test_session"
session = {
    "client_id": "autonova",
    "industry": "automotive",
    "customer_name": "Paul",
    "issue_history": ""
}
save_session(SESSION_ID, session)

def test_runner():
    print("--- Starting Manual Warranty Logic Test ---")
    
    # 1. Date Capture
    print("\n[User]: I bought it in December 2025.")
    response = handle_warranty(SESSION_ID, "December 2025")
    print(f"[Agent]: {response.get('prompt')}")
    
    # 2. Issue Description
    print("\n[User]: There is a banging noise.")
    response = handle_warranty(SESSION_ID, "There is a banging noise.")
    print(f"[Agent]: {response.get('prompt')}")

    # 3. Detailed Description
    print("\n[User]: It comes from the engine when I brake.")
    response = handle_warranty(SESSION_ID, "It comes from the engine when I brake.")
    print(f"[Agent]: {response.get('prompt')}")

    # 4. Final Detail (Should trigger COMPLETE)
    print("\n[User]: It happens every time, and it is very loud and metallic.")
    response = handle_warranty(SESSION_ID, "It happens every time, and it is very loud and metallic.")
    print(f"[Agent]: {response.get('prompt')}")
    
    # Check if intent switched
    from shared_code.utils.session import load_session
    final_session = load_session(SESSION_ID)
    print(f"\nFinal Intent: {final_session.get('intent')}")

if __name__ == "__main__":
    # Ensure env vars are set for AOAI (we will read from run-debug-session or assume set in terminal)
    # We can try to load them from .env if needed, but usually the user runs this in the active env.
    test_runner()
