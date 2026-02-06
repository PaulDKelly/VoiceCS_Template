from shared_code.workflows.warranty_engine import handle_warranty
from shared_code.workflows.service_engine import handle_service
from shared_code.workflows.finance_engine import handle_finance
from shared_code.workflows.sales_engine import handle_sales
from shared_code.workflows.general_engine import handle_general
from shared_code.workflows.generic_engine import handle_generic_workflow
from shared_code.utils.session import load_session
from shared_code.utils.config_loader import load_merged_config

def route_to_workflow(intent: str, session_id: str, text: str) -> dict:
    # 1. Check if client has a CUSTOM workflow for this intent in their JSON
    try:
        session = load_session(session_id)
        config = load_merged_config(session.get("client_id"), session.get("industry"))
        custom_workflow = config.get("workflows", {}).get(intent)
        if custom_workflow:
            # Always allow designer control for first_response and sales
            if intent in ["first_response", "sales"]:
                print(f"DEBUG: Found custom workflow for intent '{intent}'. Routing to generic_engine.", flush=True)
                return handle_generic_workflow(session_id, text)

            # For other intents, require explicit opt-in to generic engine
            if custom_workflow.get("use_generic_engine"):
                print(f"DEBUG: Found custom workflow for intent '{intent}' (opt-in). Routing to generic_engine.", flush=True)
                return handle_generic_workflow(session_id, text)
    except Exception as e:
        print(f"DEBUG: Error checking for custom workflow: {e}", flush=True)

    # 2. Fall back to hardcoded engines
    if intent == "warranty":
        return handle_warranty(session_id, text)

    if intent == "service":
        return handle_service(session_id, text)

    if intent == "finance":
        return handle_finance(session_id, text)

    if intent == "sales":
        return handle_sales(session_id, text)

    return handle_general(session_id, text)

