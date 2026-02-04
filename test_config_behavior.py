from unittest.mock import MagicMock
import sys
import json

# Mock modules
sys.modules['shared_code.utils.session'] = MagicMock()
sys.modules['shared_code.utils.config_loader'] = MagicMock()
sys.modules['shared_code.llm.aoai_client'] = MagicMock()

from shared_code.utils.session import load_session, save_session
from shared_code.utils.config_loader import load_merged_config
from shared_code.llm.aoai_client import chat_completion
import shared_code.workflows.warranty_engine as sut

def test_configurable_behavior():
    print("Testing Configurable Behavior...")

    session_id = "test_config_123"
    
    # 1. Test SINGLE TURN mode
    print("\n--- Testing SINGLE_TURN mode ---")
    session_data = {
        "client_id": "c1", 
        "purchase_date": "2024-01-01", 
        "issue_history": "",
        "warranty_issue_asked": True # Already asked the question
    }
    
    config_data = {
        "warranty_period_months": 36,
        "workflow_behavior": {
            "warranty": {
                "question_mode": "single_turn",
                "max_follow_ups": 0
            }
        }
    }
    
    load_session.return_value = session_data.copy()
    load_merged_config.return_value = config_data
    
    # In single turn, after the question is asked, any response should trigger handover
    res = sut.handle_warranty(session_id, "The brakes squeak.")
    print(f"Result prompt: {res['prompt']}")
    
    if res['session'].get("intent") == "service":
        print("[PASS] Correctly handed over after 1 turn in single_turn mode.")
    else:
        print("[FAIL] Did not hand over in single_turn mode.")

    # 2. Test MULTI TURN mode with Max 1 Follow-up
    print("\n--- Testing MULTI_TURN mode (Max 1) ---")
    session_data_multi = {
        "client_id": "c1", 
        "purchase_date": "2024-01-01", 
        "issue_history": "",
        "warranty_issue_asked": True,
        "warranty_follow_up_count": 0
    }
    
    config_data_multi = {
        "warranty_period_months": 36,
        "workflow_behavior": {
            "warranty": {
                "question_mode": "multi_turn",
                "max_follow_ups": 1
            }
        },
        "warranty_completion": {"mode": "handoff", "target_intent": "service"}
    }
    
    load_session.return_value = session_data_multi.copy()
    load_merged_config.return_value = config_data_multi
    chat_completion.return_value = "Can you tell me more? [Thinking]" # LLM asks a question
    
    # Turn 1: Should ask follow-up
    print("Turn 1 (Follow-up 0 -> 1)")
    res1 = sut.handle_warranty(session_id, "Brakes squeak.")
    print(f"Prompt 1: {res1['prompt']}")
    
    # Turn 2: Should hit max (1) and force completion
    print("Turn 2 (Follow-up 1 -> Hit Max)")
    # Update session for next turn as sut would have
    session_data_multi["warranty_follow_up_count"] = 1
    load_session.return_value = session_data_multi.copy()
    
    res2 = sut.handle_warranty(session_id, "Only when cold.")
    print(f"Prompt 2: {res2['prompt']}")
    
    if res2['session'].get("intent") == "service":
        print("[PASS] Correctly forced handover after reaching max_follow_ups.")
    else:
        print("[FAIL] Did not force handover at limit.")

    # 3. Test PER-NODE OVERRIDE
    print("\n--- Testing PER-NODE OVERRIDE ---")
    session_data_node = {
        "client_id": "c1", 
        "purchase_date": "2024-01-01", 
        "issue_history": "",
        "warranty_issue_asked": True
    }
    
    config_data_node = {
        "warranty_period_months": 36,
        "workflow_behavior": {
            "warranty": {
                "question_mode": "multi_turn", # Workflow level is Multi
                "max_follow_ups": 3
            }
        },
        "workflows": {
            "warranty": {
                "nodes": [
                    {
                        "id": "4",
                        "data": {
                             "behavior_override": True,
                             "question_mode": "single_turn", # Node level is Single
                             "max_follow_ups": 0
                        }
                    }
                ]
            }
        }
    }
    
    load_session.return_value = session_data_node.copy()
    load_merged_config.return_value = config_data_node
    
    # Even though workflow is multi_turn, node 4 override should make it single_turn
    res_node = sut.handle_warranty(session_id, "The engine light is on.")
    print(f"Result prompt: {res_node['prompt']}")
    
    if res_node['session'].get("intent") == "service":
        print("[PASS] Per-node override (Single Turn) correctly applied over Workflow (Multi Turn).")
    else:
        print("[FAIL] Per-node override was ignored.")

if __name__ == "__main__":
    test_configurable_behavior()
