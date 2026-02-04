from unittest.mock import MagicMock
import sys

# Mock modules
sys.modules['shared_code.utils.session'] = MagicMock()
sys.modules['shared_code.utils.config_loader'] = MagicMock()
sys.modules['shared_code.llm.aoai_client'] = MagicMock()

from shared_code.utils.session import load_session, save_session
from shared_code.utils.config_loader import load_merged_config
from shared_code.llm.aoai_client import chat_completion
import shared_code.workflows.warranty_engine as sut

def test_loop_fix():
    print("Testing Infinite Loop Fix...")

    # 1. Setup Mock Data (Out of Warranty)
    session_id = "test_loop_123"
    
    # Initial Session
    session_data = {
        "client_id": "c1", 
        "purchase_date": "2015-01-01",  # Definitely out of warranty
        "issue_history": ""
    }
    
    config_data = {
        "warranty_period_months": 36,
        "warranty_outcome": "capture_details"
    }
    
    # Mocking
    load_session.return_value = session_data
    load_merged_config.return_value = config_data
    chat_completion.return_value = "Follow up question from LLM." # LLM response

    # --- Turn 1: Bot should ask initial capture question ---
    print("\n--- Turn 1 ---")
    res1 = sut.handle_warranty(session_id, "My car is broken.")
    print(f"Prompt 1: {res1['prompt']}")
    
    # Verification 1: Should be the canned 'outside warranty' prompt
    if "outside warranty" in res1['prompt']:
        print("[PASS] Turn 1 correctly gave out-of-warranty prompt.")
    else:
        print(f"[FAIL] Turn 1 unexpected prompt: {res1['prompt']}")

    # Verification 1b: Verify session was saved with 'capturing_details' = True
    # In a real run, save_session updates the DB. Here we just assume the *next* call to load_session 
    # would return the updated dict. For this test we manually update our mock object.
    session_data["capturing_details"] = True 

    # --- Turn 2: User responds to that prompt ---
    print("\n--- Turn 2 ---")
    res2 = sut.handle_warranty(session_id, "The engine is smoking.")
    print(f"Prompt 2: {res2['prompt']}")
    
    # Verification 2: Should NOT be the canned prompt. Should be LLM response.
    if "outside warranty" in res2['prompt']:
        print("[FAIL] Turn 2 looped back to initial prompt!")
    elif "Follow up question" in res2['prompt']:
        print("[PASS] Turn 2 correctly fell through to LLM logic.")
    else:
        print(f"[FAIL] Turn 2 gave unknown response: {res2['prompt']}")

if __name__ == "__main__":
    test_loop_fix()
